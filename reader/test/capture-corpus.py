"""Opt-in network capture; never runs during npm test. Preserve raw responses and status.
Usage: python3 test/capture-corpus.py [--refresh]
"""
import concurrent.futures,datetime,hashlib,json,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).parent/'fixtures/corpus';ROOT.mkdir(parents=True,exist_ok=True)
SITES=[
 ('github-pr','https://github.com/humanitylabs-org/wizard-ux/pull/1023'),
 ('github-issue','https://github.com/react/react/issues/38119'),
 ('github-readme','https://github.com/kepano/defuddle'),
 ('rao','https://contraptions.venkateshrao.com/p/experiments-with-monstrousness'),
 ('wikipedia','https://en.wikipedia.org/wiki/Reading'),
 ('reddit','https://www.reddit.com/r/programming/comments/1j1u2vn/'),
 ('x','https://x.com/jack/status/20'),
 ('hackernews','https://news.ycombinator.com/item?id=8863'),
 ('news','https://www.nasa.gov/missions/artemis/nasa-shares-plans-to-accelerate-artemis-return-to-moon/'),
 ('docs','https://react.dev/learn')]
def capture(pair):
 key,url=pair; row={'id':key,'url':url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36','Accept':'text/html'})
  with urllib.request.urlopen(request,timeout=45) as response:
   data=response.read(8*1024*1024);row.update(status=response.status,finalURL=response.url)
  (ROOT/(key+'.html')).write_bytes(data);row.update(file=key+'.html',sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))
 except Exception as error:row.update(blocked=str(error))
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: rows=list(pool.map(capture,SITES))
(ROOT/'manifest.json').write_text(json.dumps(rows,indent=2)+'\n')
for row in rows:print(row)
