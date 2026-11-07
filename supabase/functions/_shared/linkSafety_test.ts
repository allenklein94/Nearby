// Deno tests for linkSafety.ts (20270396, Option B: no server-side fetching). Run:
//   docker run --rm -v "$PWD":/w -w /w --entrypoint deno denoland/deno:alpine-1.45.5 test supabase/functions/_shared/linkSafety_test.ts
// No network: Web Risk is a fake. EVERY test also proves the only request sent went to Web Risk's endpoint.
import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import {
  checkLink, checkLinks, embeddedDestinations, isPrivateAddress, isShortener, MAX_EMBEDDED_PER_LINK, MAX_LOOKUPS_PER_TEXT,
  publicWebAddress, toWebUrl, WEB_RISK_ENDPOINT,
} from './linkSafety.ts';

function fakeWorld({ listed = {} as Record<string, string[]>, webRiskStatus = 200, budget = 1000, throws = false } = {}) {
  const calls = { requests: [] as string[], webRisk: [] as string[], claimed: 0 };
  const deps = {
    webRiskKey: 'test-key' as string | undefined,
    claimLookups: async (n: number) => { if (calls.claimed + n > budget) return false; calls.claimed += n; return true; },
    fetch: async (url: string, _init: any) => {
      calls.requests.push(url);
      if (throws) throw new Error('network down');
      const uri = new URL(url).searchParams.get('uri') ?? '';
      calls.webRisk.push(uri);
      if (webRiskStatus !== 200) return { status: webRiskStatus, json: async () => ({}) };
      const types = listed[uri];
      return { status: 200, json: async () => (types ? { threat: { threatTypes: types } } : {}) };
    },
  };
  return { deps, calls };
}

// No request to anything but Web Risk's own endpoint, ever.
function onlyWebRisk(calls: { requests: string[] }, label = '') {
  for (const r of calls.requests) assertEquals(r.startsWith(`${WEB_RISK_ENDPOINT}?`), true, `${label} sent ${r}`);
}

Deno.test('a safe link is looked up once and never visited', async () => {
  const { deps, calls } = fakeWorld();
  const r = await checkLink('example.org/events', deps);
  assertEquals(r.verdict, 'clean');
  assertEquals(calls.webRisk, ['http://example.org/events']);
  assertEquals(calls.requests.length, 1);
  onlyWebRisk(calls);
});

Deno.test('a listed link is malicious, with its threat types', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'https://bad.example/login': ['SOCIAL_ENGINEERING'] } });
  const r = await checkLink('https://bad.example/login', deps);
  assertEquals(r.verdict, 'malicious');
  assertEquals(r.threats, ['SOCIAL_ENGINEERING']);
  onlyWebRisk(calls);
});

Deno.test('known shorteners and link-in-bio pages are refused without any request', async () => {
  for (const c of ['https://bit.ly/abc', 'tinyurl.com/x', 'https://t.co/x', 'https://www.bit.ly/y', 'https://linktr.ee/someone',
    'https://beacons.ai/me', 'https://sub.bitly.com/z']) {
    const { deps, calls } = fakeWorld();
    assertEquals((await checkLink(c, deps)).verdict, 'unverifiable', c);
    assertEquals(calls.requests, [], c);
  }
  assertEquals(isShortener('notbit.ly'), false); // a look-alike suffix is not the shortener (it's looked up as itself)
});

Deno.test('an open redirect on a trusted site: the embedded destination is looked up too', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'https://phish.example/pay': ['SOCIAL_ENGINEERING'] } });
  const r = await checkLink('https://www.google.com/url?q=https%3A%2F%2Fphish.example%2Fpay&sa=D', deps);
  assertEquals(r.verdict, 'malicious');
  assertEquals(calls.webRisk, ['https://www.google.com/url?q=https%3A%2F%2Fphish.example%2Fpay&sa=D', 'https://phish.example/pay']);
  onlyWebRisk(calls);
});

Deno.test('embedded destinations in path, fragment, double encoding and www. forms are found', () => {
  const at = (s: string) => embeddedDestinations(toWebUrl(s)!);
  assertEquals(at('https://ok.example/redirect/https://a.example/x'), ['https://a.example/x']);
  assertEquals(at('https://ok.example/#u=https://b.example/'), ['https://b.example/']);
  assertEquals(at('https://ok.example/?u=https%253A%252F%252Fc.example%252F'), ['https://c.example/']);
  assertEquals(at('https://ok.example/?next=www.d.example/page&x=1'), ['www.d.example/page']);
  assertEquals(at('https://ok.example/plain/path?x=1'), []);
});

Deno.test('a shortener hidden inside a link is refused', async () => {
  const { deps, calls } = fakeWorld();
  assertEquals((await checkLink('https://l.facebook.com/l.php?u=https%3A%2F%2Fbit.ly%2Fabc', deps)).verdict, 'unverifiable');
  assertEquals(calls.requests, []);
});

Deno.test('nesting: one level inside another is checked; deeper is refused', async () => {
  const inner = encodeURIComponent('https://c.example/?go=' + encodeURIComponent('https://d.example/'));
  const two = fakeWorld();
  // link -> b.example -> its own embedded c.example: depth 2, all looked up (d.example is depth 3 = refused)
  assertEquals((await checkLink(`https://a.example/?u=https%3A%2F%2Fb.example%2F%3Fv%3D${inner}`, two.deps)).verdict, 'unverifiable');
  assertEquals(two.calls.requests, []);
  const ok = fakeWorld();
  assertEquals((await checkLink(`https://a.example/?u=${encodeURIComponent('https://b.example/')}`, ok.deps)).verdict, 'clean');
  assertEquals(ok.calls.webRisk, [`https://a.example/?u=${encodeURIComponent('https://b.example/')}`, 'https://b.example/']);
});

