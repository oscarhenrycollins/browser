"""Publishing guard: the exact declared Reader image must be immutable and multiarch."""
import json
from pathlib import Path
import re
import subprocess

compose = (Path(__file__).parents[1] / 'runtipi/docker-compose.yml').read_text()
match = re.search(r'^    image: (ghcr\.io/humanitylabs-org/browser-reader:[^\s]+)', compose, re.M)
if not match:
    raise SystemExit('Reader image is missing')
image = match[1]
if not re.search(r'@sha256:[a-f0-9]{64}$', image):
    raise SystemExit('Pin the verified Reader manifest digest before publishing')
data = json.loads(subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', '--raw', image], text=True))
architectures = {m.get('platform', {}).get('architecture') for m in data.get('manifests', []) if m.get('platform', {}).get('os') == 'linux'}
if not {'amd64', 'arm64'} <= architectures:
    raise SystemExit('The exact Reader manifest must contain linux/amd64 and linux/arm64')
print(json.dumps({'image': image, 'architectures': sorted(architectures)}))
