// Itemizes the dashboard's "Estimated this month" from the contract terms the
// server returns (get_partner_billing_estimate, migration 20270124), so a fixed
// monthly fee is never shown as if it were redemption-driven. Pure; the amounts
// are the server's own (never recomputed here).
// An amount the server did not return is "—", never an invented $0.00.
import { tr } from '../i18n/translate';
import { bizMoney2 as money } from '../i18n/bizFormat';

const B = (key, vars) => tr(`ui.bizHelp.billing.${key}`, vars);

// owed: { billingModel, redemptionCount, includedUnits, billableCount, monthlyFee,
//         redemptionFee, baseFeeAmount, redemptionAmount, capped }
// -> { lines: string[] } (line 1 is the redemption fact; the rest explain the amount)
export function billingBreakdownLines(owed) {
  const count = Number(owed?.redemptionCount ?? 0);
  const billable = Number(owed?.billableCount ?? 0);
  const included = Number(owed?.includedUnits ?? 0);
  const lines = [included > 0
    ? B('redemptionsThisMonthIncluded', { count, used: Math.min(count, included), included })
    : B('redemptionsThisMonth', { count })];
  const model = owed?.billingModel;
  const perFee = owed?.redemptionFee;
  if (model === 'flat_monthly') {
    lines.push(B('flatMonthly', { amount: money(owed.baseFeeAmount) }));
  } else if (model === 'hybrid') {
    lines.push(B('hybrid', { fee: money(owed.baseFeeAmount), count: billable, per: money(perFee), total: money(owed.redemptionAmount) }));
  } else if (model === 'per_redemption') {
    lines.push(B('perRedemption', { count: billable, per: money(perFee) }));
  }
  if (owed?.capped) lines.push(B('capped'));
  lines.push(B('mayDiffer'));
  return lines;
}
