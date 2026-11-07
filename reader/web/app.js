/* Domain-only Reader/list state; WizardApp owns appearance, Back and update policy. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s), input=$('#url'), status=$('#status'), page=$('#page'), body=$('#article');
  let sequence=0,pending=null,current='',article=null,stack=[],items=[],listEpoch=0,listKnown=false;
  const saving=new Set();let retry=null,linked=new URLSearchParams(location.search).get('url') || '';
  window.WizardApp?.ready({name:'Browser',version:'1.1.0'});
  const when=s=>{const d=new Date(s);return s && !isNaN(d) && /\d{4}-\d{2}-\d{2}/.test(s)?d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):(s||'');};
  const canonical=u=>{try{const v=new URL(u);v.hash='';return v.href;}catch{return u;}};
  const saved=()=>article && items.find(r=>r.canonical_url===canonical(article.canonicalURL || article.url) || r.url===canonical(article.url));
  function error(message,fn) {$('#error').hidden=false;$('#error span').textContent=message;retry=fn;}
  function clearError() {$('#error').hidden=true;retry=null;}
  $('#retry').onclick=()=>retry?.();
  async function api(path,method='GET',data) {
    const r=await fetch(path,{method,cache:'no-store',...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(data)})});
    const out=await r.json();if(!r.ok)throw Error(out.error || 'The reading list could not be updated.');return out;
  }
  function savePaint() {
    const row=saved(),key=article && canonical(article.canonicalURL || article.url);
    $('#save').setAttribute('aria-pressed',String(!!row));$('#save span').textContent=row?'Saved':'Save';
    $('#save').disabled=!article || !listKnown || saving.has(key);
  }
  function closeMenus(except) {for(const d of document.querySelectorAll('.item-menu[open]'))if(d!==except)d.open=false;}
  function node(tag,text,cls) {const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
  function renderList() {
    $('#unread').replaceChildren();$('#read-items').replaceChildren();
    for(const row of items) {
      const el=node('div','','list-row wz-row');el.dataset.id=row.id;
      const open=node('button','','list-open');open.type='button';open.onclick=()=>read(row.url);
      const icon=node('img');icon.alt='';icon.width=24;icon.height=24;icon.loading='lazy';
      if(row.favicon?.startsWith('api/image?url=')){icon.src=row.favicon;icon.onerror=()=>{icon.hidden=true;};}else icon.hidden=true;
      const words=node('span','','list-words');words.append(node('span',row.site,'list-site wz-muted'),node('strong',row.title,'list-title'),node('span',[row.byline,'Saved '+when(row.saved_at)].filter(Boolean).join(' · '),'list-meta wz-muted'));
      open.append(icon,words);el.append(open);
      const menu=node('details','','item-menu'),summary=node('summary','⋯','wz-btn');summary.setAttribute('aria-label','Actions for '+row.title);menu.append(summary);
      const actions=node('div','','item-actions');
      for(const [label,fn] of [[row.read_at?'Mark unread':'Mark read',()=>mark(row) ],['Remove',()=>remove(row)]]) {
        const b=node('button',label,'wz-btn');b.type='button';b.disabled=saving.has(row.canonical_url);b.onclick=()=>{menu.open=false;fn();};actions.append(b);
      }
      menu.append(actions);menu.addEventListener('toggle',()=>{if(menu.open)closeMenus(menu);});el.append(menu);
      $(row.read_at?'#read-items':'#unread').append(el);
    }
    const count=items.filter(r=>r.read_at).length;$('#read-section').hidden=!count;$('#read-count').textContent=count?String(count):'';
    $('#empty').hidden=items.some(r=>!r.read_at);$('#empty').textContent=items.length?'No unread articles. Finished articles are under Read.':'Save an article in Reader to come back to it later.';savePaint();
  }
  async function loadList() {
    const epoch=++listEpoch;
    try {const out=await api('api/list');if(epoch!==listEpoch || saving.size)return;items=out.items;listKnown=true;renderList();}
    catch(e){error('Could not load your reading list. '+e.message,loadList);}
  }
  async function mutate(key,optimistic,write,again) {
    if(saving.has(key))return;
    const before=items.map(r=>({...r}));saving.add(key);++listEpoch;clearError();optimistic();renderList();
    const hold=window.WizardApp?.update.hold('saving reading list');
    try {const out=await write();if(out.item)items=items.map(r=>r.canonical_url===key?out.item:r);}
    catch(e){
      // Other rows can finish independently; restore only the failed row's state.
      items=items.filter(r=>r.canonical_url!==key).concat(before.filter(r=>r.canonical_url===key)).sort((a,b)=>b.saved_at.localeCompare(a.saved_at));
      error('Could not update your reading list. '+e.message,again);
    } finally {saving.delete(key);renderList();hold?.release();}
    await loadList();
  }
  function remove(row) {return mutate(row.canonical_url,()=>{items=items.filter(r=>r.id!==row.id);},()=>api('api/list/'+row.id,'DELETE',{}),()=>remove(row));}
  function mark(row) {return mutate(row.canonical_url,()=>{items=items.map(r=>r.id===row.id?{...r,read_at:row.read_at?null:new Date().toISOString()}:r);},()=>api('api/list/'+row.id,'PATCH',{read:!row.read_at}),()=>mark(row));}
  function saveArticle(data) {
    const key=canonical(data.canonicalURL || data.url);
    return mutate(key,()=>{items.unshift({id:'pending',url:data.url,canonical_url:key,title:data.title,site:data.siteName,byline:data.byline,favicon:data.favicon,saved_at:new Date().toISOString(),read_at:null});},()=>api('api/list','POST',{url:data.url}),()=>saveArticle(data));
  }
  $('#save').onclick=()=>{
    if(!article || !listKnown)return;const row=saved();if(row){remove(row);return;}saveArticle({...article});
  };
  function original(url) {$('#original').href=url;$('#source').textContent=url;}
  function route(url) {
    // Domain state must match the live document address. Desktop reuses an app
    // frame when its URL already equals a tapped deep link; a stale article URL
    // at Reading list root otherwise makes that tap an incorrect no-op.
    const address=new URL(location.href);
    if(url)address.searchParams.set('url',url);else address.searchParams.delete('url');
    history.replaceState(history.state,'',address);
  }
  function home() {
    route(null);
    ++sequence;pending?.abort();pending=null;current='';article=null;stack=[];page.hidden=true;$('#library').hidden=false;input.value='';document.title='Browser';
    status.hidden=false;status.textContent='Open a web link or paste an address to read it here.';closeMenus();savePaint();loadList();
  }
  $('#home').onclick=home;
  async function read(url,{remember=true}={}) {
    try {const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw Error();url=u.href;}catch{status.hidden=false;status.textContent='Enter a full http or https web address.';return;}
    if(url===current && pending)return;
    const id=++sequence;
    if(remember && current!==url)stack.push(current || null);
    route(url);
    current=url;article=null;input.value=url;closeMenus();$('#library').hidden=true;
    status.textContent='Reading '+new URL(url).hostname+'…';status.hidden=false;page.hidden=false;savePaint();
    $('#title').textContent='';$('#site').textContent=new URL(url).hostname;$('#byline').textContent='';$('#logo').hidden=true;body.replaceChildren();original(url);
    pending?.abort();const control=new AbortController();pending=control;
    const opened=remember && url===linked && stack.length===1 && stack[0]===null;linked='';
    try {
      const r=await fetch('api/reader?url='+encodeURIComponent(url),{signal:control.signal,cache:'no-store'});
      const data=await r.json();if(id!==sequence)return;
      if(!r.ok){if(data.handoff===true && handoff(url,data.reason,data.error,opened))return;throw Error(data.error || 'Reader could not read this page.');}
      article=data;$('#title').textContent=data.title;document.title=data.title+' · Browser';$('#site').textContent=data.siteName;
      $('#byline').textContent=[data.byline,when(data.publishedTime)].filter(Boolean).join(' · ');
      original(data.url);$('#logo').hidden=!data.favicon;$('#logo').src=data.favicon || '';
      body.innerHTML=data.html;status.hidden=true;savePaint();
    }catch(e){if(id!==sequence || e.name==='AbortError')return;status.hidden=false;status.textContent=e.message+' You can open the original in your browser.';}
    finally{if(id===sequence)pending=null;}
  }
  /* Reader could not read it: open the original straight away instead of asking for a second tap (James, 7 Nov 2026).
   * Wizard decides: the phone opens its browser at once; a desktop browser only while the owner's tap is fresh (no
   * blocked popup). Declined, nothing opens and "Open in your browser" stays as the visible one-tap fallback. */
  function handoff(url,reason,message,opened) {
    if(!window.WizardApp?.hosted)return false;
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.hidden=true;
    a.dataset.wizardBrowse='auto';a.dataset.wizardReason=/^[a-z]{1,16}$/.test(reason || '')?reason:'unavailable';
    // Wizard's link guard takes it with preventDefault() and may also stop propagation, so this target listener can
    // be skipped: read the dispatch result, and only cancel the hidden link's own navigation when nobody took it.
    let declined=false;a.addEventListener('click',e=>{if(!e.defaultPrevented){declined=true;e.preventDefault();}});
    document.body.append(a);const notCancelled=a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));a.remove();
    if(notCancelled || declined)return false;
    status.hidden=false;status.textContent=(message || 'Reader could not read this page.')+' Opened the original in your browser.';
    // Opened from a link: return to where the owner tapped it, as links did before Reader.
    if(opened)window.WizardApp?.nav?.back?.();
    return true;
  }
  $('#logo').addEventListener('error',()=>{$('#logo').hidden=true;});
  $('#address').addEventListener('submit',e=>{e.preventDefault();read(input.value.trim());});
  body.addEventListener('click',e=>{
    const a=e.target.closest('a[href]');if(!a || e.button!==0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)return;
    const next=new URL(a.href).searchParams.get('url');if(next){e.preventDefault();read(next);window.scrollTo(0,0);}
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.item-menu'))closeMenus();});
  window.WizardApp?.back.register({canGoBack:()=>!!document.querySelector('.item-menu[open]') || !!current,back:()=>{
    if(document.querySelector('.item-menu[open]')){closeMenus();return true;}
    if(!current)return false;const prev=stack.pop();if(prev)read(prev,{remember:false});else home();return true;
  }});
  loadList();const initial=new URLSearchParams(location.search).get('url');if(initial)read(initial);
})();
