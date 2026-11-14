// Match Radar (owner, 2026-11-14, option 1 "Trim Radar"): Opportunities' "Demand near you" is THE place for demand in the
// categories a business offers; Match Radar (Home > More tools) shows only what Opportunities doesn't:
//   - open requests within reach in categories the business does NOT offer (what else it could offer), and
//   - on Growth/Brand ('advanced_match_radar'), recent searches nearby that found nothing, in ANY category, including the
//     business's own (Opportunities never shows unmet searches, so those rows stay).
// Rows come from get_aggregated_demand_for_partner unchanged: no new calculation, the server's floor of 5 (rows below it
// never arrive; unmet counts are 0 unless the plan has the entitlement). "Outside" only when the server says
// is_offered === false: a missing flag never labels the business's own category as outside (it is hidden instead).
// The server's offered set = subcategory + secondary categories (business_offered_tags); a business that declared only a
// group (e.g. Coastal Coffee: food_drink, no "More specifically") has an EMPTY set, so every row arrives is_offered=false,
// its own coffee requests included, though routing (business_served_tags) still sends them. Then "not one of your
// categories" would be false: with no declared specific category, is_offered is unknown and never claimed (owner audit
// 2026-11-14). Mirrors business_offered_tags exactly.
export function hasDeclaredOfferedCategory(partner) {
  if (!partner) return false;
  if (partner.subcategory) return true;
  return Array.isArray(partner.categories) && partner.categories.some(Boolean);
}

const offeredUnknown = (opts) => opts && opts.offeredKnown === false;

export function matchRadarRows(categories, opts) {
  const list = Array.isArray(categories) ? categories : [];
  const rows = [];
  for (const d of list) {
    if (!d || d.category == null) continue;
    const requests = Number(d.request_count);
    const unmet = Number(d.unmet_intent_count);
    const showRequests = !offeredUnknown(opts) && d.is_offered === false && Number.isFinite(requests) && requests > 0;
    const unmetCount = Number.isFinite(unmet) && unmet > 0 ? unmet : 0;
    if (!showRequests && unmetCount === 0) continue;
    rows.push({ ...d, showRequests, unmetCount });
  }
  return rows;
}

// get_aggregated_demand_for_partner's is_demand_gap means "never SERVED here" (no availability posted, no offer accepted), not
// "not offered": a new business that declared Coffee but has no Coffee bookings yet is a gap too. Wording that says "something
// you don't currently offer" is only true when the server ALSO says is_offered === false (a missing flag = not claimed).
// Owner audit, 2026-11-14: Home's suggestion and Radar's 🆕 line both read this one rule.
export function isUnofferedGap(d, opts) {
  return !!d && !offeredUnknown(opts) && d.is_demand_gap === true && d.is_offered === false;
}

// Home's one suggestion: the strongest unoffered gap (real open requests + recent unmet searches, never blended in the text).
export function bestUnofferedGap(categories, opts) {
  const list = (Array.isArray(categories) ? categories : []).filter(
    (d) => isUnofferedGap(d, opts) && (Number(d.request_count) > 0 || Number(d.unmet_intent_count) > 0)
  );
  const total = (d) => (Number(d.request_count) || 0) + (Number(d.unmet_intent_count) || 0);
  return list.sort((a, b) => total(b) - total(a))[0] ?? null;
}
