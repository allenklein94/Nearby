// Business phone + website (owner, 2026-11-15; migration 20270423). The SERVER decides (private.normalize_business_phone /
// normalize_business_website); this mirrors those rules so the form can name a problem before saving and show what will be
// stored. Private: only the business's managers (and admins) ever see these; never customers, offers or discovery.

const PHONE_SHAPE = /^\+?[0-9]{7,15}$/;
const WEBSITE_SHAPE = /^https?:\/\/[a-z0-9.-]+\.[a-z0-9-]+([/?#]\S*)?$/;

// Spaces, dashes, dots and brackets removed; an optional leading +; 7-15 digits. No country is guessed. null = not a phone.
export function normalizeBusinessPhone(input) {
  const v = String(input ?? '').trim().replace(/[\s().-]/g, '');
  return PHONE_SHAPE.test(v) ? v : null;
}

// https:// added when no scheme was typed; http/https only; host with a dot; no spaces or user:password@; scheme + host
// lowercased; <= 200 characters. null = not a usable web address.
export function normalizeBusinessWebsite(input) {
  let v = String(input ?? '').trim();
  if (v === '' || /\s/.test(v)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  const m = v.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (!['http', 'https'].includes(scheme) || host.includes('@')) return null;
  v = `${scheme}://${host}${m[3]}`;
  if (v.length > 200 || !WEBSITE_SHAPE.test(v) || /(^[.-]|[.-]$|\.\.)/.test(host)) return null;
  return v;
}

// What the form says before Save: the first problem ('phone' | 'website') or null. Empty = cleared, never a problem.
export function contactDetailsProblem({ phone, website }) {
  if (String(phone ?? '').trim() !== '' && normalizeBusinessPhone(phone) === null) return 'phone';
  if (String(website ?? '').trim() !== '' && normalizeBusinessWebsite(website) === null) return 'website';
  return null;
}

// The server's refusal hint -> the same problem key (the form shows one wording for both).
export function contactDetailsRefusal(error) {
  const hint = error?.hint ?? '';
  if (hint === 'invalid_phone') return 'phone';
  if (hint === 'invalid_website') return 'website';
  return null;
}
