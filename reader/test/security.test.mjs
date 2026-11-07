import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {destination,publicIP,safeFetch,UnsafeURL} from '../network.mjs';
import {cleanArticle,extract} from '../article.mjs';
import {JSDOM} from 'jsdom';

for(const url of ['http://127.0.0.1','http://localhost','http://169.254.169.254/latest/meta-data','http://10.2.3.4','http://100.64.1.1','http://browser-engine','http://runtipi','file:///etc/passwd','http://[::1]','http://[fc00::1]','http://[fe80::1]','http://[::ffff:127.0.0.1]','http://2130706433','http://0x7f000001','http://127.1','http://user:pass@example.com','http://service.internal']) {
  test('reject '+url,async()=>assert.rejects(destination(url),UnsafeURL));
}
test('special-use and reserved address families are rejected',()=>{
  for(const ip of ['0.0.0.0','192.168.0.1','172.16.0.1','224.0.0.1','192.0.2.1','100.127.255.255','::','2001:db8::1','ff02::1']) assert.equal(publicIP(ip),false,ip);
  assert.equal(publicIP('1.1.1.1'),true); assert.equal(publicIP('2606:4700:4700::1111'),true);
});
test('mixed DNS answers fail closed',async()=>assert.rejects(destination('https://example.com',async()=>[{address:'1.1.1.1',family:4},{address:'10.1.1.1',family:4}]),UnsafeURL));
test('DNS connection is pinned and public redirect to localhost is refused',async t=>{
  let lookups=0, requests=0;
  t.mock.method(http,'request',(url,opts,done)=>{
    requests++;
    opts.lookup('example.com',{},(error,address)=>{assert.equal(address,'1.1.1.1');assert.equal(error,null);});
    const req=new EventEmitter();req.end=()=>{
      const res=new EventEmitter();Object.assign(res,{statusCode:302,headers:{location:'http://127.0.0.1/secret'},destroy(){}});done(res);
    };return req;
  });
  await assert.rejects(safeFetch('http://example.com/redirect',{lookup:async()=>{lookups++;return [{address:'1.1.1.1',family:4}];}}),UnsafeURL);
  assert.equal(requests,1);assert.equal(lookups,1);
});
test('render-path fetch (follow:false) refuses a redirect into a private address before Chrome sees it',async t=>{
  t.mock.method(http,'request',(url,opts,done)=>{
    const req=new EventEmitter();req.end=()=>{
      const res=new EventEmitter();Object.assign(res,{statusCode:302,headers:{location:'http://10.2.3.4/'},destroy(){}});done(res);
    };return req;
  });
  await assert.rejects(safeFetch('http://example.com/r',{follow:false,lookup:async()=>[{address:'1.1.1.1',family:4}]}),UnsafeURL);
});
test('responsive images keep one proxied src and lose srcset/source',()=>{
  const html=cleanArticle('<picture><source srcset="https://i.example/a.webp 1x, https://i.example/b.webp 2x"><img alt="a"></picture><img srcset="https://i.example/c.jpg 600w, https://i.example/d.jpg 1200w">','https://example.com/');
  const doc=new JSDOM(html).window.document;
  assert.deepEqual([...doc.querySelectorAll('img')].map(i=>i.getAttribute('src')),['api/image?url=https%3A%2F%2Fi.example%2Fa.webp','api/image?url=https%3A%2F%2Fi.example%2Fc.jpg']);
  assert.equal(doc.querySelectorAll('picture,source,[srcset]').length,0);
});
test('site name comes from og:site_name, else the title suffix, never the publisher org',()=>{
  const body='<article><p>'+'Readable words here. '.repeat(30)+'</p></article>';
  const a=extract('<html><head><title>Readability - Wikipedia</title><script type="application/ld+json">{"publisher":{"name":"Wikimedia Foundation, Inc."}}</script><link rel="icon" href="/x.svg"><link rel="apple-touch-icon" href="/t.png"></head><body>'+body+'</body></html>','https://en.wikipedia.org/wiki/Readability');
  assert.equal(a.siteName,'Wikipedia');
  const s=extract('<html><head><title>The Shape of the Thing - by Ethan Mollick</title></head><body>'+body+'</body></html>','https://www.oneusefulthing.org/p/x');
  assert.notEqual(s.siteName,'by Ethan Mollick');
  assert.equal(a.favicon,'api/image?url='+encodeURIComponent('https://en.wikipedia.org/t.png'));
});
test('all active content and remote resource attributes are removed',()=>{
 const html=cleanArticle(`<script>window.pwned=true</script><script src="https://evil.example/a.js"></script><p style="background:url(https://evil.example/steal)">Body</p><img src="https://example.com/x.png" onerror="window.pwned=true" srcset="https://evil.example/a 2x"><iframe src="http://localhost"></iframe><form><input autofocus onfocus="window.pwned=true"></form><a href="javascript:window.pwned=true">Bad</a><a href="https://example.com/next">Next</a><svg onload="window.pwned=true"></svg>`, 'https://example.com/');
 const dom=new JSDOM(html,{url:'https://wizard.example/apps/browser/',runScripts:'dangerously'});
 assert.equal(dom.window.pwned,undefined);
 const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('script,iframe,form,input,svg,[style],[onerror],[srcset],[onfocus]').length,0);
 assert.equal(doc.querySelector('img').getAttribute('src'),'api/image?url=https%3A%2F%2Fexample.com%2Fx.png');
 assert.equal(doc.querySelectorAll('a[href]').length,1);
 assert.equal(doc.querySelector('a[href]').getAttribute('href'),'?url=https%3A%2F%2Fexample.com%2Fnext');dom.window.close();
});
test('Readability keeps article metadata and no source scripts execute in parsing',()=>{
 const article=extract(`<html><head><title>Test article</title><meta property="og:site_name" content="Example"><meta property="article:published_time" content="2026-11-05"><link rel="icon" href="/logo.png"></head><body><article><h1>Test article</h1><p>${'This is a readable paragraph about the world. '.repeat(20)}</p><img src="/photo.jpg"></article><script>throw Error('source script executed')</script></body></html>`,'https://example.com/article');
 assert.match(article.title,/Test article/);assert.equal(article.siteName,'Example');assert.equal(article.publishedTime,'2026-11-05');assert.match(article.favicon,/api\/image/);assert.match(article.html,/api\/image/);assert.doesNotMatch(article.html,/<script/);
});
