import { invoiceRow, invoiceStatusLabel } from './invoiceDisplay';

test('a draft invoice is never called final or paid', () => {
  expect(invoiceStatusLabel('draft')).toBe('Draft, not yet sent');
  expect(invoiceStatusLabel('paid')).toBe('Paid');
  expect(invoiceStatusLabel('weird')).toBe('Pending');
});
test('row uses the invoice period, redemptions and amount', () => {
  const r = invoiceRow({ id: 'i', period_start: '2026-08-01T00:00:00Z', redemption_count: 0, amount_due: '20.00', status: 'draft' });
  expect(r.text).toBe('Aug 2026 · 0 redemptions · $20.00');
  expect(r.status).toBe('Draft, not yet sent');
});
