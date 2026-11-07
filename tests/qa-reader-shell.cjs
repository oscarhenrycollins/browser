'use strict';
// Admitted Forum gate only: real shell, genuine installed Search assets + recorded real provider result,
// real immutable Reader backend. Owner/agent APIs below are explicitly synthetic;
// only Reading list writes reach the isolated QA backend (never James's list).
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {proxyRequest}=require('../reader/test/shell-transport.cjs');
const {chromium}=require('/opt/reader/node_modules/playwright-core');
const ROOT=process.env.SOURCE_ROOT||'/sources',OUT=process.env.EVIDENCE||'/evidence';
const ORIGIN='http://reader-shell.test',WEB=path.join(ROOT,'ux/web'),QA=path.join(ROOT,'qa');
const source=JSON.parse(fs.readFileSync(path.join(QA,'source.json')));
const search=JSON.parse(fs.readFileSync(path.join(QA,'search-web.json')));
const target=search.results.find(r=>r.url==='https://en.wikipedia.org/wiki/Reading');
assert.ok(target,'Recorded genuine Search result must include the article');
const NOW=Date.now(),SID='reader_gate_thread';
// James, 7 Nov 2026: real bot-walled hosts (chosen at start from what the real Reader refuses from this network) and a
// Wizard own page. Neither may need a second tap; the own page never reaches Reader.
const BLOCK_CANDIDATES=['https://www.reddit.com/r/programming/','https://www.reuters.com/world/','https://www.ddproperty.com/en/property-for-sale'];
const OWN='https://wizard.aiwizards.com/clips-pipeline/#/clip/pod-2026-09-25-03-agency-small-wins';
let BLOCKED=BLOCK_CANDIDATES[0],BLOCKED2=BLOCKED+'?second=1',MSG='';
const message=()=>`[Read the article](${target.url})\n\n[Internal Notes](/notes/)\n\n[Download PDF](https://download.example/reader.pdf) · [Download APK](https://download.example/reader.apk)\n\n[Blocked news](${BLOCKED}) · [Blocked again](${BLOCKED2})\n\n[Wizard clip](${OWN})`;
const apps=[{id:'browser',name:'Browser',url:'/browser/',source:'apps.json',type:'service',provides:['browser']},{id:'wizard-search',name:'Search',url:'/search/',source:'apps.json',type:'service',provides:['web-search','image-search']},{id:'notes',name:'Notes',url:'/notes/',source:'apps.json',type:'service',provides:['note-taking']}];
let row;const makeRow=()=>({id:SID,title:'Reader release acceptance',agent:'hermes',status:'completed',message_count:2,last_active:new Date(NOW).toISOString(),wizard_activity_at:new Date(NOW).toISOString(),wizard_last_assistant_at:new Date(NOW).toISOString(),latest_message:{role:'assistant',content:MSG,timestamp:NOW/1000}});
const TYPES={'.css':'text/css','.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const results=[],diagnostics=[];let browser,blockedChoice=null;
const save=()=>fs.writeFileSync(path.join(OUT,process.env.PERSISTENCE_ONLY?'in-shell-persistence-results.json':'in-shell-results.json'),JSON.stringify({kind:'composed-real-shell-reader',source,blockedChoice,searchProvenance:'search-preview e429987349b87d0c6d4973fb482c604765e2434b; real /api/web result recorded from installed provider; only owner APIs synthetic',results,diagnostics},null,2));
async function test(name,fn,p){try{const data=await fn();results.push({name,ok:true,...(data||{})});console.log('PASS',name);}catch(e){const failure={name,ok:false,error:String(e),stack:e.stack};if(p){failure.frames=await Promise.all(p.frames().filter(f=>f.url().startsWith(ORIGIN)).map(async f=>({url:f.url(),state:await f.evaluate(()=>({title:document.title,status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,pageHidden:document.querySelector('#page')?.hidden,save:document.querySelector('#save')?.outerHTML,reviewCoach:!!document.querySelector('.rv-coach.open')})).catch(()=>null)})));await p.screenshot({path:path.join(OUT,name.replace(/[^a-z0-9]/gi,'-')+'-failure.png')}).catch(()=>{});}results.push(failure);console.log('FAIL',name,String(e));}save();}
async function boot(phone,skin){
 const ctx=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:1,isMobile:phone,hasTouch:phone,serviceWorkers:'block',userAgent:phone?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36 WizardOS-Android/0.10.9':undefined});
 const d={phone,skin,writes:[],listWrites:[],foreign:[],pageErrors:[],firstFrames:[],readerTraffic:[],console:[]};diagnostics.push(d);let release=null,hold=false,listRelease=null,listHold=false;
 await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url()),m=q.method();const json=(x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
  try{
   if(u.origin==='https://download.example'&&/^\/reader\.(pdf|apk)$/.test(u.pathname))return r.fulfill({status:200,contentType:'application/octet-stream',headers:{'content-disposition':'attachment; filename="'+u.pathname.slice(1)+'"'},body:'Explicit download-routing fixture, not an installable APK or readable PDF.'});
   if(u.origin!==ORIGIN){d.foreign.push(u.href);return r.abort();}
   if(u.pathname.startsWith('/browser/')){
    const isList=/^\/browser\/api\/list(?:\/[a-f0-9-]{36})?$/.test(u.pathname);
    if(m!=='GET'&&!(isList&&['POST','PATCH','DELETE'].includes(m)))throw Error('Only isolated list writes allowed');
    if(isList&&m!=='GET'){d.listWrites.push(m+' '+u.pathname);if(listHold)await new Promise(ok=>{listRelease=ok;});}
    if(u.pathname==='/browser/api/reader'&&hold)await new Promise(ok=>{release=ok;});
    const upstream='http://reader-edge:8080'+u.pathname+u.search;
    const headers={'x-forwarded-for':'100.64.10.20','x-forwarded-proto':'http',host:u.host,'accept-encoding':'identity'};
    const actual=await q.allHeaders();for(const k of ['origin','sec-fetch-site','content-type'])if(actual[k])headers[k]=actual[k];
    const t0=Date.now(),res=await proxyRequest(upstream,{method:m,headers,...(m==='GET'?{}:{body:q.postDataBuffer()})});
    if(u.pathname.includes('/api/'))d.readerTraffic.push({method:m,path:u.pathname+u.search,host:headers.host,origin:headers.origin,fetchSite:headers['sec-fetch-site'],status:res.status,ms:Date.now()-t0,...(res.status>=400?{error:res.body.toString().slice(0,2000)}:{})});
    return r.fulfill({status:res.status,headers:Object.fromEntries(Object.entries(res.headers).filter(([k])=>!['content-length','transfer-encoding','connection','content-encoding'].includes(k))),body:res.body});
   }
   if(u.pathname.startsWith('/wizard-os-home/')){
    const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';const f=path.resolve(WEB,rel);
    if(!f.startsWith(WEB+path.sep))return r.fulfill({status:403});
    if(fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({status:200,contentType:TYPES[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});
   }
   if(u.pathname.startsWith('/search/')){
    const name=u.pathname.slice('/search/'.length)||'index.html';const f={ 'index.html':'search-index.html','app.js':'search-app.js','app.css':'search-app.css','voice-input.js':'search-voice-input.js','api/config':'search-config.json','api/overview-provider':'search-overview-provider.json','api/web':'search-web.json' }[name];
    if(f)return r.fulfill({status:200,contentType:TYPES[path.extname(f)]||'text/plain',body:fs.readFileSync(path.join(QA,f))});
    if(name==='api/images')return json({q:'Wikipedia Reading',results:[]});
   }
   if(u.pathname==='/notes/')return r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><script src="/wizard-os-home/core/app-client.js"></script><h1>Internal Notes fixture</h1><script>WizardApp.ready({name:"Notes"})</script></html>'});
   if(m!=='GET'&&m!=='HEAD'){d.writes.push(m+' '+u.pathname);return json({error:'synthetic fixture refuses writes'},403);}
   if(u.pathname==='/wizard/v1/bootstrap')return json({bootstrap:1,api:'wizard-agent-service/1',settings:{owner:{name:'Synthetic Reader QA'},agent:{name:'Wizard'},clock:{timezone:'UTC',day_starts_at:'00:00'}},capabilities:{markdown:true,files:true},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs',apps:'/wizard/v1/apps'}});
   if(u.pathname==='/wizard/v1/apps')return json({apps});
   if(u.pathname==='/wizard/v1/setup')return json({first_run:false});
   if(u.pathname==='/wizard/v1/agents')return json({agents:[{id:'hermes',label:'Wizard',is_default:true,status:'running'}]});
   if(u.pathname==='/wizard/hermes/api/model/options')return json({model:'synthetic',provider:'synthetic',providers:[{slug:'synthetic',authenticated:true,auth_type:'api_key'}]});
   if(u.pathname==='/wizard/hermes/api/sessions')return json({data:[row],has_more:false});
   if(u.pathname===`/wizard/hermes/api/sessions/${SID}`)return json({session:row});
   if(u.pathname===`/wizard/hermes/api/sessions/${SID}/messages`)return json({object:'list',data:[{id:1,role:'user',content:'Reader release gate',timestamp:NOW/1000-60},{id:2,role:'assistant',content:MSG,timestamp:NOW/1000}],pagination:{returned:2}});
   if(u.pathname==='/wizard/thread-seen')return json({state:{initializedAt:1,threads:{}}});
   if(u.pathname.includes('/needs/'))return json({ready_to_open:true,models:[]});
   return json({});
  }catch(e){d.routeError=String(e);return r.fulfill({status:500,body:String(e)}).catch(()=>{});}
 });
 await ctx.addInitScript(({phone,skin,origin})=>{
  // CDP shares Chrome with Reader's sandboxed source pages. Seed only the
  // synthetic Wizard top frame, never those opaque-origin source documents.
  if(window!==window.top || location.origin!==origin)return;
  for(const [k,v]of Object.entries({'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':skin,'wux.shell':phone?'phone':'desktop','wux.desk.homeOpen':'false'}))localStorage.setItem(k,v);
  window.__qaNative=[];window.__qaFirstFrames=[];
  if(phone)window.WizardOSNative={openInBrowser:u=>__qaNative.push(['browser',u]),download:u=>__qaNative.push(['download',u])};
  document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;const href=a.href;requestAnimationFrame(()=>{
   const vis=el=>!!el&&getComputedStyle(el).display!=='none'&&el.getClientRects().length>0;
   __qaFirstFrames.push({href,at:performance.now(),veil:[...document.querySelectorAll('.frame-loading')].some(vis),readerFrames:[...document.querySelectorAll('iframe')].filter(f=>f.src.includes('/browser/?url=')).map(f=>({src:f.src,visible:vis(f)}))});
  });},true);
 },{phone,skin,origin:ORIGIN});
 const p=await ctx.newPage();p.on('pageerror',e=>d.pageErrors.push(e.message));p.on('console',m=>{if(['warning','error'].includes(m.type()))d.console.push({type:m.type(),text:m.text(),location:m.location()});});p.setDefaultTimeout(15000);
 await p.goto(ORIGIN+'/wizard-os-home/'+(phone?'?shell=phone':'desktop.html'));
 await p.waitForFunction(()=>window.WizCore&&WizCore.appsLoaded&&(window.__wux||window.__wos));
 await p.evaluate(()=>WizCore.appsLoaded());
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.shell),phone?'phone':'desktop');
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.skin),skin);
 await p.waitForFunction(()=>WizCore.apps('mobile').APP.browser?.url==='/browser/');
 return {ctx,p,d,hold:()=>{hold=true;},unhold:()=>{hold=false;release?.();release=null;},holdList:()=>{listHold=true;},unholdList:()=>{listHold=false;listRelease?.();listRelease=null;}};
}
async function chat(p,phone){await p.evaluate(({SID,phone})=>{const a=window.__wux||window.__wos;if(!phone)a.openThread(SID);else {const w=Object.values(a.wins).find(w=>w.app==='chats');a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.chats.openChat(w.id,SID);}}, {SID,phone});await p.locator(`.bub a[href="${target.url}"]`).first().waitFor({state:'visible'});}
// The newest Reader frame (a stale one left behind must never answer for a fresh tap).
const frame=p=>p.frames().filter(f=>{try{return new URL(f.url()||ORIGIN).pathname.startsWith('/browser/');}catch{return false;}}).at(-1);
const readerFor=(p,url)=>p.frames().find(f=>{try{const u=new URL(f.url()||ORIGIN);return u.pathname.startsWith('/browser/')&&u.searchParams.get('url')===url;}catch{return false;}});
// Reader frames still on screen for a link (after a hand-off James must be back in the chat, not on Reader).
const readerShown=(p,url)=>p.evaluate(url=>[...document.querySelectorAll('iframe')].some(f=>{let u;try{u=new URL(f.src,location.href);}catch{return false;}if(!u.pathname.startsWith('/browser/')||u.searchParams.get('url')!==url)return false;const r=f.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(f).visibility!=='hidden';}),url);
async function reader(p,url){await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/browser/?url=')));const until=Date.now()+10000;while(Date.now()<until){const f=url?readerFor(p,url):frame(p);if(f){await f.locator('#status').waitFor({state:'attached'});return f;}await new Promise(r=>setTimeout(r,50));}throw Error('Reader frame did not load');}
async function readDone(f){await f.waitForFunction(()=>document.querySelector('#status').hidden,null,{timeout:45000});assert.ok((await f.locator('#article').innerText()).length>150);}
async function back(p,phone){if(phone)await p.evaluate(()=>__wos.onBack());else await p.keyboard.press('Escape');await p.waitForTimeout(400);}
(async()=>{fs.mkdirSync(OUT,{recursive:true});try{
 // Chrome's DevTools rejects non-IP Host headers (HTTP 500); connect by IP like Reader's own chrome().
 // Pick a host the real Reader refuses as a bot wall from this network (GET only, no list write).
 const tried=[];for(const url of BLOCK_CANDIDATES){const t0=Date.now();const r=await proxyRequest('http://reader-edge:8080/browser/api/reader?url='+encodeURIComponent(url),{headers:{'x-forwarded-for':'100.64.10.20','x-forwarded-proto':'http',host:new URL(ORIGIN).host,'accept-encoding':'identity'}});let body={};try{body=JSON.parse(r.body.toString());}catch{}tried.push({url,status:r.status,reason:body.reason,handoff:body.handoff,ms:Date.now()-t0});if(body.handoff===true&&['blocked','signin'].includes(body.reason)){BLOCKED=url;break;}}
 blockedChoice={chosen:BLOCKED,tried};assert.ok(tried.some(t=>t.url===BLOCKED&&['blocked','signin'].includes(t.reason)),'No candidate is refused by the real Reader here: '+JSON.stringify(tried));
 assert.ok(tried.find(t=>t.url===BLOCKED).ms<3000,'bot wall must fail fast: '+JSON.stringify(tried));
 BLOCKED2=BLOCKED+'?second=1';MSG=message();row=makeRow();
 browser=await chromium.connectOverCDP('http://'+(await require('dns').promises.lookup('browser-engine')).address+':9222');
 for(const phone of [false,true])for(const skin of ['nebula','grove']){
  const tag=(phone?'phone':'desktop')+'-'+skin;let h;
  await test(tag+'-boot',async()=>{h=await boot(phone,skin);return{shell:phone?'phone':'desktop',skin};});
  if(!h)continue;const {p,ctx,d}=h;
  if(process.env.PERSISTENCE_ONLY){try{await test(tag+'-restart-persistence',async()=>{
   await p.evaluate(phone=>{const a=window.__wux||window.__wos;a.openApp(WizCore.apps(phone?'mobile':'desktop').APP.browser);},phone);
   await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/browser/')));
   const until=Date.now()+15000;let f;while(!f&&Date.now()<until){f=p.frames().find(x=>x.url().includes('/browser/'));if(!f)await p.waitForTimeout(50);}assert.ok(f);
   await f.locator('#unread .list-title').filter({hasText:'Experiments with Monstrousness'}).waitFor();
   await p.screenshot({path:path.join(OUT,tag+'-restart-persistence.png')});assert.deepEqual(d.pageErrors,[]);assert.equal(d.listWrites.length,0);return{title:await f.locator('#unread .list-title').innerText()};
  },p);}finally{await ctx.close();}continue;}
  try{
   await test(tag+'-chat-tap-first-frame',async()=>{await chat(p,phone);h.hold();await p.locator(`.bub a[href="${target.url}"]`).first().click();await p.waitForFunction(()=>__qaFirstFrames.length>0);d.firstFrames=await p.evaluate(()=>__qaFirstFrames);assert.ok(d.firstFrames.at(-1).veil||d.firstFrames.at(-1).readerFrames.some(f=>f.visible),JSON.stringify(d.firstFrames));const f=await reader(p);await f.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Reading '));await p.screenshot({path:path.join(OUT,tag+'-loading.png')});h.unhold();await readDone(f);if(phone){const coach=p.getByRole('dialog',{name:'Review mode',exact:true});await coach.getByRole('button',{name:'Got it',exact:true}).click();await coach.waitFor({state:'detached'});assert.equal(await p.locator('.rv-coach').count(),0);}await p.screenshot({path:path.join(OUT,tag+'-article.png')});assert.equal(p.url().startsWith(ORIGIN+'/wizard-os-home/'),true);assert.equal(ctx.pages().length,1);return{firstFrame:d.firstFrames.at(-1),title:await f.locator('#title').innerText()};},p);h.unhold();
   await test(tag+'-reading-list-save-reopen-read-remove',async()=>{
    const f=frame(p);assert.ok(f);await f.locator('#save:not([disabled])').waitFor();
    assert.equal(await f.locator('#save').getAttribute('aria-pressed'),'false');
    await f.evaluate(()=>{window.__savePaint=null;document.querySelector('#save').addEventListener('click',()=>requestAnimationFrame(()=>{window.__savePaint={pressed:document.querySelector('#save').getAttribute('aria-pressed'),label:document.querySelector('#save span').textContent,disabled:document.querySelector('#save').disabled};}),{once:true,capture:true});});
    assert.equal(await p.locator('.rv-coach').count(),0,'Save must receive the tap, not first-use coaching');
    h.holdList();if(phone)await f.locator('#save').tap();else await f.locator('#save').click();await f.waitForFunction(()=>window.__savePaint);
    const paint=await f.evaluate(()=>__savePaint);assert.deepEqual(paint,{pressed:'true',label:'Saved',disabled:true});
    await p.screenshot({path:path.join(OUT,tag+'-saved-first-paint.png')});h.unholdList();await f.locator('#save:not([disabled])').waitFor({timeout:60000});
    assert.equal(await f.locator('#save').getAttribute('aria-pressed'),'true','successful persistence must not roll Save back');
    assert.equal(d.readerTraffic.filter(r=>r.method==='POST'&&r.path==='/browser/api/list'&&r.status===200).length,1);
    await back(p,phone);await f.locator('#library').waitFor({state:'visible'});await f.locator('#unread .list-title').waitFor();
    assert.equal(new URL(f.url()).searchParams.has('url'),false,'Reading list root must not retain the previous article deep link');
    await p.screenshot({path:path.join(OUT,tag+'-reading-list.png')});
    await f.locator('#unread .list-open').click();await readDone(f);assert.equal(await f.locator('#save').getAttribute('aria-pressed'),'true');
    await p.screenshot({path:path.join(OUT,tag+'-list-reopened.png')});await back(p,phone);await f.locator('#library').waitFor({state:'visible'});
    await f.locator('#unread .item-menu summary').click();const menu=await f.locator('.item-actions').first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}));assert.ok(!menu.background.includes('rgba('),JSON.stringify(menu));
    await p.screenshot({path:path.join(OUT,tag+'-list-menu.png')});await f.locator('#list-title').click();assert.equal(await f.locator('.item-menu').first().getAttribute('open'),null);
    await f.locator('#unread .item-menu summary').click();await back(p,phone);assert.equal(await f.locator('.item-menu').first().getAttribute('open'),null);
    await f.locator('#unread .item-menu summary').click();await f.getByRole('button',{name:'Mark read',exact:true}).click();
    await f.waitForFunction(()=>document.querySelector('#unread').children.length===0 && !document.querySelector('#read-section').hidden);
    assert.equal(await f.locator('#read-section').getAttribute('open'),null);await p.screenshot({path:path.join(OUT,tag+'-marked-read-collapsed.png')});
    await f.locator('#read-section>summary').click();await f.locator('#read-items .item-actions button:not([disabled])').first().waitFor({state:'attached'});
    await f.locator('#read-items .item-menu summary').click();await f.getByRole('button',{name:'Remove',exact:true}).click();
    await f.waitForFunction(()=>document.querySelector('#read-items').children.length===0 && document.querySelector('#read-section').hidden);
    await p.screenshot({path:path.join(OUT,tag+'-removed.png')});
    await p.waitForFunction(()=>true); // readback below waits for the actual DELETE, not only optimistic DOM.
    const until=Date.now()+10000;let remaining;do{remaining=(await (await fetch('http://browser:9222/api/list')).json()).items;if(!remaining.length)break;await p.waitForTimeout(100);}while(Date.now()<until);assert.deepEqual(remaining,[]);
    await f.locator('#url').fill(target.url);await f.locator('#address button').click();await readDone(f);return{paint,menu,listWrites:d.listWrites};
   },p);h.unholdList();
   await test(tag+'-live-skin-change',async()=>{const f=frame(p);assert.ok(f);const before=await f.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--wz-text'));await p.evaluate(()=>WosSkin.set('ember'));await f.waitForFunction(v=>getComputedStyle(document.documentElement).getPropertyValue('--wz-text')!==v,before);await p.screenshot({path:path.join(OUT,tag+'-live-ember.png')});return{before,after:await f.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--wz-text'))};},p);
   await test(tag+'-back-closes-not-exits',async()=>{const url=p.url();await back(p,phone);assert.equal(p.url(),url);await frame(p).locator('#library').waitFor({state:'visible'});await back(p,phone);await p.locator(`.bub a[href="${target.url}"]`).first().waitFor({state:'visible'});assert.equal(ctx.pages().length,1);return{outerUrl:p.url()};},p);
   await test(tag+'-pdf-apk-download',async()=>{const downloaded=[];for(const ext of ['pdf','apk']){if(phone)await p.locator(`.bub a[href$=".${ext}"]`).first().click();else{const pending=p.waitForEvent('download');await p.locator(`.bub a[href$=".${ext}"]`).first().click();const file=await pending;assert.equal(file.suggestedFilename(),'reader.'+ext);assert.equal(await file.failure(),null);downloaded.push(file.suggestedFilename());}}const calls=await p.evaluate(()=>__qaNative);if(phone){assert.ok(calls.some(c=>c[0]==='download'&&c[1].endsWith('.pdf')),JSON.stringify(calls));assert.ok(calls.some(c=>c[0]==='download'&&c[1].endsWith('.apk')),JSON.stringify(calls));}else assert.deepEqual(downloaded,['reader.pdf','reader.apk']);return{nativeDownloads:calls,browserDownloads:downloaded};},p);
   await test(tag+'-internal-link-unchanged',async()=>{await p.locator('.bub a[href="/notes/"]').first().click();await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>new URL(f.src).pathname==='/notes/'));assert.ok(!p.frames().some(f=>new URL(f.url()||ORIGIN).pathname==='/browser/'&&new URL(f.url()).searchParams.get('url')?.includes('/notes/')));await p.screenshot({path:path.join(OUT,tag+'-internal-notes.png')});await back(p,phone);},p);
   await test(tag+'-chat-tap-blocked-host-one-tap',async()=>{
    await p.evaluate(()=>{localStorage.removeItem('wos.readerDirect.v1');__qaNative.length=0;});await chat(p,phone);
    // Earlier PDF/APK download tests legitimately leave their own tabs: count only what THIS tap opens.
    const pagesBefore=ctx.pages().length;
    const link=p.locator(`.bub a[href="${BLOCKED}"]`).first();await link.waitFor({state:'visible'});
    const before=d.readerTraffic.length,popup=phone?null:ctx.waitForEvent('page',{timeout:20000}),t0=Date.now();
    await link.click();
    if(phone)await p.waitForFunction(u=>__qaNative.some(c=>c[0]==='browser'&&c[1]===u),BLOCKED,{timeout:20000});
    else{const pg=await popup;assert.equal(ctx.pages().length,pagesBefore+1,'desktop: exactly one new tab for the original');await p.waitForTimeout(300);await pg.close();}
    const handoffMs=Date.now()-t0;
    const api=d.readerTraffic.slice(before).filter(r=>r.path.startsWith('/browser/api/reader'));
    assert.equal(api.length,1,JSON.stringify(api));assert.equal(api[0].status,422);const body=JSON.parse(api[0].error);
    assert.ok(body.handoff===true&&['blocked','signin'].includes(body.reason),JSON.stringify(body));assert.ok(api[0].ms<3000,'bot wall must fail in ~1 s: '+api[0].ms);
    if(!phone)assert.ok(d.foreign.some(u=>u===BLOCKED),'desktop opened the original tab on the first tap: '+JSON.stringify(d.foreign));
    // Opened from a chat link: the owner is back where they tapped, as before Reader (phone: the Reader desk closed;
    // desktop: the Reader preview window closed), with no Reader fallback page left on screen.
    await p.locator(`.bub a[href="${BLOCKED}"]`).first().waitFor({state:'visible',timeout:10000});
    await p.waitForFunction(u=>![...document.querySelectorAll('iframe')].some(f=>{let x;try{x=new URL(f.src,location.href);}catch{return false;}const r=f.getBoundingClientRect();return x.pathname.startsWith('/browser/')&&x.searchParams.get('url')===u&&r.width>0&&r.height>0;}),BLOCKED,{timeout:5000});
    assert.equal(await readerShown(p,BLOCKED),false,'Reader must not stay open after the hand-off');await p.waitForTimeout(400);
    await p.screenshot({path:path.join(OUT,tag+'-blocked-handoff.png')});
    const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('wos.readerDirect.v1')||'{}'));assert.deepEqual(Object.keys(stored),[new URL(BLOCKED).hostname]);
    // Next link to that host: straight to the browser, Reader is not asked again.
    const before2=d.readerTraffic.length,popup2=phone?null:ctx.waitForEvent('page',{timeout:10000}),t1=Date.now();
    await p.locator(`.bub a[href="${BLOCKED2}"]`).first().click();
    if(phone)await p.waitForFunction(u=>__qaNative.some(c=>c[0]==='browser'&&c[1]===u),BLOCKED2,{timeout:10000});else{const pg=await popup2;assert.equal(ctx.pages().length,pagesBefore+1);await pg.close();}
    const directMs=Date.now()-t1;assert.equal(d.readerTraffic.slice(before2).filter(r=>r.path.startsWith('/browser/api/reader')).length,0);
    assert.equal(await readerShown(p,BLOCKED2),false);
    assert.equal(ctx.pages().length,pagesBefore,'every tab this test opened is closed; none other appeared');return{blocked:BLOCKED,reason:body.reason,readerMs:api[0].ms,handoffMs,directMs,native:await p.evaluate(()=>__qaNative.slice())};
   },p);
   await test(tag+'-chat-tap-wizard-own-page-skips-reader',async()=>{
    // Each step starts from the chat (a failed step before must not cover this link).
    await chat(p,phone);await p.evaluate(()=>{__qaNative.length=0;});const before=d.readerTraffic.length,foreign=d.foreign.length,pagesBefore=ctx.pages().length;
    const popup=phone?null:ctx.waitForEvent('page',{timeout:10000});
    await p.locator(`.bub a[href="${OWN}"]`).first().click();
    // Pre-Reader behaviour for another origin: phone hands it to the native browser, desktop opens one new tab.
    if(phone)await p.waitForFunction(u=>__qaNative.some(c=>c[0]==='browser'&&c[1]===u),OWN,{timeout:10000});else{const pg=await popup;assert.equal(ctx.pages().length,pagesBefore+1);await p.waitForTimeout(300);await pg.close();}
    assert.equal(d.readerTraffic.slice(before).filter(r=>r.path.startsWith('/browser/api/reader')).length,0,'Wizard own page must never reach Reader');
    assert.ok(!p.frames().some(f=>{try{return (new URL(f.url()).searchParams.get('url')||'').includes('wizard.aiwizards.com');}catch{return false;}}));
    if(!phone)assert.ok(d.foreign.slice(foreign).some(u=>u.startsWith('https://wizard.aiwizards.com/clips-pipeline/')),JSON.stringify(d.foreign.slice(foreign)));
    await p.screenshot({path:path.join(OUT,tag+'-own-page-direct.png')});assert.equal(ctx.pages().length,pagesBefore);
    return{own:OWN,native:await p.evaluate(()=>__qaNative.slice())};
   },p);
   await test(tag+'-genuine-search-result-tap',async()=>{await p.evaluate(phone=>{const a=window.__wux||window.__wos;a.openApp(WizCore.apps(phone?'mobile':'desktop').APP['wizard-search']);},phone);await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/search/')));const until=Date.now()+10000;let f;while(!f&&Date.now()<until){f=p.frames().find(f=>f.url().includes('/search/'));await p.waitForTimeout(50);}assert.ok(f);await f.locator('#q').fill('Wikipedia Reading');await f.locator('#q').press('Enter');await f.locator(`#web a[href="${target.url}"]`).waitFor({state:'visible'});await p.screenshot({path:path.join(OUT,tag+'-search-results.png')});const pagesBefore=ctx.pages().length;await f.locator(`#web a[href="${target.url}"]`).click();const t0=Date.now();const rf=await reader(p,target.url);await readDone(rf);const readMs=Date.now()-t0;await p.screenshot({path:path.join(OUT,tag+'-search-reader.png')});assert.equal(ctx.pages().length,pagesBefore,'Search result tap must not open a new tab');return{url:target.url,title:await rf.locator('#title').innerText(),provider:search.source,readMs};},p);
   await test(tag+'-defuddle-real-articles',async()=>{
    const f=frame(p);assert.ok(f);const pages=[];
    await p.evaluate(skin=>WosSkin.set(skin),skin);
    await p.waitForFunction(skin=>document.documentElement.dataset.skin===skin,skin);
    await f.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    for(const [name,url,bodyPattern] of [
     ['github-pr','https://github.com/humanitylabs-org/wizard-ux/pull/1023',/What and why/],
     ['rao','https://contraptions.venkateshrao.com/p/experiments-with-monstrousness',/cognitive mercantilism/i]
    ]) {
     await f.locator('#url').fill(url);await f.locator('#address button').click();await readDone(f);
     const text=await f.locator('#article').innerText();assert.match(text,bodyPattern);
     if(name==='github-pr')assert.doesNotMatch(text,/Codex Review|Navigation Menu|Skip to content/);
     const width=await f.evaluate(()=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,pre:[...document.querySelectorAll('#article pre')].map(el=>getComputedStyle(el).overflowX),tables:[...document.querySelectorAll('#article table')].map(el=>getComputedStyle(el).overflowX)}));
     assert.ok(width.scroll<=width.viewport+2,JSON.stringify(width));
     await p.screenshot({path:path.join(OUT,tag+'-defuddle-'+name+'.png')});
     pages.push({url,title:await f.locator('#title').innerText(),byline:await f.locator('#byline').innerText(),width});
    }
    return{pages};
   },p);
   await test(tag+'-no-page-errors',async()=>{assert.deepEqual(d.pageErrors,[]);assert.ok(!d.routeError,d.routeError);return{blockedOwnerWrites:d.writes,foreignRequestsBlocked:d.foreign};},p);
  }finally{h.unhold();h.unholdList();await ctx.close();save();}
 }
 await test('standalone-dark-fallback',async()=>{const ctx=await browser.newContext({viewport:{width:1000,height:800}});try{const p=await ctx.newPage();await p.goto('http://browser:9222/');await p.locator('#library').waitFor();const color=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);const values=color.match(/[\d.]+/g).map(Number);assert.ok(Math.max(...values.slice(0,3))<80,color);await p.screenshot({path:path.join(OUT,'standalone-dark-reading-list.png')});return{background:color};}finally{await ctx.close();}});
}finally{if(browser)await browser.close();save();}if(results.some(r=>!r.ok))process.exitCode=1;})().catch(e=>{console.error(e);results.push({name:'fatal',ok:false,error:String(e),stack:e.stack});save();process.exitCode=1;});
