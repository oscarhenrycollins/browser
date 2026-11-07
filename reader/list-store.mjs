/* Owner metadata only. One service writer; serialize read/modify/atomic rename.
 * No article HTML, browser storage, cookies or caller-provided metadata is persisted. */
import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {webURL} from './network.mjs';

export class ListStore {
  constructor(dir) { this.dir=dir; this.tail=Promise.resolve(); }
  async rows() {
    try {
      const rows=JSON.parse(await readFile(join(this.dir,'list.json'),'utf8'));
      if(!Array.isArray(rows)) throw Error('Invalid reading list');
      return rows;
    } catch(e) { if(e.code==='ENOENT') return []; throw e; }
  }
  async list() { await this.tail; return (await this.rows()).sort((a,b)=>b.saved_at.localeCompare(a.saved_at) || b.id.localeCompare(a.id)); }
  change(fn) {
    const next=this.tail.then(async()=>{
      await mkdir(this.dir,{recursive:true,mode:0o700});
      const rows=await this.rows(), result=fn(rows);
      const temp=join(this.dir,'.list-'+randomUUID()+'.tmp');
      try {
        const f=await open(temp,'wx',0o600);
        try { await f.writeFile(JSON.stringify(rows)+'\n'); await f.sync(); } finally { await f.close(); }
        await rename(temp,join(this.dir,'list.json'));
        const dir=await open(this.dir,'r'); try { await dir.sync(); } finally { await dir.close(); }
      } finally { await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
      return result;
    });
    this.tail=next.catch(()=>{}); return next;
  }
  add(article) {
    const canonical_url=webURL(article.canonicalURL || article.url).href;
    return this.change(rows=>{
      const existing=rows.find(r=>r.canonical_url===canonical_url);
      if(existing) return existing; // Repeated Save never changes saved/read dates.
      if(rows.length>=10000) throw Error('Reading list is full.');
      const text=v=>String(v || '').slice(0,2048);
      const row={id:randomUUID(),url:webURL(article.url).href,canonical_url,title:text(article.title),site:text(article.siteName),byline:text(article.byline),published:text(article.publishedTime),favicon:typeof article.favicon==='string' && article.favicon.startsWith('api/image?url=')?article.favicon.slice(0,16384):'',saved_at:new Date().toISOString(),read_at:null};
      rows.push(row);return row;
    });
  }
  patch(id,read) { return this.change(rows=>{const row=rows.find(r=>r.id===id);if(!row)return null;row.read_at=read?(row.read_at || new Date().toISOString()):null;return row;}); }
  remove(id) { return this.change(rows=>{const i=rows.findIndex(r=>r.id===id);if(i<0)return false;rows.splice(i,1);return true;}); }
}
