/* After DOMContentLoaded a page may still be fetching the data its scripts render. Reader used to wait a fixed
 * 1.2 s on every page; a page whose guarded requests have all finished and stayed quiet is ready sooner.
 * The upper bound is unchanged (maxMs), so a busy page still gets exactly the old wait. */
export class Activity {
  constructor(now=()=>performance.now()) {this.now=now;this.inflight=0;this.last=now();}
  start() {this.inflight++;this.last=this.now();}
  end() {this.inflight=Math.max(0,this.inflight-1);this.last=this.now();}
  async settle({minMs=300,quietMs=250,maxMs=1200,step=50,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
    const t0=this.now();
    for(;;) {
      const waited=this.now()-t0;
      if(waited>=maxMs) return {waited,quiet:false};
      if(waited>=minMs && this.inflight===0 && this.now()-this.last>=quietMs) return {waited,quiet:true};
      await sleep(Math.min(step,maxMs-waited));
    }
  }
}
