import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {ListStore} from '../list-store.mjs';
import {listAPI,ListError} from '../list-api.mjs';
import {UnsafeURL} from '../network.mjs';
const article={url:'https://93.184.216.34/a?utm=test',canonicalURL:'https://93.184.216.34/a#title',title:'A title',siteName:'Site',byline:'Author',publishedTime:'2026-11-01',favicon:'api/image?url=https%3A%2F%2Fexample.com%2Ffavicon.ico',html:'NEVER STORE THIS',cookies:'NEVER STORE COOKIES'};
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'reader-list-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('atomic store dedupes canonical, serializes races, persists read/remove across instances and projects metadata only',async t=>{
 const dir=await temporary(t),store=new ListStore(dir);
 const rows=await Promise.all(Array.from({length:15},()=>store.add(article)));assert.equal(new Set(rows.map(r=>r.id)).size,1);
 const first=rows[0];assert.equal(first.canonical_url,'https://93.184.216.34/a');
 await store.patch(first.id,true);const reopened=new ListStore(dir);assert.ok((await reopened.list())[0].read_at);
 const duplicate=await reopened.add({...article,url:'https://93.184.216.34/other'});assert.equal(duplicate.id,first.id);assert.equal(duplicate.saved_at,first.saved_at);assert.ok(duplicate.read_at);
 assert.equal((await reopened.patch(first.id,false)).read_at,null);
 const persisted=await readFile(join(dir,'list.json'),'utf8');assert.ok(!persisted.includes('NEVER STORE'));assert.ok(!persisted.includes('html'));assert.ok(!persisted.includes('cookies'));
 assert.deepEqual(await readdir(dir),['list.json']);
 await reopened.remove(first.id);assert.deepEqual(await new ListStore(dir).list(),[]);
});
test('store fails closed on corrupted data, preserves exact bytes',async t=>{
 const dir=await temporary(t);await writeFile(join(dir,'list.json'),'not json');const s=new ListStore(dir);
 await assert.rejects(s.list());await assert.rejects(s.add(article));assert.equal(await readFile(join(dir,'list.json'),'utf8'),'not json');
});
test('store sorts newest first and never accepts an external favicon',async t=>{
 const s=new ListStore(await temporary(t));await s.add(article);await new Promise(r=>setTimeout(r,2));await s.add({...article,canonicalURL:'https://93.184.216.34/b',favicon:'https://tracker.com/icon'});
 const rows=await s.list();assert.equal(rows[0].canonical_url,'https://93.184.216.34/b');assert.equal(rows[0].favicon,'');assert.equal(await s.patch('absent',true),null);
});
async function apiServer(t,read=async()=>article) {
 const store=new ListStore(await temporary(t));let calls=0;
 const server=http.createServer(async(req,res)=>{
  try{const out=await listAPI(req,new URL(req.url,'http://test').pathname,store,async url=>{calls++;return read(url);});res.statusCode=out?.status||404;res.end(JSON.stringify(out?.body||{}));}
  catch(e){res.statusCode=e instanceof ListError?e.status:e instanceof UnsafeURL?400:422;res.end(JSON.stringify({error:e.message}));}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path='',method='GET',body,headers={})=>fetch(base+'/api/list'+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {request,store,base,calls:()=>calls};
}
test('API add/list/dedupe/mark/remove and idempotent DELETE',async t=>{
 const {request,base,calls}=await apiServer(t);
 let r=await request('','POST',{url:article.url},{origin:base});assert.equal(r.status,200);const {item}=await r.json();
 r=await request('','POST',{url:article.url});assert.equal((await r.json()).item.id,item.id);assert.equal(calls(),2);
 assert.equal((await (await request()).json()).items.length,1);
 r=await request('/'+item.id,'PATCH',{read:true});assert.ok((await r.json()).item.read_at);
 r=await request('/'+item.id,'PATCH',{read_at:'x'});assert.equal(r.status,400);
 r=await request('/'+item.id,'DELETE',{});assert.equal(r.status,200);assert.equal((await request('/'+item.id,'DELETE',{})).status,200);assert.deepEqual((await (await request()).json()).items,[]);
});
test('API rejects unsafe URLs before rendering, metadata injection and unsafe canonical after rendering',async t=>{
 const a=await apiServer(t);
 for(const url of ['http://127.0.0.1/','http://169.254.169.254/latest/','http://100.64.0.1/','http://[::1]/','file:///etc/passwd','http://internal/','https://user:secret@example.com/'])assert.equal((await a.request('','POST',{url})).status,400,url);
 assert.equal(a.calls(),0);assert.equal((await a.request('','POST',{url:article.url,title:'caller lies'})).status,400);
 const b=await apiServer(t,async()=>({...article,canonicalURL:'http://localhost/'}));assert.equal((await b.request('','POST',{url:article.url})).status,400);assert.deepEqual(await b.store.list(),[]);
});
test('API origin, JSON, size and method allowlist protect mutations',async t=>{
 const {request,base,calls}=await apiServer(t);
 for(const headers of [{origin:'https://evil.test'},{origin:'null'},{origin:base.replace('http:','https:')},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'same-origin'},{'content-type':'text/plain'}]) {
  const r=await request('','POST',{url:article.url},headers);assert.ok([403,415].includes(r.status),JSON.stringify(headers));
 }
 assert.equal(calls(),0);
 assert.equal((await request('','PUT',{})).status,405);assert.equal((await request('/'+ 'a'.repeat(36),'GET')).status,405);assert.equal((await request('/../../mcp','POST',{})).status,404);
 assert.equal((await request('','POST',{url:'x'.repeat(17000)})).status,413);
 assert.equal((await request('','POST',[])).status,400);
 assert.equal((await request('','POST',{url:article.url},{origin:base,'sec-fetch-site':'same-origin'})).status,200);
});
