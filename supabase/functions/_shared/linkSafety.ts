// Link destination check for public text (migration 20270396). Pure: the Web Risk call, the key and the lookup budget
// are passed in, so the same code runs in screen-user-content and in the Deno tests.
//
// NO SERVER-SIDE FETCHING (owner, Option B, 2026-11-07): Nearby never opens, resolves or follows a user-submitted link.
// The ONLY network request this file makes is Google Web Risk's lookup endpoint (asserted before every call), so there is
// no SSRF or DNS-rebinding path. Each link is looked up as written, plus the destinations recognisably embedded in it
// (`?url=https://...`, `/redirect/https%3A%2F%2F...`, a fragment), with strict caps.
//
// checkLinks(links, deps) -> { verdict, threats, lookups }
//   'clean'        every link and every embedded destination was looked up in Google Web Risk and none is listed
//   'malicious'    one of them is listed (MALWARE, SOCIAL_ENGINEERING or UNWANTED_SOFTWARE); threats = those types
//   'unverifiable' the destination can't be checked without visiting it: a known link shortener / link-in-bio page
//                  (also when embedded), not a web address, a private / local / non-web-port address, an embedded
//                  destination that won't parse, or more embedded destinations than the caps allow
//   'unavailable'  Web Risk didn't answer, or the lookup budget is used up (fail closed: the caller records nothing)
// The links come from the database's own detector (public.ugc_links_for_check), never found here.
// Never logs or returns a URL.

export const MAX_LINKS = 5;                 // links per text (more = refused before any lookup)
export const MAX_EMBEDDED_PER_LINK = 3;     // embedded destinations per link (more = refused)
export const MAX_EMBED_DEPTH = 2;           // a destination inside a destination inside the link, no deeper
export const MAX_LOOKUPS_PER_TEXT = 15;     // all lookups for one text; planned before any call, over = refused
export const LOOKUP_TIMEOUT_MS = 4000;
export const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
export const WEB_RISK_ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search';

// Shorteners + link-in-bio pages: their destination can't be known without visiting them, so they're refused.
// SUPPLEMENTAL, NOT COMPREHENSIVE: any domain can redirect; an unlisted shortener is looked up only as its own address.
export const SHORTENERS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 's.id', 'lnkd.in', 'trib.al', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly', 'v.gd', 'clck.ru', 'qr.ae',
  'u.to', 't.ly', 'tiny.one', 'urlz.fr', 'x.co', 'linktr.ee', 'shor.by', 'snip.ly', 'surl.li', 'kutt.it', 'ln.run', 'qrco.de',
  'tr.ee', 'goo.su', 'cli.re', 'href.li', 'beacons.ai', 'bio.link', 'lnk.bio', 'linkin.bio', 'taplink.cc', 'solo.to',
  'tap.bio', 'flow.page', 'many.link', 'linkr.bio', 'hoo.be', 'msha.ke',
];

export function isShortener(host: string) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return SHORTENERS.some((sh) => h === sh || h.endsWith(`.${sh}`));
}

// An address we never fetch: loopback, private, link-local, carrier-grade NAT, multicast, unspecified, documentation /
// benchmark ranges (v4), and every IPv6 form that carries an IPv4 address (mapped ::ffff:, compatible ::/96, NAT64
// 64:ff9b::/96, 6to4 2002::/16), judged by the IPv4 inside. The URL parser writes [::ffff:127.0.0.1] as [::ffff:7f00:1],
// so IPv6 is parsed into its 8 groups, never matched as text.
function privateV4(a: number, b: number, c: number) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function ipv6Groups(v: string): number[] | null {
  let s = v;
  const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const q = dotted.slice(2).map(Number);
    if (q.some((n) => n > 255)) return null;
    s = `${dotted[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

export function isPrivateAddress(ip: string) {
  const v = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return privateV4(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!v.includes(':')) return false;
  const g = ipv6Groups(v);
  if (!g) return true; // can't read it: never fetch it
  const embedded = (hi: number, lo: number) => privateV4(hi >> 8, hi & 255, lo >> 8);
  if (g.every((x) => x === 0)) return true;                                   // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;         // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return embedded(g[6], g[7]) || g[5] === 0; // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                           // 6to4
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                        // documentation
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00; // unique local, link-local, multicast
}

const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

// A candidate from the detector -> a URL, or null (unverifiable).
export function toWebUrl(candidate: string): URL | null {
  let c = String(candidate || '').trim().replace(/^[^\p{L}\p{N}]+/u, '');
  if (!c) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(c) && !/^https?:\/\//i.test(c)) return null; // ftp://, data://, ...
  if (!/^https?:\/\//i.test(c)) c = `http://${c}`;
  let url: URL;
  try { url = new URL(c); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = ''; // the host is what counts (good.example@bad.example = bad.example)
  return url;
}

// An ordinary public web address on a default port. Not a network safeguard (nothing is fetched): a link people can't
// reach from the internet can't be judged by Web Risk, so it isn't published.
export function publicWebAddress(url: URL) {
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || host.endsWith('.home.arpa') || !host.includes('.')) return false;
  if (IP_LITERAL.test(host) && isPrivateAddress(host)) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  return true;
}

