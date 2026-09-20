// Past-invoice rows for the dashboard billing card. The amounts are the
// server's (generate_monthly_invoices); only wording lives here. A 'draft'
// invoice is computed but not yet sent, so it is never called final or paid.
const STATUS_LABEL = {
  draft: 'Draft, not yet sent',
  sent: 'Sent',
  paid: 'Paid',
  failed: 'Payment failed',
  void: 'Void',
};

export function invoiceStatusLabel(status) {
  return STATUS_LABEL[status] ?? 'Pending';
}

export function invoiceRow(invoice) {
  const d = new Date(invoice.period_start);
  const month = d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const n = Number(invoice.redemption_count ?? 0);
  return {
    id: invoice.id,
    text: `${month} \u00b7 ${n} redemption${n === 1 ? '' : 's'} \u00b7 $${Number(invoice.amount_due ?? 0).toFixed(2)}`,
    status: invoiceStatusLabel(invoice.status),
  };
}
