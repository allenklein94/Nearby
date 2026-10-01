// Past-invoice rows for the dashboard billing card. The amounts are the
// server's (generate_monthly_invoices); only wording lives here. A 'draft'
// invoice is computed but not yet sent, so it is never called final or paid.
import { tr } from '../i18n/translate';
import { bizIsEnglish, bizLanguage, bizMoney2 } from '../i18n/bizFormat';
import { vocabValue } from '../i18n/format';

const STATUSES = ['draft', 'sent', 'paid', 'failed', 'void'];

export function invoiceStatusLabel(status) {
  return tr(`ui.bizHelp.invoice.${STATUSES.includes(status) ? status : 'pending'}`);
}

export function invoiceRow(invoice) {
  const d = new Date(invoice.period_start);
  const month = bizIsEnglish()
    ? d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : `${(vocabValue(bizLanguage(), 'date.months') ?? [])[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;
  const n = Number(invoice.redemption_count ?? 0);
  return {
    id: invoice.id,
    text: `${month} \u00b7 ${tr('ui.bizHelp.value.redemptions', { count: n })} \u00b7 ${bizMoney2(invoice.amount_due)}`,
    status: invoiceStatusLabel(invoice.status),
  };
}
