// Business logos on offer surfaces (owner, 2026-10-10). Businesses can show who they are without changing the customer's
// ability to compare offers fairly: a small round logo beside the business name, and nothing else (no brand colours, no
// card templates, no changed wording or buttons). Only logos the server says passed screening ever reach this file
// (get_screened_business_logos); with no logo the surface renders exactly as before, with no placeholder.

// rows from get_screened_business_logos -> { partnerId: logoUrl }. Anything malformed is dropped, never guessed.
export function logoMapFromRows(rows) {
  const map = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.partner_id === 'string' && typeof r.logo_url === 'string' && /^https?:\/\//i.test(r.logo_url.trim())) {
      map[r.partner_id] = r.logo_url.trim();
    }
  }
  return map;
}

// The logo to draw for one business, or null (= render nothing).
export function logoFor(map, partnerId) {
  if (!map || !partnerId) return null;
  return map[partnerId] ?? null;
}

// The arrival pill shows a logo only when its text names that one business: exactly one reply, and not the first-ever
// line ("A local business just responded to your request"), whose wording stays about the moment, not the brand.
export function pillLogoPartnerId(signal) {
  const items = signal?.items ?? [];
  if (items.length !== 1 || signal.firstEver) return null;
  return items[0].partnerId ?? null;
}
