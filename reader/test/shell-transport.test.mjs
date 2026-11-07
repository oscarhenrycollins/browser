import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {mutationGuard} from '../list-api.mjs';
const {proxyRequest}=createRequire(import.meta.url)('./shell-transport.cjs');
test('in-shell proxy preserves real browser Host, Origin, fetch metadata and JSON bytes',async t=>{
 const seen=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  seen.push({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});
  try{mutationGuard(req);res.end(JSON.stringify({ok:true}));}catch(e){res.statusCode=e.status;res.end(e.message);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const upstream='http://127.0.0.1:'+server.address().port+'/api/list';
 const body=JSON.stringify({url:'https://example.com/'});
 const headers={host:'reader-shell.test',origin:'http://reader-shell.test','sec-fetch-site':'same-origin','content-type':'application/json','accept-encoding':'identity'};
 // Reproduce the failed gate's actual transport against the actual product guard.
 const bad=await fetch(upstream,{method:'POST',headers,body});assert.equal(bad.status,403);
 assert.notEqual(seen[0].headers.host,headers.host);assert.equal(seen[0].headers.origin,headers.origin);
 for(const method of ['POST','PATCH','DELETE']){
  const good=await proxyRequest(upstream,{method,headers,body});assert.equal(good.status,200,good.body.toString());
  const actual=seen.at(-1);assert.equal(actual.headers.host,headers.host);assert.equal(actual.headers.origin,headers.origin);assert.equal(actual.headers['sec-fetch-site'],'same-origin');assert.equal(actual.method,method);assert.equal(actual.body,body);
 }
 const evil=await proxyRequest(upstream,{method:'POST',headers:{...headers,origin:'https://evil.test','sec-fetch-site':'cross-site'},body});assert.equal(evil.status,403);
 const opaque=await proxyRequest(upstream,{method:'POST',headers:{...headers,origin:'null'},body});assert.equal(opaque.status,403);
});
