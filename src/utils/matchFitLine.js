// "How well your matches land" -- owner-only line from get_partner_match_fit. The server returns a row only once
// >= 5 distinct people have answered, so a null/absent row means render nothing (never "0%").
import { tr } from '../i18n/translate';

export function matchFitLine(row) {
  if (!row || row.pct_yes == null) return null;
  const parts = [tr('ui.bizHelp.fit.yes', { pct: Math.round(Number(row.pct_yes)) })];
  if (Number(row.pct_somewhat) > 0) parts.push(tr('ui.bizHelp.fit.somewhat', { pct: Math.round(Number(row.pct_somewhat)) }));
  if (Number(row.pct_no) > 0) parts.push(tr('ui.bizHelp.fit.no', { pct: Math.round(Number(row.pct_no)) }));
  return tr('ui.bizHelp.fit.line', { parts: parts.join(' · ') });
}
