// Bot protection for sign-in (owner, 2026-10-30: Cloudflare Turnstile). Pure rules, no React, no network.
// Supabase Auth verifies the token SERVER-SIDE with the Turnstile secret (Auth setting security_captcha_secret); the app
// only obtains a token from Cloudflare's widget and passes it on the auth call. One token = one auth request (Turnstile
// tokens are single-use and expire after 300 s), so every "Send Code" takes a fresh one.
// No site key configured = no widget and no token: exactly today's behaviour. Sending a token while Supabase CAPTCHA is
// still off is harmless (Auth ignores it), so a build can carry this long before CAPTCHA is switched on.

const SITE_KEY = /^[0-9A-Za-z_-]{10,64}$/;

// app.json `extra` -> { siteKey, host } or null. host = the page origin the widget runs under (the WebView's baseUrl);
// it must be one of the hostnames allowed on the Turnstile widget.
export function turnstileConfig(extra) {
  const siteKey = typeof extra?.turnstileSiteKey === 'string' ? extra.turnstileSiteKey.trim() : '';
  const host = typeof extra?.turnstileHost === 'string' ? extra.turnstileHost.trim().replace(/\/+$/, '') : '';
  if (!SITE_KEY.test(siteKey) || !/^https:\/\/[a-z0-9.-]+$/i.test(host)) return null;
  return { siteKey, host };
}

// Turnstile's own language codes; anything else = 'auto' (the phone's language).
const TURNSTILE_LANGUAGE = { en: 'en', es: 'es', de: 'de', fr: 'fr', pt: 'pt-br', zh: 'zh-cn', vi: 'vi', ru: 'ru', ko: 'ko' };
export const turnstileLanguage = (lang) => TURNSTILE_LANGUAGE[lang] || 'auto';

// The page the native WebView loads (source.html + baseUrl = host). Values are JSON-encoded, never spliced as raw text.
// 'interaction-only': nothing is drawn unless Cloudflare needs the person to tick the box.
export function turnstileHtml({ siteKey, dark = false, language = 'auto' }) {
  const opts = JSON.stringify({ sitekey: siteKey, theme: dark ? 'dark' : 'light', language, action: 'login' });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center}</style></head><body>
<div id="ts"></div>
<script>
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
var wid;
function onTsLoad(){
  var o=${opts};
  o.size='flexible';o.appearance='interaction-only';o['refresh-expired']='auto';
  o.callback=function(t){post({type:'token',token:t})};
  o['error-callback']=function(c){post({type:'error',code:String(c)});return true};
  o['expired-callback']=function(){post({type:'expired'})};
  o['unsupported-callback']=function(){post({type:'error',code:'unsupported'})};
  o['timeout-callback']=function(){post({type:'error',code:'challenge_timeout'})};
  o['before-interactive-callback']=function(){post({type:'interactive'})};
  o['after-interactive-callback']=function(){post({type:'interactive_done'})};
  wid=turnstile.render('#ts',o);
}
window.resetTurnstile=function(){if(window.turnstile&&wid!==undefined){turnstile.reset(wid)}};
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTsLoad&render=explicit" async defer
  onerror="post({type:'error',code:'script'})"></script>
</body></html>`;
}

// A message posted by the widget page -> { type, token?, code? } or null (anything else is ignored).
export function parseWidgetMessage(raw) {
  let m;
  try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!m || typeof m.type !== 'string') return null;
  if (m.type === 'token') return typeof m.token === 'string' && m.token.length > 0 ? { type: 'token', token: m.token } : null;
  if (['error', 'expired', 'interactive', 'interactive_done'].includes(m.type)) {
    return m.type === 'error' ? { type: 'error', code: String(m.code ?? 'unknown') } : { type: m.type };
  }
  return null;
}

// A widget/network problem the person can retry: reads as a service failure (presentRecoverableError -> Try Again).
export function captchaUnavailableError(code = 'unavailable') {
  const e = new Error('Security check unavailable');
  e.code = 'captcha_unavailable';
  e.status = 503;
  e.captchaCode = code;
  return e;
}

// Supabase Auth refusing the token (missing / invalid / expired / reused). Never shown raw: retry with a fresh token.
export function isCaptchaRefusal(error) {
  if (!error) return false;
  return error.code === 'captcha_failed' || /captcha/i.test(String(error.message ?? ''));
}

// The options for supabase.auth.signInWithOtp / signUp / signInWithPassword. No token = no field (CAPTCHA off).
export const authCaptchaOptions = (token) => (token ? { captchaToken: token } : {});

// One token at a time, handed out once. take() resolves with the current token (or the next one to arrive), rejects on a
// widget error or when its timer runs out; after take() the token is gone and the widget must be reset for the next request.
// Two timers, never none: timeoutMs while the widget is working on its own (never loads / stops responding = 'timeout');
// interactiveTimeoutMs while Cloudflare shows its tick box, so a person still ticking is never cut off, yet a challenge
// that hangs ends too ('challenge_timeout'). Each switch restarts the waiting request's timer in full (the box closing
// without a token = a fresh timeoutMs). Every rejection reaches the screen's existing Try Again.
export function createCaptchaTokenStore({
  timeoutMs = 15000, interactiveTimeoutMs = 120000, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let token = null;
  let failure = null;
  let waiters = [];
  let interactive = false;
  const settle = (fn) => { const w = waiters; waiters = []; w.forEach(fn); };
  const arm = (w) => {
    if (w.timer != null) clearTimer(w.timer);
    const code = interactive ? 'challenge_timeout' : 'timeout';
    w.timer = setTimer(() => {
      w.timer = null;
      waiters = waiters.filter((x) => x !== w);
      w.fail(captchaUnavailableError(code));
    }, interactive ? interactiveTimeoutMs : timeoutMs);
  };
  return {
    onToken(t) { failure = null; interactive = false; if (waiters.length) { const w = waiters.shift(); w.resolve(t); } else token = t; },
    onError(code) { token = null; interactive = false; failure = captchaUnavailableError(code); settle((w) => w.reject(failure)); },
    onExpired() { token = null; },
    onInteractive() { interactive = true; waiters.forEach(arm); },
    onInteractiveDone() { interactive = false; waiters.forEach(arm); },
    isInteractive: () => interactive,
    hasToken: () => token != null,
    take() {
      if (token != null) { const t = token; token = null; return Promise.resolve(t); }
      if (failure) { const f = failure; failure = null; return Promise.reject(f); }
      return new Promise((resolve, reject) => {
        const w = { timer: null };
        const stop = () => { if (w.timer != null) { clearTimer(w.timer); w.timer = null; } };
        w.resolve = (t) => { stop(); resolve(t); };
        w.reject = (e) => { stop(); reject(e); };
        w.fail = reject;
        arm(w);
        waiters.push(w);
      });
    },
    clear() { token = null; failure = null; interactive = false; },
  };
}
