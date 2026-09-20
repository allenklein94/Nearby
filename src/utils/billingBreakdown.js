// Itemizes the dashboard's "Estimated this month" from the contract terms the
// server returns (get_partner_billing_estimate, migration 20270124), so a fixed
// monthly fee is never shown as if it were redemption-driven. Pure; the amounts
// are the server's own (never recomputed here).
// An amount the server did not return is "—", never an invented $0.00.
const money = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : `$${Number(n).toFixed(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// owed: { billingModel, redemptionCount, includedUnits, billableCount, monthlyFee,
//         redemptionFee, baseFeeAmount, redemptionAmount, capped }
// -> { lines: string[] } (line 1 is the redemption fact; the rest explain the amount)
export function billingBreakdownLines(owed) {
  const count = Number(owed?.redemptionCount ?? 0);
  const billable = Number(owed?.billableCount ?? 0);
  const included = Number(owed?.includedUnits ?? 0);
  const lines = [`${plural(count, 'redemption')} this month${included > 0 ? ` (${Math.min(count, included)} of ${included} included free)` : ''}`];
  const model = owed?.billingModel;
  const perFee = owed?.redemptionFee;
  if (model === 'flat_monthly') {
    lines.push(`Flat monthly rate ${money(owed.baseFeeAmount)}, not based on redemptions`);
  } else if (model === 'hybrid') {
    lines.push(`Monthly fee ${money(owed.baseFeeAmount)} + ${plural(billable, 'billable redemption')} x ${money(perFee)} = ${money(owed.redemptionAmount)}`);
  } else if (model === 'per_redemption') {
    lines.push(`${plural(billable, 'billable redemption')} x ${money(perFee)}`);
  }
  if (owed?.capped) lines.push('Capped at your monthly maximum');
  lines.push('Final invoice may differ slightly');
  return lines;
}
