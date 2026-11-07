// Deno tests for linkSafety.ts (20270396). Run: docker run --rm -v "$PWD":/w -w /w denoland/deno:alpine-1.45.5 test \
//   supabase/functions/_shared/linkSafety.test.ts      (no network: Web Risk, the sites and DNS are fakes)
import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts';
import { checkLink, checkLinks, fetchable, isPrivateAddress, MAX_HOPS, toWebUrl } from './linkSafety.ts';

type Site = { status: number; location?: string } | 'down';

function fakeWorld({ listed = {} as Record<string, string[]>, sites = {} as Record<string, Site>, dns = {} as Record<string, string[]>,
  webRiskStatus = 200, budget = 1000 } = {}) {
  const calls = { webRisk: [] as string[], fetched: [] as string[], claimed: 0 };
  const deps = {
    webRiskKey: 'test-key',
    claimLookups: async (n: number) => { if (calls.claimed + n > budget) return false; calls.claimed += n; return true; },
    resolveDns: async (host: string) => dns[host] ?? ['93.184.216.34'],
    fetch: async (url: string, _init: any) => {
      if (url.startsWith('https://webrisk.googleapis.com/')) {
        const uri = decodeURIComponent(new URL(url).searchParams.get('uri')!);
        calls.webRisk.push(uri);
        if (webRiskStatus !== 200) return { status: webRiskStatus, headers: { get: () => null }, json: async () => ({}) };
        const types = listed[uri];
        return { status: 200, headers: { get: () => null }, json: async () => (types ? { threat: { threatTypes: types } } : {}) };
      }
      calls.fetched.push(url);
      const site = sites[url] ?? { status: 200 };
      if (site === 'down') throw new Error('connection refused');
      return { status: site.status, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? site.location ?? null : null) } };
    },
  };
  return { deps, calls };
}

Deno.test('a safe link is looked up and fetched once, clean', async () => {
  const { deps, calls } = fakeWorld();
  const r = await checkLink('example.org/events', deps);
  assertEquals(r.verdict, 'clean');
  assertEquals(calls.webRisk, ['http://example.org/events']);
  assertEquals(calls.fetched, ['http://example.org/events']);
});

Deno.test('a listed link is malicious, with its threat types, and is never fetched', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'https://bad.example/login': ['SOCIAL_ENGINEERING'] } });
  const r = await checkLink('https://bad.example/login', deps);
  assertEquals(r.verdict, 'malicious');
  assertEquals(r.threats, ['SOCIAL_ENGINEERING']);
  assertEquals(calls.fetched, []);
});

Deno.test('a shortener redirecting to a listed site is malicious (every hop is looked up)', async () => {
  const { deps, calls } = fakeWorld({
    sites: { 'https://bit.ly/abc': { status: 301, location: 'https://hop.example/r' }, 'https://hop.example/r': { status: 302, location: '/final' } },
    listed: { 'https://hop.example/final': ['MALWARE'] },
  });
  const r = await checkLink('https://bit.ly/abc', deps);
  assertEquals(r.verdict, 'malicious');
  assertEquals(calls.webRisk, ['https://bit.ly/abc', 'https://hop.example/r', 'https://hop.example/final']);
});

Deno.test('a shortener that does not redirect, or is down, hides its target: unverifiable', async () => {
  const a = fakeWorld({ sites: { 'https://tinyurl.com/x': { status: 200 } } });
  assertEquals((await checkLink('https://tinyurl.com/x', a.deps)).verdict, 'unverifiable');
  const b = fakeWorld({ sites: { 'https://t.co/x': 'down' } });
  assertEquals((await checkLink('https://t.co/x', b.deps)).verdict, 'unverifiable');
});

Deno.test('an ordinary site that is down: its own address was checked, clean', async () => {
  const { deps } = fakeWorld({ sites: { 'http://quiet.example/': 'down' } });
  assertEquals((await checkLink('quiet.example', deps)).verdict, 'clean');
});

Deno.test('too many redirects: unverifiable', async () => {
  const sites: Record<string, Site> = {};
  for (let i = 0; i <= MAX_HOPS + 1; i += 1) sites[`https://loop.example/${i}`] = { status: 302, location: `https://loop.example/${i + 1}` };
  const { deps } = fakeWorld({ sites });
  assertEquals((await checkLink('https://loop.example/0', deps)).verdict, 'unverifiable');
});

