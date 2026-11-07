/* Why Reader could not read a page, decided as early as possible, so the owner is
 * sent straight to the original instead of tapping "Open in your browser" again
 * (James, 7 Nov 2026). Reasons are metadata only; the page body never leaves here.
 *
 *   blocked     the site refuses Reader (bot wall, 401/403/429/451, challenge page)
 *   signin      the page redirects to a sign-in
 *   noarticle   the page loaded but has no readable article
 *   unavailable other HTTP failure, network error or timeout
 *   private     a private, tailnet or Wizard address Reader is never allowed to open
 *   busy        Reader is already reading two pages: retry, do not hand off
 *   invalid     not a web address: do not hand off
 * The shell remembers only blocked/signin/private hosts to skip Reader next time.
 */
import {UnsafeURL} from './network.mjs';

export class ReadFailure extends Error {
  constructor(message, reason) { super(message); this.reason = reason; }
}
const BLOCK_STATUS = new Set([401, 403, 407, 429, 451]);
const SIGNIN_HOST = /(^|\.)(cloudflareaccess\.com|okta\.com|auth0\.com|onelogin\.com)$|^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/;
const SIGNIN_PATH = /^\/(cdn-cgi\/access\/login|(u\/|account\/|accounts\/|users?\/)?(sign[-_]?in|log[-_]?in|auth\/login|sso)(\/|$|\.))/i;
// Markers that only appear on interstitial challenge/block pages, never ordinary articles
// (Cloudflare's ordinary jsd script and DataDome/PerimeterX tag scripts are deliberately absent).
const CHALLENGE = [/<title>\s*just a moment\.\.\.\s*<\/title>/i, /<title>\s*attention required! \| cloudflare\s*<\/title>/i,
  /window\._cf_chl_opt\b/, /geo\.captcha-delivery\.com\/captcha/i, /id=["']px-captcha["']/i, /incapsula incident id/i,
  /<title>\s*(access denied|are you a robot\??|verify you are human)\s*<\/title>/i];
const blocked = () => new ReadFailure('This site does not let Reader in.', 'blocked');
const signin = () => new ReadFailure('This page needs a sign-in.', 'signin');

export function signinURL(location) {
  try { const u = new URL(location); return SIGNIN_HOST.test(u.hostname.toLowerCase()) || SIGNIN_PATH.test(u.pathname); } catch { return false; }
}
/* The main document's first response, before Chrome renders it. Returns a ReadFailure to stop at once, or null. */
export function documentVerdict({status, headers = {}, body}) {
  if ([301, 302, 303, 307, 308].includes(status)) return headers.location && signinURL(headers.location) ? signin() : null;
  if (String(headers['cf-mitigated'] || '').toLowerCase() === 'challenge') return blocked();
  if (BLOCK_STATUS.has(status)) return status === 401 && /^(basic|bearer|digest|negotiate)/i.test(String(headers['www-authenticate'] || '')) ? signin() : blocked();
  if (status === 503 || status === 200) {
    const text = Buffer.isBuffer(body) && body.length < 256 * 1024 && /html/i.test(String(headers['content-type'] || '')) ? body.subarray(0, 65536).toString('latin1') : '';
    if (text && CHALLENGE.some(re => re.test(text))) return blocked();
  }
  if (status >= 400) return new ReadFailure('This page is not available right now.', 'unavailable');
  return null;
}
const HANDOFF = new Set(['blocked', 'signin', 'noarticle', 'unavailable', 'private']);
/* Error -> HTTP response for /api/reader. Plain owner words plus a reason the app and shell act on. */
export function failure(error, input) {
  let reason = error instanceof ReadFailure ? error.reason : 'unavailable';
  let message = error instanceof ReadFailure ? error.message : 'Reader could not read this page.';
  if (error instanceof UnsafeURL) {
    let web = false; try { web = /^https?:$/.test(new URL(input).protocol); } catch {}
    reason = !web ? 'invalid' : /lookup/i.test(error.message) ? 'unavailable' : 'private';
    message = error.message;
  } else if (/Reader could not find an article/.test(error?.message || '')) { reason = 'noarticle'; message = 'Reader could not find an article on this page.'; }
  else if (/too long|timeout/i.test(error?.message || '') || error?.name === 'TimeoutError') message = 'The page took too long to respond.';
  else if (/Reader is busy/.test(error?.message || '')) { reason = 'busy'; message = error.message; }
  else if (/too large/i.test(error?.message || '')) { reason = 'noarticle'; message = 'This page is too large for Reader.'; }
  return {status: error instanceof UnsafeURL ? 400 : 422, body: {error: message, reason, handoff: HANDOFF.has(reason)}};
}
