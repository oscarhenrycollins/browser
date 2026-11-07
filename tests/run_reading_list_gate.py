"""Parent-only durable Forum admission: immutable Reader + serving Wizard shell.
No build, publication, live service access, privileged mounts or native APK changes.
"""
import hashlib,json,os,subprocess,time,tarfile,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
QA=ROOT/'qa';OUT=ROOT/'evidence';OUT.mkdir(exist_ok=True);OUT.chmod(0o777)
source=json.loads((QA/'source.json').read_text());image=source['reader_image'];steps=[]
project='browser-reading-list-'+source['browser_sha'][:8]
env={**os.environ,'APP_PORT':'18980','READER_DENY_HOSTS':source['deny_hosts']}
base=['docker','compose','-p',project,'-f',str(ROOT/'browser/runtipi/docker-compose.yml'),'-f',str(QA/'compose.json')]
def run(name,argv,timeout=120,check=True):
 start=time.monotonic()
 with (OUT/(name+'.log')).open('w') as f:
  try:p=subprocess.run(argv,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout);code=p.returncode
  except subprocess.TimeoutExpired:code=124
 steps.append({'name':name,'argv':argv,'exit_code':code,'seconds':round(time.monotonic()-start,2)});(OUT/'steps.json').write_text(json.dumps(steps,indent=2));print(name,code,flush=True)
 if check and code:raise RuntimeError(name+' failed')
 return code
