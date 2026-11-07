import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';
import {extract,cleanArticle} from '../article.mjs';
const root=new URL('./fixtures/corpus/',import.meta.url);
const rows=JSON.parse(readFileSync(new URL('manifest.json',root)));
const expected={
 'github-pr':{body:/What and why/,author:/defleur-agents/,no:/Codex Review|Navigation Menu|You signed in|Skip to content/,heading:/Verified/},
 'github-issue':{body:/null-prototype/,author:/TIMMLOPK/,no:/Navigation Menu|Skip to content/},
 'github-readme':{body:/remove unnecessary elements/,no:/Navigation Menu|Skip to content|You signed in/},
 rao:{body:/cognitive mercantilism/i,author:/Venkatesh Rao/,no:/SubscribeSign in|Upgrade to paid/},
 wikipedia:{body:/Reading is the process/,author:/Wikipedia/,no:/Toggle the table of contents|Personal tools/},
 hackernews:{body:/Dropbox|dropbox/,author:/dhouston/,no:/new \| past \| comments/},
 news:{body:/Artemis/,author:/Lee Mohon/,no:/NASA\.gov menu|Search NASA\.gov/},
 docs:{body:/Welcome to the React documentation/,no:/Search documentation/},
};
const report=[];
const stats=html=>{const dom=new JSDOM(html || '');const d=dom.window.document;const value={words:d.body.textContent.trim().split(/\s+/).filter(Boolean).length,headings:d.querySelectorAll('h1,h2,h3,h4,h5,h6').length,lists:d.querySelectorAll('ul,ol').length,code:d.querySelectorAll('pre').length,tables:d.querySelectorAll('table').length};dom.window.close();return value;};
for(const row of rows) {
 const checks=expected[row.id];
 test('real-site corpus: '+row.id,{skip:!row.file ? row.blocked : !checks ? 'Captured X HTML is a nonstandard unauthenticated shell, not a supported tweet DOM; not counted as validated.' : false},async()=>{
  const source=readFileSync(new URL(row.file,root),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),row.sha256);
  let a;
  if(process.env.READER_CORPUS_BASE){const r=await fetch(process.env.READER_CORPUS_BASE+'/api/reader?url='+encodeURIComponent(row.url));assert.equal(r.status,200);a=await r.json();}
  else a=extract(source,row.finalURL || row.url);
  assert.ok(a.title.trim());assert.ok(a.siteName.trim());assert.equal(typeof a.byline,'string');
  if(checks.author)assert.match(a.byline,checks.author);
  const dom=new JSDOM(a.html);const d=dom.window.document,text=d.body.textContent;
  assert.match(text,checks.body);assert.doesNotMatch(text,checks.no);if(checks.heading)assert.match(text,checks.heading);
  assert.equal(d.querySelectorAll('script,style,iframe,form,nav,[onclick],[onerror],[srcset]').length,0);
  for(const image of d.querySelectorAll('img'))assert.match(image.getAttribute('src'),/^api\/image\?url=/);
  assert.ok([...d.querySelectorAll('p,pre,li')].some(el=>el.textContent.trim().length>20));
  assert.equal(a.extractor,'defuddle','Corpus must exercise Defuddle, not silently fall back');
  const oldDOM=new JSDOM(source,{url:row.url});const old=new Readability(oldDOM.window.document,{maxElemsToParse:50000,charThreshold:150}).parse();
  const before=stats(old?.content ? cleanArticle(old.content,row.url):'');const after=stats(a.html);
  report.push({id:row.id,before,after,author:a.byline || '(not supplied by source)',extractor:a.extractor});
  dom.window.close();oldDOM.window.close();
 });
}
test.after(()=>{
 if(!process.env.READER_CORPUS_REPORT)return;
 const lines=['# Reader corpus: Readability → Defuddle','', 'Captured 6 November 2026. Offline HTML, SHA-256 checked; network is opt-in. Counts are whitespace-delimited sanitized body words, not library-specific word-count algorithms.','', '| Source | Words before → after | Headings | Lists | Code blocks | Tables | Author |','|---|---:|---:|---:|---:|---:|---|',...report.map(r=>`| ${r.id} | ${r.before.words} → ${r.after.words} | ${r.before.headings} → ${r.after.headings} | ${r.before.lists} → ${r.after.lists} | ${r.before.code} → ${r.after.code} | ${r.before.tables} → ${r.after.tables} | ${r.author} |`),'','GitHub PR now contains the description, not Codex review/comment tables; GitHub replies are excluded by the library option. HN retains library-extracted discussion replies. Authors are asserted where supplied; README/docs do not name an author, and no person is invented.','', 'Reddit: public HTML blocked with HTTP 403 from this host. X: captured HTTP 200, but the unauthenticated HTML is not the tweet DOM expected by Defuddle; not claimed as a passing extraction. These are explicit skipped coverage, not synthetic fixtures.','', 'All responses still cross the unchanged DOMPurify allowlist. Footnote markers/text and plain-text math survive; fragment IDs, MathML/SVG and remote math renderers remain intentionally excluded by the original security policy.'];
 writeFileSync(new URL('../../docs/defuddle-corpus.md',import.meta.url),lines.join('\n')+'\n');
 writeFileSync(new URL('../../docs/defuddle-corpus.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
});
