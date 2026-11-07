// Link destination check for public text (migration 20270396). Pure: the network, DNS, the Web Risk key and the lookup
// budget are passed in, so the same code runs in screen-user-content and in Jest (src/utils/linkSafetyEdge.test.js).
//
// checkLinks(links, deps) -> { verdict, threats, lookups }
//   'clean'        every link and every hop of its redirect chain was looked up in Google Web Risk and none is listed
//   'malicious'    one of them is listed (MALWARE, SOCIAL_ENGINEERING or UNWANTED_SOFTWARE); threats = those types
//   'unverifiable' the destination can't be established: not a web address, a private / local / non-web-port address, a
//                  chain longer than MAX_HOPS, a redirect to such an address, or a known link shortener that won't resolve
//   'unavailable'  Web Risk didn't answer, or the lookup budget is used up (fail closed: the caller records nothing)
// The links come from the database's own detector (public.ugc_links_for_check), never parsed here.
// Never logs or returns a URL.

export const MAX_LINKS = 5;
export const MAX_HOPS = 5;
export const HOP_TIMEOUT_MS = 4000;
export const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];

// Shorteners: a destination we can't follow from one of these is unknown, never assumed safe.
export const SHORTENERS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 's.id', 'lnkd.in', 'trib.al', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly', 'v.gd', 'clck.ru', 'qr.ae',
  'u.to', 't.ly', 'tiny.one', 'urlz.fr', 'x.co', 'linktr.ee', 'shor.by', 'snip.ly', 'surl.li', 'kutt.it', 'ln.run', 'qrco.de',
];

export function isShortener(host: string) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return SHORTENERS.some((s) => h === s || h.endsWith(`.${s}`));
}

// An address we never fetch: loopback, private, link-local, carrier-grade NAT, multicast, unspecified (v4 and v6).
export function isPrivateAddress(ip: string) {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (v.includes(':')) {
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return false;
}

const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

// A candidate from the detector -> a URL we may look at, or null (unverifiable).
export function toWebUrl(candidate: string): URL | null {
  let c = String(candidate || '').trim().replace(/^[^\p{L}\p{N}]+/u, '');
  if (!c) return null;
  if (!/^https?:\/\//i.test(c)) c = `http://${c}`;
  let url: URL;
  try { url = new URL(c); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

// May we fetch this URL to see where it goes? Only ordinary public web addresses on the default ports.
export function fetchable(url: URL) {
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || host.endsWith('.home.arpa') || !host.includes('.')) return false;
  if (IP_LITERAL.test(host) && isPrivateAddress(host)) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  if (url.username || url.password) return true; // fetched without them (fetch drops userinfo); the host is what counts
  return true;
}

export type LinkDeps = {
  fetch: (url: string, init: any) => Promise<{ status: number; headers: { get(name: string): string | null }; body?: any }>;
  resolveDns?: (host: string) => Promise<string[]>;   // all A/AAAA records; missing = not checked (documented limit)
  webRiskKey: string | undefined;
  claimLookups: (n: number) => Promise<boolean>;      // the database budget (claim_link_checks)
  now?: () => number;
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]);
  } finally { clearTimeout(t); }
}

