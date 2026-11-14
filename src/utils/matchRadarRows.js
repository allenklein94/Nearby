// Match Radar (owner, 2026-11-14, option 1 "Trim Radar"): Opportunities' "Demand near you" is THE place for demand in the
// categories a business offers; Match Radar (Home > More tools) shows only what Opportunities doesn't:
//   - open requests within reach in categories the business does NOT offer (what else it could offer), and
//   - on Growth/Brand ('advanced_match_radar'), recent searches nearby that found nothing, in ANY category, including the
//     business's own (Opportunities never shows unmet searches, so those rows stay).
// Rows come from get_aggregated_demand_for_partner unchanged: no new calculation, the server's floor of 5 (rows below it
// never arrive; unmet counts are 0 unless the plan has the entitlement). "Outside" only when the server says
// is_offered === false: a missing flag never labels the business's own category as outside (it is hidden instead).
export function matchRadarRows(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const rows = [];
  for (const d of list) {
    if (!d || d.category == null) continue;
    const requests = Number(d.request_count);
    const unmet = Number(d.unmet_intent_count);
    const showRequests = d.is_offered === false && Number.isFinite(requests) && requests > 0;
    const unmetCount = Number.isFinite(unmet) && unmet > 0 ? unmet : 0;
    if (!showRequests && unmetCount === 0) continue;
    rows.push({ ...d, showRequests, unmetCount });
  }
  return rows;
}
