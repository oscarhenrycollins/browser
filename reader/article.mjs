import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {Readability} from '@mozilla/readability';
import {DefuddleClass} from 'defuddle/node';
import {install as fastSelectors} from './fast-select.mjs';
import {webURL} from './network.mjs';

const tags = ['picture','source','p','div','section','article','h1','h2','h3','h4','h5','h6','a','img','figure','figcaption','blockquote','ul','ol','li','strong','b','em','i','s','del','code','pre','kbd','br','hr','table','thead','tbody','tr','th','td','sup','sub','dl','dt','dd'];
export function cleanArticle(html, base) {
  const dom = new JSDOM('', {url:base}); // No runScripts, resources or browser APIs.
  try {
    const purify = createDOMPurify(dom.window);
    const node = purify.sanitize(html, {ALLOWED_TAGS:tags, ALLOWED_ATTR:['href','src','srcset','alt','title','data-src','data-original'], ALLOW_DATA_ATTR:false, RETURN_DOM:true});
    for (const a of node.querySelectorAll('a')) {
      const href=a.getAttribute('href'); a.removeAttribute('href');
      if (href?.startsWith('#') && /^#[\w-]+$/.test(href)) continue; // ids are deliberately not admitted.
      try { const target=webURL(href,base); const file=/\.(apk|aab|pdf|zip|7z|tar|t?gz|dmg|pkg|exe|msi|csv|xlsx?|docx?|pptx?|epub|mp3|m4a|aac|wav|flac|mp4|mov|mkv|webm)$/i.test(target.pathname); a.setAttribute('href',file?target.href:'?url='+encodeURIComponent(target.href)); } catch {}
    }
    // Responsive images often carry their only URL in srcset or a <picture><source>; take the first
    // candidate, then drop srcset/source so every image still goes through the single proxied src.
    const first = set => (set || '').split(',').map(s => s.trim().split(/\s+/)[0]).find(Boolean);
    for (const img of node.querySelectorAll('img')) {
      const source=img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') ||
        first(img.getAttribute('srcset')) || first(img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset'));
      img.removeAttribute('src'); img.removeAttribute('data-src'); img.removeAttribute('data-original'); img.removeAttribute('srcset');
      try { img.setAttribute('src','api/image?url='+encodeURIComponent(webURL(source,base).href)); img.setAttribute('loading','lazy'); img.setAttribute('referrerpolicy','no-referrer'); } catch { img.remove(); }
    }
    for (const s of node.querySelectorAll('source')) s.remove();
    for (const p of node.querySelectorAll('picture')) p.replaceWith(...p.childNodes);
    for (const el of node.querySelectorAll('[srcset]')) el.removeAttribute('srcset');
    return node.innerHTML;
  } finally { dom.window.close(); }
}
const suffix = title => { const parts=(title||'').split(/\s+[-|–—·]\s+/); const last=parts.length>1?parts.at(-1).trim():''; return last && last.length<=40 && !/^by\s/i.test(last) ? last : ''; };
export function extract(renderedHTML, finalURL) {
  const dom=new JSDOM(renderedHTML,{url:finalURL});
  try {
    const doc=dom.window.document;
    if(doc.getElementsByTagName('*').length>50000) throw new Error('This page is too large for Reader.');
    // The proxy serves bitmaps only, so prefer bitmap icons over SVG ones.
    const icons=[...doc.querySelectorAll('link[rel~="apple-touch-icon"],link[rel~="icon"]')].filter(l=>!/svg/i.test(l.getAttribute('type')||'') && !/\.svg(\?|$)/i.test(l.getAttribute('href')||''));
    const icon=icons[0]?.getAttribute('href') || '';
    const named=doc.querySelector('meta[property="og:site_name"]')?.content || doc.querySelector('meta[name="application-name"]')?.content || suffix(doc.title);
    const site=named || new URL(finalURL).hostname;
    const canonical=doc.querySelector('link[rel="canonical"]')?.href;
    const date=doc.querySelector('meta[property="article:published_time"],meta[name="date"],meta[name="pubdate"]')?.content || doc.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    // Use the Node entry point, but ONLY its synchronous DOM parser. Async site
    // extractors can fetch third-party APIs outside our guarded render transport.
    // Replies are not the article (notably GitHub bot reviews and comment tables).
    // Defuddle reads THIS document (metadata above is already taken) and parses its own clone, so a page is
    // parsed once, not twice: the second parse was ~0.3-0.5 s of every Wikipedia read. Readability, the rare
    // fallback, still receives an untouched DOM of its own below.
    // Defuddle's built-in boilerplate selector list exceeds jsdom 30's 2 KiB per-selector default, and jsdom's
    // engine is slow for its thousands of simple lookups: fast-select.mjs answers them exactly, in this inert
    // extraction window only (including Defuddle's clones). DOMPurify and Readability are unchanged.
    fastSelectors(dom.window);
    let result;
    try { result=new DefuddleClass(doc,{url:finalURL,useAsync:false,includeReplies:new URL(finalURL).hostname==='github.com' ? false : 'extractors',markdown:false,fetch:()=>{throw new Error('Extraction cannot fetch');}}).parse(); } catch {}
    const usable = html => {
      const fragment=JSDOM.fragment(html || '');
      return (fragment.textContent || '').trim().length>=150;
    };
    let html=result?.content ? cleanArticle(result.content,finalURL) : '';
    let extractor='defuddle';
    if (!usable(html)) {
      // Defuddle mutates its document; Readability must receive the original DOM.
      const fresh=new JSDOM(renderedHTML,{url:finalURL});
      let fallback;
      try { fallback=new Readability(fresh.window.document,{maxElemsToParse:50000,charThreshold:150}).parse(); } finally { fresh.window.close(); }
      result=fallback && {title:fallback.title,site:fallback.siteName,author:fallback.byline,published:fallback.publishedTime,description:fallback.excerpt};
      html=fallback?.content ? cleanArticle(fallback.content,finalURL) : '';
      extractor='readability';
    }
    if (!result || !usable(html)) throw new Error('Reader could not find an article on this page. It may need a sign-in or a check in your browser.');
    const proxy = value => {try {return 'api/image?url='+encodeURIComponent(webURL(value,finalURL).href);} catch {return '';}};
    // Keep the bitmap icon preference: Defuddle may select an SVG favicon which
    // the deliberately bitmap-only proxy cannot serve.
    const bitmapIcon=result.favicon && !/\.svg(?:[?#]|$)/i.test(result.favicon) ? result.favicon : '';
    const favicon=proxy(icon || bitmapIcon || '/favicon.ico');
    let canonicalURL=finalURL; try { if(canonical) canonicalURL=webURL(canonical,finalURL).href; } catch {}
    return {title:result.title || site,siteName:named || result.site || site,url:finalURL,canonicalURL,byline:result.author || '',publishedTime:result.published || date,favicon,image:result.image ? proxy(result.image) : '',description:result.description || '',extractor,html};
  } finally { dom.window.close(); }
}
