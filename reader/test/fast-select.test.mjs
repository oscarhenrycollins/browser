import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {DOMSelector} from '@asamuzakjp/dom-selector';
import {install,plan,splitSelectorList} from '../fast-select.mjs';
const require=createRequire(import.meta.url);
const C=require(new URL('../node_modules/defuddle/dist/constants.js',import.meta.url).pathname);
const root=new URL('./fixtures/corpus/',import.meta.url);
const rows=JSON.parse(readFileSync(new URL('manifest.json',root))).filter(r=>r.file);
// Every selector shape Defuddle asks for, plus edge cases the fast path must leave alone or answer exactly.
const lists=[C.EXACT_SELECTORS_JOINED,C.TEST_ATTRIBUTES_SELECTOR,C.FOOTNOTE_LIST_SELECTORS,C.FOOTNOTE_INLINE_REFERENCES,
  '[data-defuddle]','pre','code, pre','p, div, section, article','h1','wbr','math, [data-mathml], .katex-mathml','[data-line], .line',
  'a [class*="sr-only"], a [class*="visually-hidden"]','INPUT[TYPE="CHECKBOX"]','[REL="nofollow"]','a[rel="NOFOLLOW"]','svg[viewBox]','[viewbox]',
  '[class~="mw-heading"]','[lang|="en"]','[id^="cite" i]','[href$=".pdf"]','[href*=""]','[title=""]','.MW-HEADING','#Footer','div#content.mw-body',
  ':scope > div','div > p:first-child','li:not(.x) a','[data-x="a,b"]','a\\:b',...C.EXACT_SELECTORS.filter((_,i)=>i%8===0)].filter(s=>typeof s==='string' && s);
test('selector lists split only at top-level commas',()=>{
  assert.deepEqual(splitSelectorList('a, [x="1,2"], :is(b, c)'),['a','[x="1,2"]',':is(b, c)']);
  assert.equal(splitSelectorList('a[x="1'),null);assert.equal(splitSelectorList('a,,b'),null);
  assert.equal(plan(':scope > a'),null,':scope stays with the engine');assert.equal(plan('svg|a'),null,'namespaces stay with the engine');
  assert.ok(plan('input[type="checkbox"]').keyed.size,'legacy case-insensitive attribute without i stays with the engine');
  assert.ok(plan('.Promo',true).keyed.size,'quirks-mode class matching stays with the engine');
});
for(const row of rows) test('fast selectors are exact on real page: '+row.id,()=>{
  const html=readFileSync(new URL(row.file,root),'utf8'), url=row.finalURL || row.url;
  const fast=new JSDOM(html,{url}), slow=new JSDOM(html,{url});
  try {
    install(fast.window);
    const engine=new DOMSelector(slow.window,slow.window.document,{maxLength:65536});
    const fa=[...fast.window.document.getElementsByTagName('*')], sa=[...slow.window.document.getElementsByTagName('*')];
    const fi=new Map(fa.map((el,i)=>[el,i]));
    const ids=list=>[...list].map(el=>fi.get(el));
    const sids=list=>{const m=new Map(sa.map((el,i)=>[el,i]));return [...list].map(el=>m.get(el));};
    const samples=fa.filter((_,i)=>i%7===0).slice(0,150), sampleIdx=samples.map(el=>fi.get(el));
    const scopes=[fast.window.document.body,...fa.filter(el=>/^(main|article|div)$/.test(el.localName)).slice(0,1)].filter(Boolean);
    for(const sel of lists) {
      let expected; try { expected=sids(engine.querySelectorAll(sel,slow.window.document)); } catch { assert.throws(()=>fast.window.document.querySelectorAll(sel)); continue; }
      assert.deepEqual(ids(fast.window.document.querySelectorAll(sel)),expected,'document qsa '+sel.slice(0,80));
      assert.equal(fi.get(fast.window.document.querySelector(sel)) ?? null,expected[0] ?? null,'document qs '+sel.slice(0,80));
      for(const scope of scopes) {
        const s=sa[fi.get(scope)];
        assert.deepEqual(ids(scope.querySelectorAll(sel)),sids(engine.querySelectorAll(sel,s)),'element qsa '+sel.slice(0,80));
      }
      if(sel.length>2048) continue; // matches/closest are never asked with the long list
      for(const i of sampleIdx) {
        assert.equal(fa[i].matches(sel),sa[i].matches(sel),'matches '+sel.slice(0,80));
        assert.equal(fi.get(fa[i].closest(sel)) ?? null,(c=>c?sa.indexOf(c):null)(sa[i].closest(sel)),'closest '+sel.slice(0,80));
      }
    }
  } finally { fast.window.close(); slow.window.close(); }
});
