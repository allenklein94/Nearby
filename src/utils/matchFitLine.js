// "How well your matches land" -- owner-only line from get_partner_match_fit. The server returns a row only once
// >= 5 distinct people have answered, so a null/absent row means render nothing (never "0%").
export function matchFitLine(row) {
  if (!row || row.pct_yes == null) return null;
  const parts = [`${Math.round(Number(row.pct_yes))}% yes`];
  if (Number(row.pct_somewhat) > 0) parts.push(`${Math.round(Number(row.pct_somewhat))}% somewhat`);
  if (Number(row.pct_no) > 0) parts.push(`${Math.round(Number(row.pct_no))}% no`);
  return `How well your matches land: ${parts.join(' · ')}`;
}
