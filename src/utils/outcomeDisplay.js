// Global rule 7 (the UI never lies about its data): an unknown rate is not 0%. The category-outcome RPC returns NULL
// when a rate has no denominator (no accepted offers -> no completion rate; no ratings -> no satisfaction), and the card
// used to print those as "0%". Each part now shows only when it is a real number.
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function categoryOutcomeLine(c) {
  const total = Number(c?.total_opportunities);
  const parts = [];
  if (isNum(total)) parts.push(`${total} opportunit${total === 1 ? 'y' : 'ies'}`);
  if (isNum(c?.acceptance_rate)) parts.push(`${c.acceptance_rate}% accepted`);
  if (isNum(c?.completion_rate)) parts.push(`${c.completion_rate}% completed`);
  return parts.join(' · ');
}

export function categoryRatingLine(c) {
  const parts = [];
  if (isNum(c?.pct_satisfied)) parts.push(`${c.pct_satisfied}% satisfied`);
  if (isNum(c?.pct_would_repeat)) parts.push(`${c.pct_would_repeat}% would repeat`);
  return parts.length ? `⭐ ${parts.join(' · ')}` : null;
}

// "1 member" / "12 members"; null when the count is not known yet (never "0 members" for a count that has not loaded).
export function memberCountLabel(n) {
  if (!isNum(n)) return null;
  return `${n} member${n === 1 ? '' : 's'}`;
}

// A price from an offer row: null / undefined / non-numeric = no price, never "$NaN" or an invented "$0.00".
export function offerPriceLabel(price, perPerson = false) {
  if (price === null || price === undefined || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}${perPerson ? '/person' : ''}`;
}

// One way to print a dollar amount that is a plain number in a template: whole dollars without cents ("$45"), anything
// else with exactly two decimals ("$12.50") -- never a raw float ("$12.5", "$0.30000000000000004") or "$NaN". An unknown
// or non-numeric value is "—", never an invented $0.
export function moneyNumber(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
export const moneyLabel = (n) => {
  const s = moneyNumber(n);
  return s === '—' ? s : `$${s}`;
};
