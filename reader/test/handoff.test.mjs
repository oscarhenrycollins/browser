import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadFailure,documentVerdict,failure,signinURL} from '../handoff.mjs';
import {UnsafeURL} from '../network.mjs';
const html=(s,type='text/html; charset=utf-8')=>({headers:{'content-type':type},body:Buffer.from(s)});
const reason=r=>documentVerdict(r)?.reason ?? null;
// Captured live from the Reader VPS, 7 Nov 2026: reuters 401, reddit/ddproperty 403, Wizard pages behind Cloudflare Access.
test('bot walls and refusals stop on the first main-document response',()=>{
  for(const status of [401,403,407,429,451]) assert.equal(reason({status,...html('<html>blocked</html>')}),'blocked',String(status));
  assert.equal(reason({status:503,headers:{'cf-mitigated':'challenge','content-type':'text/html'},body:Buffer.alloc(0)}),'blocked');
  assert.equal(reason({status:401,headers:{'www-authenticate':'Basic realm="x"'},body:Buffer.alloc(0)}),'signin');
});
test('interstitial challenge pages are blocked, ordinary pages with bot-management tags are not',()=>{
  for(const page of ['<title>Just a moment...</title>','<script>window._cf_chl_opt={}</script>','<iframe src="https://geo.captcha-delivery.com/captcha/?x"></iframe>','<div id="px-captcha"></div>','Request unsuccessful. Incapsula incident ID: 1'])
    assert.equal(reason({status:200,...html(page)}),'blocked',page);
  assert.equal(reason({status:200,...html('<title>News</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script src="https://js.datadome.co/tags.js"></script><article>Body</article>')}),null);
  assert.equal(reason({status:200,...html('<title>Just a moment...</title>','application/json')}),null,'only HTML is inspected');
});
test('sign-in redirects stop the read; ordinary redirects continue',()=>{
  assert.equal(reason({status:302,headers:{location:'https://humanity-labs.cloudflareaccess.com/cdn-cgi/access/login/wizard.aiwizards.com?kid=x'}}),'signin');
  for(const l of ['https://accounts.google.com/o/oauth2','https://example.com/login?next=/a','https://example.com/u/sign-in','https://example.com/cdn-cgi/access/login/x']) assert.equal(signinURL(l),true,l);
  for(const l of ['https://example.com/blog/how-to-login-safely','https://www.example.com/a','https://example.com/logistics']) assert.equal(signinURL(l),false,l);
  assert.equal(reason({status:301,headers:{location:'https://www.example.com/a'}}),null);
});
test('other HTTP failures are unavailable; success is not a verdict',()=>{
  assert.equal(reason({status:404,...html('nope')}),'unavailable');assert.equal(reason({status:200,...html('<article>ok</article>')}),null);
});
test('failure responses carry a plain message, reason and hand-off flag; private refusals stay 400',()=>{
  assert.deepEqual(failure(new ReadFailure('This site does not let Reader in.','blocked'),'https://x.example/'),{status:422,body:{error:'This site does not let Reader in.',reason:'blocked',handoff:true}});
  assert.deepEqual(failure(new UnsafeURL('Private addresses cannot be opened in Reader.'),'https://wizard.tailc0f369.ts.net/'),{status:400,body:{error:'Private addresses cannot be opened in Reader.',reason:'private',handoff:true}});
  assert.equal(failure(new UnsafeURL('Enter a full web address.'),'not a url').body.reason,'invalid');
  assert.equal(failure(new UnsafeURL('Enter a full web address.'),'not a url').body.handoff,false);
  assert.equal(failure(new UnsafeURL('The address lookup timed out.'),'https://slow.example/').body.reason,'unavailable');
  assert.equal(failure(new Error('Reader could not find an article on this page. It may need a sign-in or a check in your browser.'),'https://x.example/').body.reason,'noarticle');
  assert.deepEqual(failure(new ReadFailure('Reader is busy. Please try again in a moment.','busy'),'https://x.example/').body,{error:'Reader is busy. Please try again in a moment.',reason:'busy',handoff:false});
  const net=failure(new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://x.example/'),'https://x.example/');
  assert.deepEqual(net.body,{error:'Reader could not read this page.',reason:'unavailable',handoff:true});
  assert.equal(failure(Object.assign(new Error('page.goto: Timeout 20000ms exceeded.'),{name:'TimeoutError'}),'https://x.example/').body.error,'The page took too long to respond.');
});
test('the render path stops a main-document verdict before Chrome renders it',async()=>{
  const src=await (await import('node:fs/promises')).readFile(new URL('../render.mjs',import.meta.url),'utf8');
  assert.match(src,/const nav=req\.isNavigationRequest\(\) && req\.frame\(\)===req\.frame\(\)\.page\(\)\?\.mainFrame\(\);/);
  assert.match(src,/if\(nav && \(verdict=documentVerdict\(res\)\)\) return await route\.abort/);
  assert.match(src,/if\(verdict\) throw verdict;/);
});
test('Chrome is never handed a redirect: subresources follow in safeFetch, the main document re-navigates to the checked hop',async()=>{
  // Live 7 Nov 2026: http://github.com/…, https://wikipedia.org/… and Cloudflare Access pages all failed with
  // net::ERR_TUNNEL_CONNECTION_FAILED because Playwright does not route a fulfilled redirect's next request.
  const src=await (await import('node:fs/promises')).readFile(new URL('../render.mjs',import.meta.url),'utf8');
  assert.match(src,/safeFetch\(req\.url\(\),\{maxBytes:reservation,signal:abort\.signal,follow:!nav\}\)/);
  assert.match(src,/hop=res\.headers\.location; return await route\.abort/);
  assert.match(src,/for\(let hops=0;;hops\+\+\)/);
  assert.doesNotMatch(src,/headers\.location=res\.headers\.location/,'no Location ever reaches Chrome');
});
