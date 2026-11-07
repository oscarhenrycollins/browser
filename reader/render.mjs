import {chromium} from 'playwright-core';
import dns from 'node:dns/promises';
import {safeFetch,destination,UnsafeURL} from './network.mjs';
import {extract} from './article.mjs';
import {ReadFailure,documentVerdict} from './handoff.mjs';
import {Activity} from './settle.mjs';

const PIXEL=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
let connection;
export async function chrome() {
  if (!connection) connection=(async()=>{
    const host=process.env.UPSTREAM_HOST || 'browser-engine';
    const {address}=await dns.lookup(host);
    // Browser-engine is configuration, never taken from an owner-supplied URL.
    return chromium.connectOverCDP(`http://${address}:${process.env.UPSTREAM_PORT || 9222}`,{timeout:10000});
  })().then(b=>{b.on('disconnected',()=>{connection=null;});return b;}).catch(e=>{connection=null;throw e;});
  return connection;
}
let active=0;
export async function readArticle(input) {
  const t0=performance.now(), timing={};const mark=k=>{timing[k]=Math.round(performance.now()-t0);};
  await destination(input);mark('checked');
  if(active>=2) throw new ReadFailure('Reader is busy. Please try again in a moment.','busy');
  active++;
  let context;
  const abort=new AbortController(); const timer=setTimeout(()=>abort.abort(),25000);
  try {
    const browser=await chrome();
    // Never use browser.contexts()[0], which belongs to the agent. The deny proxy
    // is defense in depth: only intercepted, validated, byte-bounded GETs work.
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1280,height:900},
      proxy:{server:process.env.READER_DENY_PROXY || 'http://browser-reader:8081',bypass:'<-loopback>'}});
    if(abort.signal.aborted) throw new Error('The page took too long to respond.');
    await context.addInitScript(() => {
      // A render needs scripts, not raw peer sockets or workers. Keep those APIs
      // unavailable in every document before any source script is evaluated.
      for (const name of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport','Worker','SharedWorker']) {
        try { Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false}); } catch {}
      }
    });
    const expire=()=>{void context.close().catch(()=>{});}; abort.signal.addEventListener('abort',expire,{once:true});
    await context.routeWebSocket('**/*',route=>route.close());
    let requests=0, bytes=0, reserved=0, running=0, blocked=null, verdict=null, hop=null;
    const activity=new Activity();
    const waiting=[];
    const acquire=async()=>{if(running<4) {running++;return;} await new Promise(resolve=>waiting.push(resolve));};
    const release=()=>{const next=waiting.shift();if(next)next();else running--;};
    await context.route('**/*',async route=>{
      const req=route.request(); let reservation=0, acquired=false;
      activity.start();
      try {
        if(abort.signal.aborted || ++requests>120 || req.method()!=='GET' || ['media','font'].includes(req.resourceType())) return await route.abort();
        // Image bytes are never needed to read the article: extraction reads only their attributes, and the owner's
        // copy loads each one later through api/image. Fetching them here held the page's own scripts behind 40+
        // Wikipedia images. A blank pixel (not an error) keeps pages' onerror handlers from hiding real pictures.
        if(req.resourceType()==='image') return await route.fulfill({status:200,headers:{'content-type':'image/gif','x-content-type-options':'nosniff'},body:PIXEL});
        await acquire(); acquired=true;
        if(abort.signal.aborted) return await route.abort();
        reservation=Math.min(8*1024*1024,32*1024*1024-bytes-reserved);
        if(reservation<=0) return await route.abort();
        reserved+=reservation;
        const nav=req.isNavigationRequest() && req.frame()===req.frame().page()?.mainFrame();
        // Chrome is never handed a redirect: Playwright does not route a redirect's next request, so it
        // went to the deny proxy and every redirecting link failed (net::ERR_TUNNEL_CONNECTION_FAILED).
        // Subresources follow in safeFetch, which checks every hop; the main document navigates again below.
        const res=await safeFetch(req.url(),{maxBytes:reservation,signal:abort.signal,follow:!nav});
        bytes+=res.body.length;
        // A bot wall, sign-in redirect or failed main document stops the read now (~1 s), before
        // Chrome renders a challenge page or waits out the timeouts. Its bytes never reach Chrome.
        if(nav && (verdict=documentVerdict(res))) return await route.abort('blockedbyclient');
        if(nav && res.headers.location && res.status>=300 && res.status<400) { hop=res.headers.location; return await route.abort('aborted'); }
        // Do not pass Set-Cookie, refresh, reporting, origin trials, Location or other active headers.
        const type=res.headers['content-type'] || 'application/octet-stream';
        const headers={'content-type':type,'x-content-type-options':'nosniff'};
        for(const h of ['access-control-allow-origin','access-control-allow-credentials']) if(res.headers[h]) headers[h]=res.headers[h];
        await route.fulfill({status:res.status,headers,body:res.body});
      } catch(e) {
        // A main-document redirect into a private address is a refusal, not a read failure.
        if(e instanceof UnsafeURL && req.isNavigationRequest() && req.frame()===req.frame().page()?.mainFrame()) blocked=e;
        try{await route.abort();}catch{}
      }
      finally {reserved-=reservation;if(acquired) release();activity.end();}
    });
    mark('context');
    const page=await context.newPage(); page.setDefaultTimeout(20000);
    page.on('popup',p=>void p.close());
    // Commit the public URL before source JS can initiate client-side navigation.
    let response, target=input;
    for(let hops=0;;hops++) {
      hop=null;
      try { response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:20000}); }
      catch(e) { if(blocked) throw blocked; if(verdict) throw verdict; if(!hop) throw e; }
      if(blocked) throw blocked;
      if(verdict) throw verdict;
      if(!hop) break;
      // hop already passed the destination guard inside safeFetch.
      if(hops>=5) throw new ReadFailure('This page redirects too many times.','unavailable');
      target=hop;
    }
    if (!response || response.status()>=400) throw new ReadFailure('This page is not available right now.','unavailable');
    mark('loaded');
    // Up to the old fixed 1.2 s, shorter once the page's own requests are done and quiet.
    const settled=await activity.settle({maxMs:1200});mark('settled');
    const snapshot=async()=>{
      await destination(page.url());
      const html=await page.content();
      if(Buffer.byteLength(html)>8*1024*1024) throw new Error('This page is too large for Reader.');
      return extract(html,page.url());
    };
    let article;
    try { article=await snapshot(); }
    catch(e) {
      // A quiet page whose scripts render on a timer: give it the rest of the old wait once, then read again.
      if(!settled.quiet || e instanceof UnsafeURL || !/could not find an article/.test(e.message)) throw e;
      await page.waitForTimeout(Math.max(0,1200-settled.waited));timing.retried=true;article=await snapshot();
    }
    mark('extracted');return article;
  } finally {
    clearTimeout(timer); abort.abort(); if(context) await context.close().catch(()=>{}); active--;
    // Operator log: host and phase times only.
    let host='';try{host=new URL(input).hostname;}catch{}
    console.log('reader timing',host,JSON.stringify({...timing,total:Math.round(performance.now()-t0)}));
  }
}