def output(argv):return subprocess.check_output(argv,cwd=ROOT,env=env,text=True).strip()
def ready(cmd):
 for n in range(30):
  r=subprocess.run(cmd+['exec','-T','browser-reader','node','-e',"fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
  if r.returncode==0:return
  time.sleep(1)
 raise RuntimeError('Reader readiness timed out')
# QA containers carry a label so a timed-out one (the docker client is killed, the container is not) is removed
# before compose down; otherwise it keeps an endpoint on the project network and down fails (gate 7 Nov 2026).
QA_LABEL='wizard.qa='+project
def qa(name,script,timeout=240,extra=()):
 run(name,['docker','run','--rm','--label',QA_LABEL,'--network',project+'_default','-e','UPSTREAM_HOST=browser-engine','-e','SOURCE_ROOT=/sources','-e','EVIDENCE=/evidence',*extra,'-v',str(ROOT)+':/sources:ro','-v',str(ROOT/'browser/tests')+':/opt/qa:ro','-v',str(OUT)+':/evidence',image,'node',script],timeout)
def readback(cmd):
 return json.loads(output(cmd+['exec','-T','browser-reader','node','-e',"fetch('http://127.0.0.1:8080/api/list').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())})"]))
# This service tests the app-owned edge allowlist. Owner authentication itself remains
# the existing gateway's responsibility; no owner credentials are copied into the rig.
override={'services':{'browser-reader':{'image':image},'reader-edge':{'image':image,'user':'1000:1000','read_only':True,'entrypoint':['/sources/qa/caddy'],'command':['run','--config','/sources/qa/edge.Caddyfile','--adapter','caddyfile'],'volumes':[str(ROOT)+':/sources:ro'],'tmpfs':['/tmp:rw,nosuid,nodev,size=32m'],'environment':{'HOME':'/tmp','XDG_CONFIG_HOME':'/tmp','XDG_DATA_HOME':'/tmp'},'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'depends_on':['browser']}}}
(QA/'compose.json').write_text(json.dumps(override,indent=2))
try:
 run('sources-sha256',['sha256sum','-c','sources.sha256'])
 run('reader-manifest',['docker','buildx','imagetools','inspect',image])
 run('compose-pull',base+['pull'],150)
 run('compose-up',base+['up','-d','--wait','--wait-timeout','90'],150);ready(base)
 run('reader-tests',['docker','run','--rm','--network','none',image,'npm','test'],180)
 run('front-tests',['python3','-m','unittest','discover','-s',str(ROOT/'browser/tests'),'-p','test_*.py'])
 run('inline-check',['python3',str(ROOT/'browser/mcp/inline.py'),'--check'])
 # Real six-source integration kept, plus list MCP, CSRF and exact edge method isolation.
 qa('integration','/opt/qa/integration.mjs',240)
 # Four device/skin runs with real reads; 420 s cut the fourth (phone-grove) off on 7 Nov. 540 s keeps the job inside 900 s.
 qa('in-shell','/sources/browser/tests/qa-reader-shell.cjs',540)
 seed={'url':'https://contraptions.venkateshrao.com/p/experiments-with-monstrousness'}
 run('persistence-seed',base+['exec','-T','browser-reader','node','-e',"fetch('http://127.0.0.1:8080/api/list',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify("+json.dumps(seed)+")}).then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)})"],70)
 before=readback(base);assert len(before['items'])==1 and before['items'][0]['title']=='Experiments with Monstrousness',before
 (OUT/'persistence-before.json').write_text(json.dumps(before,indent=2))
 run('reader-restart',base+['restart','browser-reader'],30);ready(base)
 after=readback(base);assert after==before,(before,after)
 (OUT/'persistence-after-restart.json').write_text(json.dumps(after,indent=2))
 # Plain Compose named-volume restart, followed by WAM's compiled named-volume bind
 # representation and app-data backup/restore rehearsal. Real live wam backup archive
 # inspection is still mandatory at release; this isolated tar is NOT labelled wam backup.
 appdata=ROOT/'qa-app-data';folder=appdata/'volumes/reading-list';folder.mkdir(parents=True);folder.chmod(0o777)
 container=output(base+['ps','-q','browser-reader'])
 run('copy-wam-app-data',['docker','cp',container+':/data/list.json',str(folder/'list.json')])
 (folder/'list.json').chmod(0o666)
 archive=OUT/'app-data-rehearsal.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:tar.add(appdata,arcname='app-data')
 with tarfile.open(archive,'r:gz') as tar:
  archived=tar.extractfile('app-data/volumes/reading-list/list.json').read()
  assert json.loads(archived)==before['items'];tar.extractall(ROOT/'qa-restored',filter='data')
 restored=ROOT/'qa-restored/app-data/volumes/reading-list';restored.chmod(0o777);(restored/'list.json').chmod(0o666)
 bind=QA/'wam-compiled.json';bind.write_text(json.dumps({'services':{'browser-reader':{'volumes':[str(restored)+':/data']}}}))
 compiled=base+['-f',str(bind)]
 run('recreate-compiled-wam-storage',compiled+['up','-d','--force-recreate','--no-deps','browser-reader'],45);ready(compiled)
 after=readback(compiled);assert after==before
 (OUT/'persistence-after-restore-recreate.json').write_text(json.dumps({'items':after['items'],'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archive_path':'app-data/volumes/reading-list/list.json'},indent=2))
 qa('in-shell-after-restart','/sources/browser/tests/qa-reader-shell.cjs',90,['-e','PERSISTENCE_ONLY=1'])
 # Verify deny policy still applies to the actual running Reader, not a test mock.
 run('deny-self-hosts',compiled+['exec','-T','browser-reader','node','--input-type=module','-e',"import {destination,UnsafeURL} from './network.mjs';for(const host of process.env.READER_DENY_HOSTS.split(',')){try{await destination('https://'+(host.includes(':')?'['+host+']':host)+'/');throw Error('allowed '+host);}catch(e){if(!(e instanceof UnsafeURL))throw e;console.log('denied '+host);}}"])
except Exception as e:
 (OUT/'failure.txt').write_text(str(e));raise
finally:
 run('compose-logs',base+['logs','--no-color'],30,False)
 leftover=subprocess.run(['docker','ps','-aq','--filter','label='+QA_LABEL],capture_output=True,text=True).stdout.split()
 if leftover:run('qa-cleanup',['docker','rm','-f',*leftover],30,False)
 run('compose-down',base+['down','-v'],45,False)
 (OUT/'source.json').write_text(json.dumps(source,indent=2))
