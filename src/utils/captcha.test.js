import fs from 'fs';
import path from 'path';
import {
  turnstileConfig, turnstileHtml, turnstileLanguage, parseWidgetMessage, createCaptchaTokenStore,
  isCaptchaRefusal, captchaUnavailableError, authCaptchaOptions,
} from './captcha';
import { recoverableErrorCopy } from './recoverableError';

const KEY = '0x4AAAAAAAB1234567890abc';
const HOST = 'https://allenklein94.github.io';

describe('Turnstile config', () => {
  test('no site key (today) = off: no widget, no token', () => {
    expect(turnstileConfig({ turnstileSiteKey: '', turnstileHost: HOST })).toBeNull();
    expect(turnstileConfig(undefined)).toBeNull();
    expect(authCaptchaOptions(null)).toEqual({});
  });
  test('a valid key + https host = on; junk is refused', () => {
    expect(turnstileConfig({ turnstileSiteKey: KEY, turnstileHost: `${HOST}/` })).toEqual({ siteKey: KEY, host: HOST });
    expect(turnstileConfig({ turnstileSiteKey: '$TURNSTILE', turnstileHost: HOST })).toBeNull();
    expect(turnstileConfig({ turnstileSiteKey: KEY, turnstileHost: 'http://x.io' })).toBeNull();
    expect(turnstileConfig({ turnstileSiteKey: 'a"b</script>', turnstileHost: HOST })).toBeNull();
  });
  test('the app language maps to Turnstile codes, else the phone language', () => {
    expect(turnstileLanguage('zh')).toBe('zh-cn');
    expect(turnstileLanguage('ht')).toBe('auto');
  });
});

describe('the widget page', () => {
  const html = turnstileHtml({ siteKey: KEY, dark: true, language: 'es' });
  test('loads only Cloudflare\'s script, explicit render, invisible unless interaction is needed', () => {
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTsLoad&render=explicit');
    expect(html).toContain("o.appearance='interaction-only'");
    expect(html).toContain(JSON.stringify({ sitekey: KEY, theme: 'dark', language: 'es', action: 'login' }));
    expect(html.match(/<script/g)).toHaveLength(2);
  });
  test('script load failure, errors, expiry and interaction all reach the app', () => {
    ["onerror=\"post({type:'error',code:'script'})\"", "type:'error'", "type:'expired'", "type:'interactive'", "type:'token'"]
      .forEach((s) => expect(html).toContain(s));
  });
  test('messages are parsed strictly', () => {
    expect(parseWidgetMessage('{"type":"token","token":"abc"}')).toEqual({ type: 'token', token: 'abc' });
    expect(parseWidgetMessage('{"type":"token","token":""}')).toBeNull();
    expect(parseWidgetMessage('{"type":"error","code":110200}')).toEqual({ type: 'error', code: '110200' });
    expect(parseWidgetMessage('not json')).toBeNull();
    expect(parseWidgetMessage('{"type":"navigate"}')).toBeNull();
  });
});

describe('one single-use token per request', () => {
  const fakeTimers = () => {
    const timers = [];
    return { timers, setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: (fn) => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); } };
  };
  test('a ready token is handed out once', async () => {
    const s = createCaptchaTokenStore();
    s.onToken('t1');
    await expect(s.take()).resolves.toBe('t1');
    expect(s.hasToken()).toBe(false);
  });
  test('a tap before the token waits for it', async () => {
    const f = fakeTimers();
    const s = createCaptchaTokenStore(f);
    const p = s.take();
    s.onToken('t2');
    await expect(p).resolves.toBe('t2');
    expect(f.timers).toHaveLength(0);
  });
  test('no token in time = a retryable "couldn\'t complete that", never a hang', async () => {
    const f = fakeTimers();
    const s = createCaptchaTokenStore(f);
    const p = s.take();
    f.timers[0]();
    await expect(p).rejects.toMatchObject({ code: 'captcha_unavailable', captchaCode: 'timeout' });
  });
  test('a widget error rejects waiting and the next request; a later token recovers', async () => {
    const s = createCaptchaTokenStore(fakeTimers());
    const p = s.take();
    s.onError('110200');
    await expect(p).rejects.toMatchObject({ captchaCode: '110200' });
    s.onError('300010');
    await expect(s.take()).rejects.toMatchObject({ captchaCode: '300010' });
    s.onToken('t3');
    await expect(s.take()).resolves.toBe('t3');
  });
  test('an expired token is never sent', async () => {
    const f = fakeTimers();
    const s = createCaptchaTokenStore(f);
    s.onToken('old');
    s.onExpired();
    const p = s.take();
    s.onToken('new');
    await expect(p).resolves.toBe('new');
  });
});