// One Web Risk Lookup call: 'clean' | { threats } | 'unavailable'.
export async function webRiskLookup(url: string, deps: LinkDeps): Promise<'clean' | 'unavailable' | { threats: string[] }> {
  if (!deps.webRiskKey) return 'unavailable';
  if (!(await deps.claimLookups(1))) return 'unavailable';
  const q = THREAT_TYPES.map((t) => `threatTypes=${t}`).join('&');
  const endpoint = `https://webrisk.googleapis.com/v1/uris:search?${q}&uri=${encodeURIComponent(url)}&key=${encodeURIComponent(deps.webRiskKey)}`;
  try {
    const res: any = await withTimeout(deps.fetch(endpoint, { method: 'GET', redirect: 'error' }), HOP_TIMEOUT_MS);
    if (res.status !== 200) return 'unavailable';
    const body = typeof res.json === 'function' ? await res.json() : null;
    const types = body?.threat?.threatTypes;
    if (Array.isArray(types) && types.length) return { threats: types.filter((t: string) => THREAT_TYPES.includes(t)) };
    if (body && typeof body === 'object') return 'clean';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// The next hop: a redirect target, null when the chain ends here, or 'unverifiable' / 'error'.
async function nextHop(url: URL, deps: LinkDeps): Promise<URL | null | 'unverifiable' | 'error'> {
  if (!fetchable(url)) return 'unverifiable';
  if (deps.resolveDns && !IP_LITERAL.test(url.hostname)) {
    let addrs: string[] = [];
    try { addrs = await withTimeout(deps.resolveDns(url.hostname), HOP_TIMEOUT_MS); } catch { return 'error'; }
    if (addrs.some(isPrivateAddress)) return 'unverifiable';
  }
  let res: any;
  try {
    res = await withTimeout(deps.fetch(url.href, {
      method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NearbyLinkCheck/1.0)' },
    }), HOP_TIMEOUT_MS);
  } catch {
    return 'error';
  }
  try { res.body?.cancel?.(); } catch { /* nothing to read */ }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) return null;
    try {
      const next = new URL(location, url);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return 'unverifiable';
      return next;
    } catch { return 'unverifiable'; }
  }
  return null;
}

// One link's whole chain.
export async function checkLink(candidate: string, deps: LinkDeps) {
  let url = toWebUrl(candidate);
  if (!url) return { verdict: 'unverifiable' as const, threats: [] as string[], lookups: 0 };
  const seen = new Set<string>();
  let lookups = 0;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const key = url.href;
    if (!seen.has(key)) {
      seen.add(key);
      const verdict = await webRiskLookup(key, deps);
      lookups += 1;
      if (verdict === 'unavailable') return { verdict: 'unavailable' as const, threats: [], lookups };
      if (verdict !== 'clean') return { verdict: 'malicious' as const, threats: verdict.threats, lookups };
    }
    const next = await nextHop(url, deps);
    if (next === 'unverifiable') return { verdict: 'unverifiable' as const, threats: [], lookups };
    if (next === 'error') {
      // the site didn't answer: its own address is checked; a shortener's destination is unknown
      return isShortener(url.hostname) ? { verdict: 'unverifiable' as const, threats: [], lookups } : { verdict: 'clean' as const, threats: [], lookups };
    }
    if (next === null) {
      // the chain ends; a shortener that doesn't redirect (an interstitial page, a "link disabled" page) hides its target
      return isShortener(url.hostname) ? { verdict: 'unverifiable' as const, threats: [], lookups } : { verdict: 'clean' as const, threats: [], lookups };
    }
    url = next;
  }
  return { verdict: 'unverifiable' as const, threats: [], lookups }; // more than MAX_HOPS redirects
}

// Every link of one text. Worst wins: malicious > unavailable > unverifiable > clean.
export async function checkLinks(links: string[], deps: LinkDeps) {
  if (!links.length) return { verdict: 'clean' as const, threats: [] as string[], lookups: 0 };
  if (links.length > MAX_LINKS) return { verdict: 'unverifiable' as const, threats: [], lookups: 0, tooMany: true };
  let lookups = 0;
  let worst: 'clean' | 'unverifiable' | 'unavailable' = 'clean';
  for (const link of links) {
    const r = await checkLink(link, deps);
    lookups += r.lookups;
    if (r.verdict === 'malicious') return { verdict: 'malicious' as const, threats: [...new Set(r.threats)], lookups };
    if (r.verdict === 'unavailable') worst = 'unavailable';
    else if (r.verdict === 'unverifiable' && worst === 'clean') worst = 'unverifiable';
  }
  return { verdict: worst, threats: [] as string[], lookups };
}
