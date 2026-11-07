import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {safeFetch,UnsafeURL} from './network.mjs';
import {readArticle} from './render.mjs';
import {ReadFailure,failure} from './handoff.mjs';
import {ListStore} from './list-store.mjs';
import {listAPI,ListError} from './list-api.mjs';
const store=new ListStore(process.env.READER_DATA_DIR || '/data');

export const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const root=fileURLToPath(new URL('./web/',import.meta.url));
const assets=new Map();
for (const name of ['index.html','app.js','styles.css','wizard-ui.css','wizard-tokens.css','boot.js']) assets.set('/'+name,await readFile(root+name));
const build=createHash('sha256').update(Buffer.concat([...assets.values()])).digest('hex');
let images=0;
function send(res,status,body,type='application/json') {
  res.writeHead(status,{'content-type':type,'content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':CSP,'cross-origin-resource-policy':'same-origin'});res.end(body);
}
export const server=http.createServer(async(req,res)=>{
  try {
    const u=new URL(req.url,'http://reader.invalid');
    const list=await listAPI(req,u.pathname,store,readArticle);
    if(list) return send(res,list.status,JSON.stringify(list.body));
    if(req.method!=='GET' && req.method!=='HEAD') return send(res,405,'{}');
    if(u.pathname==='/health') return send(res,200,JSON.stringify({ok:true,version:'1.1.0',build}));
    if(u.pathname==='/api/reader') {
      const input=u.searchParams.get('url');
      try { return send(res,200,JSON.stringify(await readArticle(input))); }
      catch(e) {
        const out=failure(e,input);
        // Operator log: reason and host only for expected refusals; the full cause for anything else.
        let host='';try{host=new URL(input).hostname;}catch{}
        if(e instanceof ReadFailure || e instanceof UnsafeURL) console.error('reader handoff:',out.body.reason,host);
        else console.error('reader failure:',out.body.reason,host,(e && e.stack) || e);
        return send(res,out.status,JSON.stringify(out.body));
      }
    }
    if(u.pathname==='/api/image') {
      if(images>=8) return send(res,429,'{}'); images++;
      try {
        const r=await safeFetch(u.searchParams.get('url'),{maxBytes:5*1024*1024,signal:AbortSignal.timeout(15000)});
        const type=String(r.headers['content-type'] || '').split(';')[0].toLowerCase();
        // No SVG/XML/HTML; bitmap-only bytes are inert in the owner WebView.
        const b=r.body, bitmap=(type==='image/png' && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
          (type==='image/jpeg' && b[0]===255 && b[1]===216 && b[2]===255) ||
          (type==='image/gif' && /^GIF8[79]a$/.test(b.subarray(0,6).toString())) ||
          (type==='image/webp' && b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP') ||
          (['image/x-icon','image/vnd.microsoft.icon'].includes(type) && b.subarray(0,4).equals(Buffer.from([0,0,1,0])));
        if(r.status!==200 || !bitmap) return send(res,415,'{}');
        return send(res,200,b,type);
      } finally {images--;}
    }
    const path=(u.pathname==='/' || u.pathname==='/reader')?'/index.html':u.pathname;
    if(!assets.has(path)) return send(res,404,'{}');
    const type=path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
    return send(res,200,assets.get(path),type);
  } catch(e) {
    if(e instanceof ListError) return send(res,e.status,JSON.stringify({error:e.message}));
    // Log the real cause for the operator; the owner sees only the plain message.
    if(!(e instanceof UnsafeURL)) console.error('reader failure:',(e && e.stack) || e);
    return send(res,e instanceof UnsafeURL?400:422,JSON.stringify({error:e instanceof UnsafeURL?e.message:'Reader could not read this page. It may need a sign-in or a check in your browser.'}));
  }
});
// Every non-intercepted Chrome connection is refused, including CONNECT. This
// service never forwards a byte from the render browser onto the box network.
const deny=http.createServer((req,res)=>{res.writeHead(403);res.end();});
deny.on('connect',(req,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
deny.on('upgrade',(req,socket)=>socket.destroy());
server.requestTimeout=30000; server.headersTimeout=10000;
if(process.env.NODE_ENV!=='test') {server.listen(Number(process.env.READER_PORT || 8080),'0.0.0.0');deny.listen(8081,'0.0.0.0');}
