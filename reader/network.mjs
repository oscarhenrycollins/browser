/* All Reader network bytes cross this guard, including redirects and subresources.
 * Resolve once, reject mixed/private answers, and connect to that checked address.
 * Never let the HTTP client re-resolve (DNS rebinding), inherit proxies or cookies.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import ipaddr from 'ipaddr.js';

export class UnsafeURL extends Error {}
const own = new Set([os.hostname().toLowerCase(), ...(process.env.READER_DENY_HOSTS || '').toLowerCase().split(',')]);
const ownIPs = new Set(Object.values(os.networkInterfaces()).flat().map(a => a.address));
export function publicIP(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast' && !ownIPs.has(address);
  } catch { return false; }
}
export function webURL(input, base) {
  if (typeof input !== 'string' || input.length > 8192) throw new UnsafeURL('That address is not supported.');
  let u; try { u = new URL(input, base); } catch { throw new UnsafeURL('Enter a full web address.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname || (u.port && !['80','443'].includes(u.port)))
    throw new UnsafeURL('Only public http and https pages on standard ports can be read.');
  u.hash = ''; return u;
}
export async function destination(input, lookup = dns.lookup) {
  const u = webURL(input instanceof URL ? input.href : input);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (own.has(host) || host === 'localhost' || /\.(localhost|local|internal|lan|home|ts\.net)$/.test(host) || (!host.includes('.') && !ipaddr.isValid(host)))
    throw new UnsafeURL('Private addresses cannot be opened in Reader.');
  const answers = ipaddr.isValid(host) ? [{address:host, family:ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6}] :
    await Promise.race([lookup(host, {all:true, verbatim:true}), new Promise((_, reject) => { const t=setTimeout(() => reject(new UnsafeURL('The address lookup timed out.')), 3000); t.unref(); })]);
  if (!answers.length || answers.some(a => !publicIP(a.address))) throw new UnsafeURL('Private addresses cannot be opened in Reader.');
  return {url:u, address:answers[0].address, family:answers[0].family};
}
export async function safeFetch(input, {maxBytes = 8*1024*1024, timeout = 10000, signal, lookup, redirects = 5, follow = true} = {}) {
  let u = webURL(input instanceof URL ? input.href : input);
  for (let i = 0; i <= redirects; i++) {
    const d = await destination(u, lookup);
    const r = await new Promise((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).request(u, {
        method:'GET', agent:false, signal, timeout,
        lookup: (_host, opts, cb) => cb(null, opts?.all ? [{address:d.address, family:d.family}] : d.address, d.family),
        headers:{'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36', 'Accept':'*/*','Accept-Encoding':'identity'}
      }, res => {
        const chunks=[]; let size=0;
        if ([301,302,303,307,308].includes(res.statusCode)) { res.destroy(); resolve({status:res.statusCode,headers:res.headers,body:Buffer.alloc(0)}); return; }
        if (Number(res.headers['content-length']) > maxBytes || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); reject(new Error('The page is too large or uses an unsupported encoding.')); return; }
        res.on('data', b => { size+=b.length; if(size>maxBytes) { res.destroy(new Error('The page is too large.')); } else chunks.push(b); });
        res.on('error',reject); res.on('end',() => resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      });
      req.on('timeout',()=>req.destroy(new Error('The page took too long to respond.'))); req.on('error',reject); req.end();
    });
    if ([301,302,303,307,308].includes(r.status)) {
      if (!r.headers.location) throw new Error('Invalid redirect.');
      const next=webURL(r.headers.location,u);
      await destination(next,lookup); // validate before Chrome receives any Location.
      if(!follow) return {...r,headers:{...r.headers,location:next.href},url:u.href};
      if (i === redirects) throw new Error('Too many redirects.');
      u=next; continue;
    }
    return {...r,url:u.href};
  }
}
