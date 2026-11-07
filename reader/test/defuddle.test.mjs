import test from 'node:test';
import assert from 'node:assert/strict';
import {DefuddleClass} from 'defuddle/node';
import {JSDOM} from 'jsdom';
import {extract,cleanArticle} from '../article.mjs';
const body='<article><h1>A real article</h1><p>'+'Meaningful content about reading and the world. '.repeat(30)+'</p></article>';
for(const [name,result] of [['empty',{content:''}],['only active content',{content:'<script>'+'evil '.repeat(100)+'</script>'}],['exception',null]]) {
 test('Readability fallback on '+name,t=>{
  t.mock.method(DefuddleClass.prototype,'parse',()=>{if(result===null)throw Error('bad page');return result;});
  const article=extract('<title>A real article</title>'+body,'https://example.com/article');
  assert.equal(article.extractor,'readability');assert.match(article.html,/Meaningful content/);
 });
}
test('Defuddle HTML goes through the unchanged sanitizer after extraction',t=>{
 t.mock.method(DefuddleClass.prototype,'parse',()=>({title:'Untrusted title',author:'Author',site:'Example',published:'2026-11-06',description:'Description',image:'https://example.com/image.jpg',content:body+'<script src="https://evil.test/x"></script><iframe src="https://evil.test/"></iframe><p style="color:red" onclick="bad()">Hi</p><a href="https://example.com/next">Next</a><img src="https://example.com/a.png" onerror="bad()">'}));
 const a=extract(body,'https://example.com/article');
 assert.equal(a.extractor,'defuddle');assert.equal(a.byline,'Author');assert.equal(a.description,'Description');assert.match(a.image,/^api\/image\?url=/);
 assert.doesNotMatch(a.html,/<script|<iframe|onclick|onerror|style=/);assert.match(a.html,/href="\?url=/);assert.match(a.html,/src="api\/image\?url=/);
});
test('DOM extraction never calls global fetch or executes page JavaScript',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('Network bypass');});
 const a=extract('<title>Network isolation</title>'+body+'<script>globalThis.__sourceRan=true;fetch("http://127.0.0.1/")</script>','https://example.com/article');
 assert.equal(a.extractor,'defuddle');assert.equal(globalThis.__sourceRan,undefined);
});
test('Defuddle favicon metadata uses the guarded bitmap proxy, with SVG fallback',t=>{
 const parse=t.mock.method(DefuddleClass.prototype,'parse',()=>({title:'Article',content:body,favicon:'https://example.com/library.png'}));
 assert.equal(extract(body,'https://example.com/article').favicon,'api/image?url=https%3A%2F%2Fexample.com%2Flibrary.png');
 parse.mock.mockImplementation(()=>({title:'Article',content:body,favicon:'https://example.com/vector.svg'}));
 assert.equal(extract(body,'https://example.com/article').favicon,'api/image?url=https%3A%2F%2Fexample.com%2Ffavicon.ico');
});
test('empty pages fail instead of returning an empty article',()=>assert.throws(()=>extract('<title>Empty</title><body></body>','https://example.com/'),/could not find/));
test('code, tables, footnote text, math text and lists survive inert HTML cleanup',()=>{
 const html=cleanArticle('<pre><code>const answer = 42;\nconsole.log(answer);</code></pre><table><tr><th>Item</th><td>Value</td></tr></table><p>Formula <code>E = mc^2</code><sup>1</sup></p><ol><li>Footnote text</li></ol><ul><li>List text</li></ul>','https://example.com/');
 const dom=new JSDOM(html);const d=dom.window.document;
 for(const selector of ['pre code','table th','table td','sup','ol li','ul li'])assert.ok(d.querySelector(selector),selector);
 assert.match(d.body.textContent,/E = mc\^2/);dom.window.close();
});
