import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Activity} from '../settle.mjs';
// A fake clock: settle() only advances through its sleep().
function clock(){let t=0;return {now:()=>t,sleep:async ms=>{t+=ms;}};}
test('a quiet page is read after the short minimum, not the old fixed 1.2 s',async()=>{
  const c=clock(),a=new Activity(c.now);
  const r=await a.settle({sleep:c.sleep});assert.equal(r.quiet,true);assert.ok(r.waited>=300 && r.waited<400,String(r.waited));
});
test('a page still fetching waits up to exactly the old 1.2 s bound',async()=>{
  const c=clock(),a=new Activity(c.now);a.start();
  const r=await a.settle({sleep:c.sleep});assert.equal(r.quiet,false);assert.equal(r.waited,1200);
});
test('quiet means 250 ms with nothing in flight after the last request finished',async()=>{
  const c=clock(),a=new Activity(c.now);a.start();
  const sleep=async ms=>{await c.sleep(ms);if(c.now()===500)a.end();};
  const r=await a.settle({sleep});assert.equal(r.quiet,true);assert.ok(r.waited>=750 && r.waited<850,String(r.waited));
});
test('render path: images get a blank pixel, settle replaces the fixed wait, phases are logged without URLs',async()=>{
  const src=await readFile(new URL('../render.mjs',import.meta.url),'utf8');
  assert.match(src,/req\.resourceType\(\)==='image'\) return await route\.fulfill\(\{status:200,headers:\{'content-type':'image\/gif'/);
  assert.doesNotMatch(src,/waitForTimeout\(1200\)/);
  assert.match(src,/activity\.settle\(\{maxMs:1200\}\)/);
  assert.match(src,/console\.log\('reader timing',host,/);
});
