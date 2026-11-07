/* Forum integration gate. These are standalone app captures, NOT in-shell skin acceptance. */
import {mkdir,writeFile} from 'node:fs/promises';
import {chrome} from '../reader/render.mjs';
const evidence=process.env.EVIDENCE || '/evidence';
await mkdir(evidence,{recursive:true});
const origin='http://browser:9222';
const result={kind:'standalone-reader-integration',started:new Date().toISOString(),cases:[]};
let browser,context;
const samples=[
 ['wikipedia','https://en.wikipedia.org/wiki/Readability'],
 ['substack','https://www.oneusefulthing.org/p/the-shape-of-the-thing'],
 ['news','https://www.theguardian.com/uk-news/2026/nov/03/ai-godfather-geoffrey-hinton-better-off-without-ai'],
 ['github','https://github.com/mozilla/readability'],
 ['react-docs','https://react.dev/learn'],
 ['javascript','https://quotes.toscrape.com/js/']
];
async function record(name,fn){try{const data=await fn();result.cases.push({name,ok:true,...data});}catch(e){result.cases.push({name,ok:false,error:String(e)});}await writeFile(evidence+'/integration.json',JSON.stringify(result,null,2));}
try {
 browser=await chrome();context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 for(const [name,url] of samples) await record(name,async()=>{
   const thirdParty=[];page.on('request',r=>{if(new URL(r.url()).origin!==origin)thirdParty.push(r.url());});
   await page.goto(origin+'/?url='+encodeURIComponent(url));
   await page.waitForFunction(()=>!document.querySelector('#status').hidden && document.querySelector('#status').textContent.startsWith('Reader could not') || document.querySelector('#status').hidden,null,{timeout:35000});
   const data=await page.evaluate(()=>({title:document.querySelector('#title').textContent,site:document.querySelector('#site').textContent,url:document.querySelector('#source').textContent,body:document.querySelector('#article').textContent.length,images:[...document.querySelectorAll('#article img')].map(i=>i.getAttribute('src')),error:!document.querySelector('#status').hidden?document.querySelector('#status').textContent:'',active:document.querySelectorAll('#article script,#article iframe,#article form,#article [style],#article [onerror]').length}));
   // Prove images really arrive through the app's own proxy (not just that src was rewritten).
   const imageCheck=await page.evaluate(async()=>{
     const imgs=[...document.querySelectorAll('#article img')].slice(0,4);
     for(const i of imgs){i.loading='eager';i.scrollIntoView();}
     await Promise.race([Promise.all(imgs.map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r;}))),new Promise(r=>setTimeout(r,15000))]);
     window.scrollTo(0,0);
     const statuses=[];for(const i of imgs){try{const r=await fetch(i.getAttribute('src'),{cache:'no-store'});statuses.push(r.status+' '+r.headers.get('content-type'));}catch(e){statuses.push('error '+e.message);}}
     const logo=document.querySelector('#logo');
     return {checked:imgs.length,loaded:imgs.filter(i=>i.naturalWidth>0).length,statuses,logo:!logo.hidden && logo.naturalWidth>0};
   });
   await page.screenshot({path:evidence+'/'+name+'-desktop.png'});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:evidence+'/'+name+'-phone.png'});await page.setViewportSize({width:1280,height:900});
   if(!data.title || data.body<150 || data.error || data.active || thirdParty.length || data.images.some(x=>!x.startsWith('api/image?url=')) || (imageCheck.checked && !imageCheck.loaded))throw Error(JSON.stringify({...data,imageCheck,thirdParty}));
   return {...data,imageCheck,thirdParty,screenshots:[name+'-desktop.png',name+'-phone.png']};
 });
 await record('reader-follow-link',async()=>{
   await page.goto(origin+'/?url='+encodeURIComponent('https://en.wikipedia.org/wiki/Readability'));
   await page.waitForFunction(()=>document.querySelector('#status').hidden,null,{timeout:35000});
   const a=page.locator('#article a[href^="?url="]').first();
   const next=new URL(await a.getAttribute('href'),origin).searchParams.get('url');
   await a.click();
   const immediate=await page.locator('#url').inputValue();
   if(immediate!==next)throw Error('Reader did not immediately accept the next URL');
   await page.waitForFunction(()=>document.querySelector('#status').hidden,null,{timeout:35000});
   await page.screenshot({path:evidence+'/reader-next-page.png'});
   return {next,title:await page.locator('#title').textContent(),immediate};
 });
 await record('cookie-context-isolation',async()=>{
   const agent=browser.contexts()[0], marker='reader-isolation-test';
   await agent.addCookies([{url:'https://example.com/',name:'wizard_reader_test',value:marker}]);
   const cdp=await browser.newBrowserCDPSession();
   const before=new Set((await cdp.send('Target.getBrowserContexts')).browserContextIds);
   const observed=[];
   const pending=[];
   cdp.on('Target.targetCreated',({targetInfo:t})=>{
     if(t.type==='page' && t.browserContextId && !before.has(t.browserContextId)) {
       pending.push(cdp.send('Storage.getCookies',{browserContextId:t.browserContextId}).then(c=>observed.push({contextId:t.browserContextId,containsAgentCookie:c.cookies.some(x=>x.name==='wizard_reader_test')})));
     }
   });
   await cdp.send('Target.setDiscoverTargets',{discover:true});
   try {
     const r=await fetch(origin+'/api/reader?url='+encodeURIComponent('https://example.com/'));if(!r.ok)throw Error(await r.text());
     await Promise.all(pending);
     const after=(await cdp.send('Target.getBrowserContexts')).browserContextIds;
     if(!observed.length || observed.some(x=>x.containsAgentCookie) || after.some(id=>!before.has(id)))throw Error(JSON.stringify({observed,after,before:[...before]}));
     if(!(await agent.cookies('https://example.com/')).some(c=>c.name==='wizard_reader_test'))throw Error('Agent context was changed');
     return {observed,disposableContextsClosed:true,agentCookieRetained:true};
   } finally {await agent.clearCookies({name:'wizard_reader_test'});await cdp.detach();}
 });
 await record('redirecting-links-read',async()=>{
   // Live 7 Nov 2026: every redirecting link failed (ERR_TUNNEL_CONNECTION_FAILED). Real public redirects must read.
   const rows=[];
   for(const url of ['http://en.wikipedia.org/wiki/Reading','https://wikipedia.org/wiki/Reading','http://github.com/humanitylabs-org']){
     const t0=Date.now(),r=await fetch(origin+'/api/reader?url='+encodeURIComponent(url));const body=await r.json();
     rows.push({url,status:r.status,final:body.url,reason:body.reason,ms:Date.now()-t0});
     if(r.status!==200 || !/^https:\/\//.test(body.url) || !(body.html||'').length)throw Error(JSON.stringify(rows));
   }return {rows};
 });
 await record('api-ssrf',async()=>{
   const blocked=[];
   for(const url of ['http://127.0.0.1','http://localhost','http://169.254.169.254/latest/meta-data','http://10.2.3.4','http://100.64.1.1','http://browser-engine','file:///etc/passwd','http://127.0.0.1.nip.io/','http://10-2-3-4.sslip.io/']){
     const r=await fetch(origin+'/api/reader?url='+encodeURIComponent(url));const body=await r.json();blocked.push({url,status:r.status,body});
     if(r.status!==400)throw Error(JSON.stringify(blocked));
   }return {blocked};
 });
 await record('mcp-real-navigate-read',async()=>{
   const r=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'read_page',arguments:{url:'https://example.com/'}}})});const rpc=await r.json();
   if(rpc.error || rpc.result?.isError || !JSON.stringify(rpc).includes('Example Domain'))throw Error(JSON.stringify(rpc));return {rpc};
 });
 await record('reading-list-mcp-and-edge-security',async()=>{
   const rpc=async(name,args={})=>{const r=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:81,method:'tools/call',params:{name,arguments:args}})});const value=await r.json();if(value.error || value.result?.isError)throw Error(JSON.stringify(value));return value;};
   const added=await rpc('reading_list_add',{url:'https://example.com/'});const listed=await rpc('reading_list_list');
   let rows=(await (await fetch(origin+'/api/list')).json()).items;if(rows.length!==1 || !JSON.stringify(listed).includes(rows[0].id))throw Error(JSON.stringify({added,listed,rows}));
   const id=rows[0].id;const edge='http://reader-edge:8080/browser';
   const change=(p,method,data,headers={})=>fetch(edge+p,{method,headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
   for(const [p,method,data,expected]of [['/api/list','POST',{url:'http://127.0.0.1/'},400],['/api/list/'+id,'PATCH',{read:true},200],['/api/list/'+id,'GET',null,405],['/api/list','PUT',{},405],['/mcp','POST',{},403],['/json/version','POST',{},403],['/devtools/browser/x','POST',{},403]]){
    const r=method==='GET'?await fetch(edge+p):await change(p,method,data);if(r.status!==expected)throw Error([p,method,r.status,await r.text()].join(' '));
   }
   for(const p of ['/mcp','/json/version','/devtools/browser/x']){const r=await fetch(edge+p);if(r.status!==403)throw Error('edge agent GET '+p+' '+r.status);}
   const csrf=await change('/api/list/'+id,'PATCH',{read:false},{origin:'https://evil.test','sec-fetch-site':'cross-site'});if(csrf.status!==403)throw Error('CSRF '+csrf.status);
   const removed=await change('/api/list/'+id,'DELETE',{});if(!removed.ok)throw Error(await removed.text());rows=(await (await fetch(origin+'/api/list')).json()).items;if(rows.length)throw Error('Remove did not persist');return{added,listed,edgeMethods:true,csrf:csrf.status};
 });
 await record('proxy-denies-mcp-and-cdp',async()=>{for(const path of ['/mcp','/json/version']){const r=await fetch(origin+path,{headers:{'x-forwarded-for':'100.64.1.1'}});if(r.status!==403)throw Error(path+' '+r.status);}return {};});
} finally {if(context)await context.close();if(browser)await browser.close();result.finished=new Date().toISOString();await writeFile(evidence+'/integration.json',JSON.stringify(result,null,2));}
if(result.cases.some(x=>!x.ok)) process.exitCode=1;
console.log(JSON.stringify(result,null,2));
