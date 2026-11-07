import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8'),code=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const article={url:'https://example.com/a',canonicalURL:'https://example.com/a',title:'Unit article',siteName:'Unit site',byline:'Unit author',html:'<p>Unit article text</p>',favicon:''};
const turn=()=>new Promise(r=>setTimeout(r,0));
async function app(t,initial=article.url) {
 const dom=new JSDOM(html,{url:'https://wizard.test/browser/?url='+encodeURIComponent(initial),runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;let back,rows=[],writeResolve,writeReject,readerCalls=0;
 w.WizardApp={ready(){},back:{register(v){back=v;}},update:{hold(){return {release(){}};}}};w.scrollTo=()=>{};
 w.fetch=async(url,options={})=>{
  if(url.startsWith('api/reader')){readerCalls++;return {ok:true,json:async()=>({...article})};}
  if(!options.method || options.method==='GET')return {ok:true,json:async()=>({items:structuredClone(rows)})};
  return new Promise((resolve,reject)=>{writeResolve=()=>{
    const data=JSON.parse(options.body);let item;
    if(options.method==='POST'){item={id:'12345678-1234-1234-1234-123456789abc',url:article.url,canonical_url:article.url,title:article.title,site:article.siteName,byline:article.byline,saved_at:new Date().toISOString(),read_at:null};rows=[item];}
    if(options.method==='PATCH'){item={...rows[0],read_at:data.read?new Date().toISOString():null};rows=[item];}
    if(options.method==='DELETE')rows=[];
    resolve({ok:true,json:async()=>item?{item}:{ok:true}});
   };writeReject=reject;});
 };
 w.eval(code);await turn();await turn();return {w,$:s=>w.document.querySelector(s),back:()=>back,commit:async()=>{writeResolve();await turn();await turn();},fail:async()=>{writeReject(Error('Unit offline'));await turn();await turn();},readerCalls:()=>readerCalls};
}
test('Save paints immediately while held, list/reopen/mark/remove and Back/menu outside',async t=>{
 const a=await app(t),{$}=a;assert.equal($('#save').disabled,false);$('#save').click();assert.equal($('#save').getAttribute('aria-pressed'),'true');assert.equal($('#save span').textContent,'Saved');assert.ok($('#save').disabled);await a.commit();
 assert.equal($('#save').disabled,false);a.back().back();assert.equal($('#library').hidden,false);assert.equal($('#unread .list-title').textContent,'Unit article');assert.equal(a.back().canGoBack(),false);
 $('#unread .list-open').click();await turn();assert.equal(a.readerCalls(),2);assert.equal($('#save').getAttribute('aria-pressed'),'true');a.back().back();
 const menu=$('.item-menu');menu.open=true;assert.equal(a.back().canGoBack(),true);a.back().back();assert.equal(menu.open,false);menu.open=true;$('#list-title').click();assert.equal(menu.open,false);
 $('.item-actions button').click();assert.equal($('#read-section').hidden,false);assert.equal($('#read-section').open,false);assert.equal($('#unread').children.length,0);await a.commit();$('#read-section').open=true;$('#read-items .item-actions button:last-child').click();assert.equal($('#read-items').children.length,0);await a.commit();assert.equal($('#read-section').hidden,true);
});
test('Reader domain URL follows home, next article and Back so same Search result reopens',async t=>{
 const a=await app(t),{$,w}=a;const historyLength=w.history.length;
 $('#home').click();assert.equal($('#library').hidden,false);
 assert.equal(new URL(w.location.href).searchParams.has('url'),false,'desktop framePage must not see the old article URL at list root');
 assert.equal(w.history.length,historyLength,'domain replacement must not add browser Back steps');
 // This is the real desktop framePage equality contract: root differs from the deep link.
 const target='/browser/?url='+encodeURIComponent(article.url);
 assert.notEqual(w.location.pathname+w.location.search,target);
 $('#url').value='https://example.com/b';$('#address').dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.equal(new URL(w.location.href).searchParams.get('url'),'https://example.com/b');await turn();
 const link=w.document.createElement('a');link.href='?url='+encodeURIComponent('https://example.com/c');$('#article').append(link);link.click();
 assert.equal(new URL(w.location.href).searchParams.get('url'),'https://example.com/c');await turn();
 a.back().back();assert.equal(new URL(w.location.href).searchParams.get('url'),'https://example.com/b');await turn();
 a.back().back();assert.equal(new URL(w.location.href).searchParams.has('url'),false);
 assert.equal(w.history.length,historyLength);
});
test('failed optimistic save rolls back with visible retry; saved state never lies after failure',async t=>{
 const a=await app(t),{$}=a;$('#save').click();assert.equal($('#save span').textContent,'Saved');await a.fail();assert.equal($('#save span').textContent,'Save');assert.equal($('#error').hidden,false);assert.match($('#error').textContent,/Unit offline/);$('#retry').click();assert.equal($('#save span').textContent,'Saved');await a.commit();assert.equal($('#error').hidden,true);
});

// James, 7 Nov 2026: a page Reader cannot read opens the original at once, without a second tap.
async function failing(t,{take,stop=false,hosted=true,body={error:'This site does not let Reader in.',reason:'blocked',handoff:true}}={}) {
 const url='https://www.reuters.com/world/story';
 const dom=new JSDOM(html,{url:'https://wizard.test/browser/?url='+encodeURIComponent(url),runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;const seen=[];let backs=0;
 w.WizardApp={hosted,ready(){},back:{register(){}},update:{hold(){return {release(){}};}},nav:{back(){backs++;return true;}}};w.scrollTo=()=>{};
 w.document.addEventListener('click',e=>{const a=e.target.closest('a[data-wizard-browse]');if(!a)return;seen.push([a.getAttribute('href'),a.dataset.wizardBrowse,a.dataset.wizardReason,a.target]);if(take)e.preventDefault();if(take&&stop)e.stopPropagation();},true);
 w.fetch=async u=>u.startsWith('api/reader')?{ok:false,json:async()=>body}:{ok:true,json:async()=>({items:[]})};
 w.eval(code);await turn();await turn();return {w,$:s=>w.document.querySelector(s),seen,backs:()=>backs,url};
}
test('Reader failure hands the original to Wizard at once and returns to the tapped link',async t=>{
 const a=await failing(t,{take:true});
 assert.deepEqual(a.seen,[[a.url,'auto','blocked','_blank']]);assert.equal(a.backs(),1);
 assert.match(a.$('#status').textContent,/Opened the original in your browser/);
 assert.equal(a.$('#original').getAttribute('href'),a.url,'Open in your browser stays as the visible fallback');
 assert.equal(a.w.document.querySelectorAll('a[data-wizard-browse=auto]').length,0);
});
test('declined hand-off (desktop without a fresh tap) keeps one visible Open in your browser and never navigates',async t=>{
 const a=await failing(t,{take:false});
 assert.equal(a.seen.length,1);assert.equal(a.backs(),0);assert.equal(a.w.location.pathname,'/browser/');
 assert.match(a.$('#status').textContent,/does not let Reader in\. You can open the original in your browser\./);
 assert.equal(a.$('#page').hidden,false);assert.equal(a.$('#original').getAttribute('href'),a.url);
});
test('busy or non-hand-off failures never open anything',async t=>{
 const a=await failing(t,{take:true,body:{error:'Reader is busy. Please try again in a moment.',reason:'busy',handoff:false}});
 assert.equal(a.seen.length,0);assert.equal(a.backs(),0);assert.match(a.$('#status').textContent,/Reader is busy/);
});
test('standalone Reader (no Wizard host) keeps the old visible fallback',async t=>{
 const a=await failing(t,{take:true,hosted:false});assert.equal(a.seen.length,0);assert.equal(a.backs(),0);
});
test('hand-off is taken even when the shell link guard also stops propagation (real WizLinks.guardFrame)',async t=>{
 // The installed shell's capture listener calls preventDefault() AND stopPropagation(); the gate saw Reader keep its
 // fallback page open over the chat on the phone because Reader's own target listener never ran.
 const a=await failing(t,{take:true,stop:true});
 assert.equal(a.seen.length,1);assert.equal(a.backs(),1,'returns to the tapped chat');
 assert.match(a.$('#status').textContent,/Opened the original in your browser/);
});