Deno.test('lookups are capped and planned before any call (no excessive lookups)', async () => {
  const many = Array.from({ length: MAX_EMBEDDED_PER_LINK + 1 }, (_, i) => `u${i}=${encodeURIComponent(`https://e${i}.example/`)}`).join('&');
  const a = fakeWorld();
  assertEquals((await checkLink(`https://a.example/?${many}`, a.deps)).verdict, 'unverifiable');
  assertEquals(a.calls.requests, []);
  // 5 links x (1 + 3 embedded) = 20 > MAX_LOOKUPS_PER_TEXT: refused before any lookup
  const three = (i: number) => [0, 1, 2].map((j) => `u${j}=${encodeURIComponent(`https://x${i}${j}.example/`)}`).join('&');
  const links = [0, 1, 2, 3, 4].map((i) => `https://l${i}.example/?${three(i)}`);
  const b = fakeWorld();
  const r: any = await checkLinks(links, b.deps);
  assertEquals(r.verdict, 'unverifiable');
  assertEquals(r.tooMany, true);
  assertEquals(b.calls.requests, []);
  assertEquals(20 > MAX_LOOKUPS_PER_TEXT, true);
  // repeats are looked up once
  const c = fakeWorld();
  await checkLinks(['https://same.example/', 'same.example/'.replace(/^/, 'https://')], c.deps);
  assertEquals(c.calls.webRisk.length, 1);
});

Deno.test('private, local and non-web addresses are refused without any request', async () => {
  for (const c of ['http://127.0.0.1/admin', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://localhost:8080', 'http://intranet',
    'http://example.org:8443/x', 'printer.local', 'ftp://example.org', 'javascript:alert(1)']) {
    const { deps, calls } = fakeWorld();
    assertEquals((await checkLink(c, deps)).verdict, 'unverifiable', c);
    assertEquals(calls.requests, [], c);
  }
});

Deno.test('user:password@ is dropped; the real host is what is looked up', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'http://bad.example/': ['SOCIAL_ENGINEERING'] } });
  assertEquals((await checkLink('http://good.example@bad.example/', deps)).verdict, 'malicious');
  assertEquals(calls.webRisk, ['http://bad.example/']);
});

Deno.test('Web Risk down, erroring, no key, or the budget used up: unavailable (fail closed)', async () => {
  assertEquals((await checkLink('example.org', fakeWorld({ webRiskStatus: 503 }).deps)).verdict, 'unavailable');
  assertEquals((await checkLink('example.org', fakeWorld({ webRiskStatus: 429 }).deps)).verdict, 'unavailable');
  assertEquals((await checkLink('example.org', fakeWorld({ throws: true }).deps)).verdict, 'unavailable');
  const noKey = fakeWorld(); noKey.deps.webRiskKey = undefined;
  assertEquals((await checkLink('example.org', noKey.deps)).verdict, 'unavailable');
  assertEquals(noKey.calls.requests, []);
  const broke = fakeWorld({ budget: 0 });
  assertEquals((await checkLink('example.org', broke.deps)).verdict, 'unavailable');
  assertEquals(broke.calls.requests, []);
  // budget runs out mid-text: unavailable, never a partial "clean"
  const half = fakeWorld({ budget: 1 });
  assertEquals((await checkLinks(['a.example', 'b.example'], half.deps)).verdict, 'unavailable');
});

Deno.test('several links: worst wins; more than 5 refused before any lookup; none = clean', async () => {
  const w = fakeWorld({ listed: { 'http://b.example/': ['MALWARE'] } });
  assertEquals((await checkLinks(['a.example', 'b.example'], w.deps)).verdict, 'malicious');
  const many = fakeWorld();
  const r: any = await checkLinks(['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'], many.deps);
  assertEquals(r.verdict, 'unverifiable');
  assertEquals(r.tooMany, true);
  assertEquals(many.calls.requests, []);
  const mixed = fakeWorld();
  assertEquals((await checkLinks(['a.example', 'printer.local'], mixed.deps)).verdict, 'unverifiable');
  assertEquals(mixed.calls.requests, []); // planned first: nothing looked up when one link can't be checked
  assertEquals((await checkLinks([], fakeWorld().deps)).verdict, 'clean');
});

Deno.test('look-alike (Cyrillic) names are looked up under their real punycode name', async () => {
  const { deps, calls } = fakeWorld();
  await checkLink('раураl.com', deps);
  assertEquals(new URL(calls.webRisk[0]).hostname.startsWith('xn--'), true);
});

Deno.test('address helpers', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.0.1', '127.0.0.1', '0.0.0.0', '169.254.1.1', '100.64.0.1', '224.0.0.1',
    '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', 'zz::zz'])
    assertEquals(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111', '::ffff:5db8:d822'])
    assertEquals(isPrivateAddress(ip), false, ip);
  assertEquals(publicWebAddress(new URL('https://example.org/')), true);
  assertEquals(toWebUrl('not a url at all'), null);
});

Deno.test('two destinations in one link are both looked up (the first never swallows the next)', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'https://second.example/': ['MALWARE'] } });
  const link = `https://ok.example/?a=${encodeURIComponent('https://first.example/')}&b=${encodeURIComponent('https://second.example/')}`;
  assertEquals((await checkLink(link, deps)).verdict, 'malicious');
  assertEquals(calls.webRisk, [link, 'https://first.example/', 'https://second.example/']);
  onlyWebRisk(calls);
});