Deno.test('a redirect loop ends once every hop was seen (no endless lookups)', async () => {
  const { deps, calls } = fakeWorld({ sites: { 'https://a.example/': { status: 302, location: 'https://b.example/' }, 'https://b.example/': { status: 302, location: 'https://a.example/' } } });
  assertEquals((await checkLink('https://a.example/', deps)).verdict, 'unverifiable');
  assertEquals(calls.webRisk.length, 2);
});

Deno.test('private, local and non-web addresses are never fetched: unverifiable', async () => {
  for (const c of ['http://127.0.0.1/admin', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://localhost:8080', 'http://intranet', 'http://example.org:8443/x', 'printer.local']) {
    const { deps, calls } = fakeWorld();
    assertEquals((await checkLink(c, deps)).verdict, 'unverifiable', c);
    assertEquals(calls.fetched, [], c);
  }
});

Deno.test('a public name that resolves to a private address (DNS) is not fetched', async () => {
  const { deps, calls } = fakeWorld({ dns: { 'sneaky.example': ['10.1.2.3'] } });
  assertEquals((await checkLink('https://sneaky.example/', deps)).verdict, 'unverifiable');
  assertEquals(calls.fetched, []);
});

Deno.test('a redirect to a private address or another scheme: unverifiable', async () => {
  const a = fakeWorld({ sites: { 'https://ok.example/': { status: 302, location: 'http://169.254.169.254/' } } });
  assertEquals((await checkLink('https://ok.example/', a.deps)).verdict, 'unverifiable');
  assertEquals(a.calls.fetched, ['https://ok.example/']);
  const b = fakeWorld({ sites: { 'https://ok.example/': { status: 302, location: 'javascript:alert(1)' } } });
  assertEquals((await checkLink('https://ok.example/', b.deps)).verdict, 'unverifiable');
});

Deno.test('user:password@ is dropped before fetching; the real host is what is looked up', async () => {
  const { deps, calls } = fakeWorld({ listed: { 'http://good.example@bad.example/': ['SOCIAL_ENGINEERING'] } });
  const r = await checkLink('http://good.example@bad.example/', deps);
  assertEquals(r.verdict, 'malicious');
  const c = fakeWorld();
  await checkLink('http://good.example@clean.example/', c.deps);
  assertEquals(c.calls.fetched, ['http://clean.example/']);
});

Deno.test('Web Risk down, no key, or the budget used up: unavailable (fail closed)', async () => {
  assertEquals((await checkLink('example.org', fakeWorld({ webRiskStatus: 503 }).deps)).verdict, 'unavailable');
  const noKey = fakeWorld(); (noKey.deps as any).webRiskKey = undefined;
  assertEquals((await checkLink('example.org', noKey.deps)).verdict, 'unavailable');
  assertEquals((await checkLink('example.org', fakeWorld({ budget: 0 }).deps)).verdict, 'unavailable');
});

Deno.test('several links: worst wins; more than 5 links refused before any lookup', async () => {
  const w = fakeWorld({ listed: { 'http://b.example/': ['MALWARE'] } });
  assertEquals((await checkLinks(['a.example', 'b.example'], w.deps)).verdict, 'malicious');
  const many = fakeWorld();
  const r: any = await checkLinks(['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'], many.deps);
  assertEquals(r.verdict, 'unverifiable');
  assertEquals(r.tooMany, true);
  assertEquals(many.calls.webRisk, []);
  const mixed = fakeWorld({ webRiskStatus: 500 });
  assertEquals((await checkLinks(['a.example', 'printer.local'], mixed.deps)).verdict, 'unavailable');
  assertEquals((await checkLinks([], fakeWorld().deps)).verdict, 'clean');
});

Deno.test('look-alike (Cyrillic) names are checked under their real punycode name', async () => {
  const url = toWebUrl('раураl.com')!;
  assertEquals(url.hostname.startsWith('xn--'), true);
});

Deno.test('address helpers', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', '0.0.0.0', '169.254.1.1', '100.64.0.1',
    '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assertEquals(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) assertEquals(isPrivateAddress(ip), false, ip);
  assertEquals(fetchable(new URL('https://example.org/')), true);
  assertEquals(toWebUrl('ftp://example.org'), null);
  assertEquals(toWebUrl('not a url at all'), null);
});
