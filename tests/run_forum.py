"""Run only through wizard_heavy_submit(host='forum', lane='light').
Build/test candidate sources; never publish, update live services or claim in-shell acceptance.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
work = root.parent
out = work / 'evidence'
out.mkdir(exist_ok=True)
out.chmod(0o777)
results = []
env = {**os.environ, 'APP_PORT': '18977'}


def run(name, argv, cwd=root, timeout=360):
    started = time.time()
    with (out / (name + '.log')).open('w') as log:
        try:
            p = subprocess.run(argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            code = p.returncode
        except subprocess.TimeoutExpired:
            code = 124
    results.append({'name': name, 'exit_code': code, 'seconds': round(time.time() - started, 2), 'argv': argv})
    (out / 'steps.json').write_text(json.dumps(results, indent=2))
    print(name, code, flush=True)
    return code == 0


revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(out / 'source.json').write_text(json.dumps({d: subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=work/d, text=True).strip() for d in ['browser', 'ux', 'ux-main', 'store']}, indent=2))
built = run('image-build', ['docker', 'build', '--label', 'org.opencontainers.image.source=https://github.com/humanitylabs-org/browser', '--label', 'org.opencontainers.image.revision=' + revision, '-t', 'wizard-browser-reader:qa', 'reader'], timeout=360)
run('front-tests', ['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'])
run('inline-check', ['python3', 'mcp/inline.py', '--check'])
if built:
    run('reader-tests', ['docker', 'run', '--rm', '--network', 'none', 'wizard-browser-reader:qa', 'npm', 'test'])
    # The UX suite assumes a writable git checkout; this sandbox is read-only without git, so some
    # tests fail here for environmental reasons. Each candidate is judged only against its own
    # unchanged base run in the identical sandbox: a failure the base does not have is a regression.
    def ux(name, d):
        log = out / (name + '.tap')
        with log.open('w') as f:
            p = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '-v', str(work/d) + ':/work:ro', '-w', '/work', 'wizard-browser-reader:qa', 'sh', '-c', 'node --test tests/*.test.mjs'], stdout=f, stderr=subprocess.STDOUT, timeout=240)
        return log
    pairs = [('ux', 'ux-base'), ('ux-main', 'ux-main-base')]
    for cand, base in pairs:
        if (work/cand).exists() and (work/base).exists():
            ux(cand + '-tests', cand); ux(base + '-tests', base)
            run(cand + '-regressions', ['python3', str(root/'tests/compare_tap.py'), str(out/(base + '-tests.tap')), str(out/(cand + '-tests.tap'))])
    run('store-tests', ['docker', 'run', '--rm', '-v', str(work/'store') + ':/work', '-w', '/work', 'node:22.22.3-bookworm-slim', 'sh', '-c', 'npm ci && ./node_modules/.bin/bun test'], timeout=240)
    override = out / 'compose.json'
    override.write_text(json.dumps({'services': {'browser-reader': {'image': 'wizard-browser-reader:qa'}}}))
    compose = ['docker', 'compose', '-p', 'browser-reader-qa', '-f', str(root/'runtipi/docker-compose.yml'), '-f', str(override)]
    try:
        if run('compose-up', compose + ['up', '-d', '--wait', '--wait-timeout', '90'], timeout=180):
            # A bounded readiness check inside this admitted job, not a conversation polling loop.
            for _ in range(30):
                ready = subprocess.run(['docker', 'compose', '-p', 'browser-reader-qa', '-f', str(root/'runtipi/docker-compose.yml'), '-f', str(override), 'exec', '-T', 'browser-reader', 'node', '-e', "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            run('integration', ['docker', 'run', '--rm', '--network', 'browser-reader-qa_default', '-e', 'UPSTREAM_HOST=browser-engine', '-e', 'EVIDENCE=/evidence', '-v', str(root/'tests') + ':/opt/qa:ro', '-v', str(out) + ':/evidence', 'wizard-browser-reader:qa', 'node', '/opt/qa/integration.mjs'], timeout=300)
    finally:
        run('compose-logs', compose + ['logs', '--no-color'], timeout=20)
        run('compose-down', compose + ['down', '-v'], timeout=30)
    run('image-readback', ['docker', 'image', 'inspect', 'wizard-browser-reader:qa'], timeout=20)
print(json.dumps(results, indent=2))
sys.exit(1 if any(r['exit_code'] != 0 for r in results) else 0)
