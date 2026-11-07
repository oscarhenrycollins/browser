import {destination} from './network.mjs';
export class ListError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new ListError(status,message);};
export function mutationGuard(req) {
  if(req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) fail(403,'Use Reading list from this Wizard.');
  const origin=req.headers.origin;
  // Origin-free JSON requests are the private app/MCP agent route, not HTML forms.
  if(origin) {
    const scheme=req.headers['x-forwarded-proto'] || (req.socket.encrypted?'https':'http');
    if(origin!==scheme+'://'+req.headers.host) fail(403,'Use Reading list from this Wizard.');
  } else if(req.headers['sec-fetch-site']) fail(403,'A same-origin request is required.');
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415,'Send JSON for Reading list changes.');
}
async function jsonBody(req) {
  if(Number(req.headers['content-length'] || 0)>16384) fail(413,'Request too large.');
  let length=0;const chunks=[];
  for await(const b of req){length+=b.length;if(length>16384)fail(413,'Request too large.');chunks.push(b);}
  let data;try {data=JSON.parse(Buffer.concat(chunks).toString());} catch {fail(400,'Send a JSON object.');}
  if(!data || typeof data!=='object' || Array.isArray(data)) fail(400,'Send a JSON object.');
  return data;
}
export async function listAPI(req,path,store,readArticle) {
  const collection=path==='/api/list', match=path.match(/^\/api\/list\/([a-f0-9-]{36})$/);
  if(!collection && !match) return null;
  if(collection && ['GET','HEAD'].includes(req.method)) return {status:200,body:{items:await store.list()}};
  if(!(collection?req.method==='POST':['PATCH','DELETE'].includes(req.method))) fail(405,'That method is not supported.');
  mutationGuard(req);
  const data=await jsonBody(req);
  if(collection) {
    if(Object.keys(data).some(k=>k!=='url')) fail(400,'Only a web address is accepted.');
    // Same guard before render, including dedupe hits: never trust stored/caller metadata.
    await destination(data.url);
    const article=await readArticle(data.url);
    await destination(article.canonicalURL || article.url);
    return {status:200,body:{item:await store.add(article)}};
  }
  const id=match[1];
  if(req.method==='DELETE') {
    if(Object.keys(data).length) fail(400,'Remove takes an empty object.');
    await store.remove(id);return {status:200,body:{ok:true}};
  }
  if(Object.keys(data).length!==1 || typeof data.read!=='boolean') fail(400,'Set read to true or false.');
  const item=await store.patch(id,data.read);if(!item)fail(404,'This article is no longer saved.');
  return {status:200,body:{item}};
}
