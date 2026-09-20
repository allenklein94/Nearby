import { billingBreakdownLines } from './billingBreakdown';

const base = { redemptionCount: 0, includedUnits: 0, billableCount: 0, capped: false };

test('hybrid with 0 redemptions explains the $20 as the monthly fee', () => {
  const lines = billingBreakdownLines({ ...base, billingModel: 'hybrid', monthlyFee: 20, redemptionFee: 1, baseFeeAmount: 20, redemptionAmount: 0 });
  expect(lines[0]).toBe('0 redemptions this month');
  expect(lines[1]).toBe('Monthly fee $20.00 + 0 billable redemptions x $1.00 = $0.00');
});
test('per-redemption shows count x fee', () => {
  const lines = billingBreakdownLines({ ...base, billingModel: 'per_redemption', redemptionCount: 4, billableCount: 4, redemptionFee: 5, redemptionAmount: 20 });
  expect(lines[0]).toBe('4 redemptions this month');
  expect(lines[1]).toBe('4 billable redemptions x $5.00');
});
test('flat monthly says it is not redemption-based; included units and cap are stated', () => {
  expect(billingBreakdownLines({ ...base, billingModel: 'flat_monthly', baseFeeAmount: 49 })[1]).toBe('Flat monthly rate $49.00, not based on redemptions');
  const l = billingBreakdownLines({ ...base, billingModel: 'per_redemption', redemptionCount: 3, includedUnits: 5, billableCount: 0, redemptionFee: 2, capped: true });
  expect(l[0]).toBe('3 redemptions this month (3 of 5 included free)');
  expect(l).toContain('Capped at your monthly maximum');
});