describe('Cloudflare\'s tick box never gets cut off, and nothing waits forever', () => {
  // records each timer's duration; fire() runs the live one
  const clock = () => {
    const live = [];
    return {
      live,
      setTimer: (fn, ms) => { const t = { fn, ms }; live.push(t); return t; },
      clearTimer: (t) => { const i = live.indexOf(t); if (i >= 0) live.splice(i, 1); },
      fire() { const t = live.shift(); t.fn(); },
    };
  };
  const make = (c) => createCaptchaTokenStore({ timeoutMs: 15000, interactiveTimeoutMs: 120000, ...c });

  test('a challenge solved on its own: token at once, no timer left', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    expect(c.live.map((t) => t.ms)).toEqual([15000]);
    s.onToken('ok');
    await expect(p).resolves.toBe('ok');
    expect(c.live).toHaveLength(0);
  });
  test('slow human: the box appearing swaps the 15 s limit for the long one; ticking late still succeeds', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    s.onInteractive();
    expect(c.live.map((t) => t.ms)).toEqual([120000]); // the 15 s timer is gone, not just paused behind another
    expect(s.isInteractive()).toBe(true);
    s.onInteractiveDone();
    s.onToken('ticked');
    await expect(p).resolves.toBe('ticked');
    expect(c.live).toHaveLength(0);
    expect(s.isInteractive()).toBe(false);
  });
  test('the box shown BEFORE the tap: the request starts on the long limit', async () => {
    const c = clock(); const s = make(c);
    s.onInteractive();
    const p = s.take();
    expect(c.live.map((t) => t.ms)).toEqual([120000]);
    s.onToken('t');
    await expect(p).resolves.toBe('t');
  });
  test('box closes without a token (cancelled / dismissed): a fresh 15 s, then the retryable timeout', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    s.onInteractive();
    s.onInteractiveDone();
    expect(c.live.map((t) => t.ms)).toEqual([15000]);
    c.fire();
    await expect(p).rejects.toMatchObject({ code: 'captcha_unavailable', status: 503, captchaCode: 'timeout' });
  });
  test('a stuck challenge ends too (never an endless wait)', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    s.onInteractive();
    c.fire();
    await expect(p).rejects.toMatchObject({ captchaCode: 'challenge_timeout', status: 503 });
    expect(c.live).toHaveLength(0);
  });
  test('the widget never loads: the 15 s limit still applies', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    c.fire();
    await expect(p).rejects.toMatchObject({ captchaCode: 'timeout' });
  });
  test('a widget failure (incl. Cloudflare\'s own challenge timeout) during the box ends the wait at once', async () => {
    const c = clock(); const s = make(c);
    const p = s.take();
    s.onInteractive();
    s.onError('challenge_timeout');
    await expect(p).rejects.toMatchObject({ captchaCode: 'challenge_timeout' });
    expect(c.live).toHaveLength(0);
    expect(s.isInteractive()).toBe(false);
  });
  test('retry after a failure: reset, fresh token, the next request succeeds on the normal limit', async () => {
    const c = clock(); const s = make(c);
    const first = s.take();
    s.onInteractive();
    c.fire();
    await expect(first).rejects.toMatchObject({ captchaCode: 'challenge_timeout' });
    s.clear(); // the screen resets the widget after every request
    const again = s.take();
    expect(c.live.map((t) => t.ms)).toEqual([15000]);
    s.onToken('fresh');
    await expect(again).resolves.toBe('fresh');
  });
  test('wiring: the page reports the box + Cloudflare\'s challenge timeout; the hook routes both to the store', () => {
    const page = turnstileHtml({ siteKey: '0x4AAAAAAAtest_key' });
    expect(page).toMatch(/before-interactive-callback/);
    expect(page).toMatch(/after-interactive-callback/);
    expect(page).toMatch(/timeout-callback'\]=function\(\)\{post\(\{type:'error',code:'challenge_timeout'\}\)/);
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const hook = read('hooks/useAuthCaptcha.js');
    expect(hook).toMatch(/'interactive'\) store\.onInteractive\(\)/);
    expect(hook).toMatch(/'interactive_done'\) store\.onInteractiveDone\(\)/);
    const web = read('components/TurnstileWidget.web.js');
    expect(web).toMatch(/before-interactive-callback/);
    expect(web).toMatch(/after-interactive-callback/);
    expect(web).toMatch(/'timeout-callback'/);
  });
});

describe('failures read as plain, retryable words', () => {
  test('Supabase refusing the token is recognised and shown as a retryable service failure, never raw', () => {
    expect(isCaptchaRefusal({ code: 'captcha_failed' })).toBe(true);
    expect(isCaptchaRefusal({ message: 'captcha protection: request disallowed (invalid-input-response)' })).toBe(true);
    expect(isCaptchaRefusal({ message: 'Invalid phone number' })).toBe(false);
    const copy = recoverableErrorCopy({ what: 'complete that', error: captchaUnavailableError('refused') });
    expect(copy.canRetry).toBe(true);
    expect(`${copy.title} ${copy.message}`).not.toMatch(/captcha/i);
  });
});

describe('LoginScreen wiring (source guard)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'LoginScreen.js'), 'utf8');
  test('the code request carries the token; the token is reset after every use', () => {
    expect(src).toMatch(/signInWithOtp\(\{ phone: formatted, options: authCaptchaOptions\(captchaToken\) \}\)/);
    expect(src.match(/captcha\.reset\(\)/g).length).toBeGreaterThanOrEqual(2);
    // fail open on the device: a check that can't complete sends no token, never blocks sign-in by itself
    expect(src).toMatch(/captchaToken = await captcha\.take\(\);\s*\} catch \{\s*captchaToken = null;/);
    expect(src).toMatch(/isCaptchaRefusal\(error\) \? captchaUnavailableError\('refused'\)/);
  });
  test('the App Review number never asks Cloudflare (it skips signInWithOtp)', () => {
    const reviewer = src.indexOf('if (isReviewerNumber(phoneInput)) {');
    const take = src.indexOf('captcha.take()');
    expect(reviewer).toBeGreaterThan(-1);
    expect(take).toBeGreaterThan(reviewer);
  });
  test('only one auth call in the app needs a token (no password or email sign-in UI)', () => {
    const appSrc = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return /qa|journeys|__/.test(e.name) ? [] : appSrc(p);
      return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
    });
    const all = appSrc(path.join(__dirname, '..')).join('\n');
    expect(all.match(/auth\.(signInWithOtp|signUp|signInWithPassword|resetPasswordForEmail|signInAnonymously)\(/g)).toEqual(['auth.signInWithOtp(']);
  });
});