function decodeRepeatedly(s: string) {
  let out = s;
  for (let i = 0; i < 3; i += 1) {
    let next: string;
    try { next = decodeURIComponent(out.replace(/\+/g, ' ')); } catch { break; }
    if (next === out) break;
    out = next;
  }
  return out;
}

// '&' ends a destination, so ?a=https://x.example&b=https://y.example yields both (an embedded URL's own later query
// parameters are dropped from its lookup; a destination among them is still found and looked up on its own).
const EMBEDDED = /(?:https?:\/\/|www\.)[^\s"'<>()\[\]{}|\\^`&]+/gi;

// Destinations written inside a link (path, query values, fragment), after percent-decoding. 'tooMany' over the cap.
export function embeddedDestinations(url: URL): string[] | 'tooMany' {
  const tail = decodeRepeatedly(`${url.pathname}${url.search}${url.hash}`);
  const found: string[] = [];
  for (const m of tail.matchAll(EMBEDDED)) {
    const d = m[0].replace(/[.,!?;]+$/, '');
    if (!found.includes(d)) found.push(d);
    if (found.length > MAX_EMBEDDED_PER_LINK) return 'tooMany';
  }
  return found;
}

type Plan = { urls: string[] } | { refuse: 'unverifiable' };

// Every address to look up for one link, planned before any call: the link, then its embedded destinations.
export function planLink(candidate: string, depth = 0): Plan {
  const url = toWebUrl(candidate);
  if (!url || !publicWebAddress(url) || isShortener(url.hostname)) return { refuse: 'unverifiable' };
  const urls = [url.href];
  const inner = embeddedDestinations(url);
  if (inner === 'tooMany') return { refuse: 'unverifiable' };
  if (inner.length && depth >= MAX_EMBED_DEPTH) return { refuse: 'unverifiable' };
  for (const d of inner) {
    const sub = planLink(d, depth + 1);
    if ('refuse' in sub) return sub;
    for (const u of sub.urls) if (!urls.includes(u)) urls.push(u);
  }
  return { urls };
}

export type LinkDeps = {
  fetch: (url: string, init: any) => Promise<{ status: number; json?: () => Promise<any> }>; // used for Web Risk ONLY
  webRiskKey: string | undefined;
  claimLookups: (n: number) => Promise<boolean>;      // the database budget (claim_link_checks)
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]);
  } finally { clearTimeout(t); }
}

// One Web Risk Lookup call: 'clean' | { threats } | 'unavailable'. The only request this file ever sends.
export async function webRiskLookup(url: string, deps: LinkDeps): Promise<'clean' | 'unavailable' | { threats: string[] }> {
  if (!deps.webRiskKey) return 'unavailable';
  if (!(await deps.claimLookups(1))) return 'unavailable';
  const q = THREAT_TYPES.map((t) => `threatTypes=${t}`).join('&');
  const endpoint = `${WEB_RISK_ENDPOINT}?${q}&uri=${encodeURIComponent(url)}&key=${encodeURIComponent(deps.webRiskKey)}`;
  if (new URL(endpoint).origin !== new URL(WEB_RISK_ENDPOINT).origin) return 'unavailable';
  try {
    const res: any = await withTimeout(deps.fetch(endpoint, { method: 'GET', redirect: 'error' }), LOOKUP_TIMEOUT_MS);
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

// Every link of one text. Planned in full first (no lookup if any link is refused or the caps are exceeded), then looked
// up in order; a listed address ends it. Worst wins: malicious > unavailable > unverifiable > clean.
export async function checkLinks(links: string[], deps: LinkDeps) {
  if (!links.length) return { verdict: 'clean' as const, threats: [] as string[], lookups: 0 };
  if (links.length > MAX_LINKS) return { verdict: 'unverifiable' as const, threats: [], lookups: 0, tooMany: true };
  const all: string[] = [];
  for (const link of links) {
    const plan = planLink(link);
    if ('refuse' in plan) return { verdict: 'unverifiable' as const, threats: [], lookups: 0 };
    for (const u of plan.urls) if (!all.includes(u)) all.push(u);
  }
  if (all.length > MAX_LOOKUPS_PER_TEXT) return { verdict: 'unverifiable' as const, threats: [], lookups: 0, tooMany: true };
  let lookups = 0;
  for (const u of all) {
    const verdict = await webRiskLookup(u, deps);
    lookups += 1;
    if (verdict === 'unavailable') return { verdict: 'unavailable' as const, threats: [], lookups };
    if (verdict !== 'clean') return { verdict: 'malicious' as const, threats: [...new Set(verdict.threats)], lookups };
  }
  return { verdict: 'clean' as const, threats: [] as string[], lookups };
}

// One link on its own (tests, callers with a single link).
export function checkLink(candidate: string, deps: LinkDeps) {
  return checkLinks([candidate], deps);
}
