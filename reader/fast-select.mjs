/* Faster answers for the few selector shapes Defuddle asks thousands of times, in Reader's inert extraction window
 * only. jsdom's engine costs ~35 ms per attribute selector on a 5,000-element page and Defuddle's boilerplate list
 * has 166 of them, so Wikipedia spent ~4 s here (James wants Reader near Brave's speed, 7 Nov 2026).
 *
 * Exactness rule: the engine stays the authority. A part is answered in plain JS only when its meaning is
 * unambiguous (a tag name, attribute presence, or an attribute test with the `i` flag); every other part is still
 * decided by the engine's own matches(), merely skipped for elements that cannot carry its rightmost key. Anything
 * this code does not fully understand (:scope, namespaces, escapes, odd syntax) goes to the engine unchanged.
 */
import {DOMSelector} from '@asamuzakjp/dom-selector';

const HTML_NS='http://www.w3.org/1999/xhtml';
const lower=s=>s.replace(/[A-Z]/g,c=>c.toLowerCase()); // ASCII case-insensitive, as CSS's `i` flag
export function splitSelectorList(selector) {
  const parts=[];let depth=0,quote='',start=0;
  for(let i=0;i<selector.length;i++) {
    const c=selector[i];
    if(quote) { if(c==='\\') i++; else if(c===quote) quote=''; continue; }
    if(c==='"' || c==="'") quote=c; else if(c==='\\') i++;
    else if(c==='(' || c==='[') depth++; else if(c===')' || c===']') depth--;
    else if(c===',' && depth===0) { parts.push(selector.slice(start,i).trim()); start=i+1; }
    if(depth<0) return null;
  }
  if(quote || depth) return null;
  parts.push(selector.slice(start).trim());
  return parts.every(Boolean) ? parts : null;
}
// HTML's legacy attributes whose values selectors compare case-insensitively without an `i` flag (HTML §4.16.2).
// A test on one of them without `i` is left to the engine.
const LEGACY=new Set('accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare defer dir direction disabled enctype face frame hreflang http-equiv lang language link media method multiple nohref noresize noshade nowrap readonly rel rev rules scope scrolling selected shape target text type valign valuetype vlink'.split(' '));
const IDENT='-?[a-zA-Z_][a-zA-Z0-9_-]*';
// One compound selector with no combinator and no pseudo-class: tag? then .class / #id / [attr] / [attr op "v" i?].
const SIMPLE=new RegExp(`^([a-zA-Z][a-zA-Z0-9-]*)?((?:\\.${IDENT}|#${IDENT}|\\[[a-zA-Z][a-zA-Z0-9-]*(?:[*^$~|]?="[^"\\\\]*"(?:\\s+i)?)?\\])*)$`);
const PIECE=new RegExp(`\\.(${IDENT})|#(${IDENT})|\\[([a-zA-Z][a-zA-Z0-9-]*)(?:([*^$~|]?=)"([^"\\\\]*)"(\\s+i)?)?\\]`,'g');
const words=s=>s.split(/[\t\n\f\r ]+/);
function attrTest(name,op,value,insensitive) {
  const fold=insensitive ? lower : x=>x, v=fold(value);
  return el=>{
    const got=el.getAttribute(name); if(got===null) return false;
    const a=fold(got);
    switch(op) {
      case '=': return a===v;
      case '*=': return v!=='' && a.includes(v);
      case '^=': return v!=='' && a.startsWith(v);
      case '$=': return v!=='' && a.endsWith(v);
      case '~=': return v!=='' && !/\s/.test(v) && words(a).includes(v);
      case '|=': return a===v || a.startsWith(v+'-');
    }
    return false;
  };
}
function compound(part,quirks) {
  const m=SIMPLE.exec(part); if(!m || (!m[1] && !m[2])) return null;
  const tests=[];
  if(m[1]) { const t=lower(m[1]), raw=m[1]; tests.push(el=>el.namespaceURI===HTML_NS ? el.localName===t : el.localName===raw); }
  for(const p of m[2].matchAll(PIECE)) {
    // Class and id compare case-sensitively except in quirks mode; leave quirks pages to the engine.
    if(p[1]!==undefined) { if(quirks) return null; const c=p[1]; tests.push(el=>{const v=el.getAttribute('class');return v!==null && words(v).includes(c);}); }
    else if(p[2]!==undefined) { if(quirks) return null; const id=p[2]; tests.push(el=>el.getAttribute('id')===id); }
    else if(!p[4]) { const n=p[3]; tests.push(el=>el.hasAttribute(n)); }
    else {
      // Attribute names as written: getAttribute() already folds case for HTML elements and not for SVG/MathML, as CSS does.
      if(!p[6] && LEGACY.has(lower(p[3]))) return null;
      tests.push(attrTest(p[3],p[4],p[5],!!p[6]));
    }
  }
  return tests.length===1 ? tests[0] : el=>{for(const t of tests) if(!t(el)) return false; return true;};
}
// The key an element must carry for the part's rightmost compound to match it (rule hashing), or null for "any".
function rightmostKey(part) {
  let depth=0,quote='',start=0;
  for(let i=0;i<part.length;i++) {
    const c=part[i];
    if(quote) { if(c==='\\') i++; else if(c===quote) quote=''; continue; }
    if(c==='"' || c==="'") quote=c; else if(c==='(' || c==='[') depth++; else if(c===')' || c===']') depth--;
    else if(depth===0 && /[\s>+~]/.test(c)) start=i+1;
  }
  const last=part.slice(start).trim();
  let m;
  if((m=/^([a-zA-Z][a-zA-Z0-9-]*)/.exec(last))) return 'tag:'+lower(m[1]);
  if((m=/^\.([a-zA-Z_][a-zA-Z0-9_-]*)/.exec(last))) return 'class:'+lower(m[1]);
  if((m=/^#([a-zA-Z_][a-zA-Z0-9_-]*)/.exec(last))) return 'id:'+lower(m[1]);
  if((m=/^\[([a-zA-Z][a-zA-Z0-9-]*)/.exec(last))) return 'attr:'+lower(m[1]);
  return null;
}
function compile(part,quirks) {
  if(/\\|\||:scope|:host|::/.test(part.replace(/"[^"]*"/g,'""'))) return null;
  const test=compound(part,quirks);
  return test ? {test} : {key:rightmostKey(part),part};
}
function keysOf(el,out) {
  out.length=0;
  out.push('tag:'+lower(el.localName));
  for(const name of el.getAttributeNames()) out.push('attr:'+lower(name));
  const id=el.getAttribute('id'); if(id) out.push('id:'+lower(id));
  const cls=el.getAttribute('class'); if(cls) for(const c of cls.split(/[\t\n\f\r ]+/)) if(c) out.push('class:'+lower(c));
  return out;
}
export function plan(selector,quirks=false) {
  const parts=splitSelectorList(selector); if(!parts) return null;
  const direct=[],keyed=new Map(),any=[];
  for(const part of parts) {
    const c=compile(part,quirks); if(!c) return null;
    if(c.test) direct.push(c.test);
    else if(c.key) { if(!keyed.has(c.key)) keyed.set(c.key,[]); keyed.get(c.key).push(c.part); }
    else any.push(c.part);
  }
  return {direct,keyed,any,simple:!keyed.size && !any.length};
}
export function install(window) {
  const doc=window.document, engine=new DOMSelector(window,doc,{maxLength:65536});
  const E=window.Element.prototype, D=window.Document.prototype, F=window.DocumentFragment.prototype;
  const native={matches:E.matches,closest:E.closest,eqsa:E.querySelectorAll,eqs:E.querySelector,dqsa:D.querySelectorAll,dqs:D.querySelector,fqsa:F.querySelectorAll,fqs:F.querySelector};
  const plans=new Map();
  const planFor=selector=>{
    if(typeof selector!=='string') return null;
    if(!plans.has(selector)) { let p=null; try { p=plan(selector,doc.compatMode==='BackCompat'); } catch { p=null; } plans.set(selector,p); }
    return plans.get(selector);
  };
  const keys=[];
  const matchOne=(el,p)=>{
    for(const t of p.direct) if(t(el)) return true;
    if(p.simple) return false;
    const seen=new Set();
    for(const k of keysOf(el,keys)) for(const part of p.keyed.get(k) || []) if(!seen.has(part)) { seen.add(part); if(native.matches.call(el,part)) return true; }
    for(const part of p.any) if(native.matches.call(el,part)) return true;
    return false;
  };
  // A list the planner understands takes this path (long lists also skip jsdom's 2 KiB limit); the rest go native.
  const usable=(selector,p)=>!!p;
  const all=(root,selector,fallback)=>{
    const p=planFor(selector);
    if(!usable(selector,p)) return selector?.length>2048 ? engine.querySelectorAll(selector,root) : fallback.call(root,selector);
    const out=[];for(const el of root.getElementsByTagName('*')) if(matchOne(el,p)) out.push(el);return out;
  };
  const first=(root,selector,fallback)=>{
    const p=planFor(selector);
    if(!usable(selector,p)) return selector?.length>2048 ? engine.querySelector(selector,root) : fallback.call(root,selector);
    for(const el of root.getElementsByTagName('*')) if(matchOne(el,p)) return el;
    return null;
  };
  E.querySelectorAll=function(s){return all(this,s,native.eqsa);};
  D.querySelectorAll=function(s){return all(this,s,native.dqsa);};
  E.querySelector=function(s){return first(this,s,native.eqs);};
  D.querySelector=function(s){return first(this,s,native.dqs);};
  // DocumentFragment has no getElementsByTagName: keep the engine, only lifting the length limit.
  F.querySelectorAll=function(s){return typeof s==='string' && s.length>2048 ? engine.querySelectorAll(s,this) : native.fqsa.call(this,s);};
  F.querySelector=function(s){return typeof s==='string' && s.length>2048 ? engine.querySelector(s,this) : native.fqs.call(this,s);};
  E.closest=function(s){
    const p=planFor(s); if(!p) return native.closest.call(this,s);
    for(let el=this;el;el=el.parentElement) if(matchOne(el,p)) return el;
    return null;
  };
  E.matches=function(s){const p=planFor(s); return p ? matchOne(this,p) : native.matches.call(this,s);};
}
