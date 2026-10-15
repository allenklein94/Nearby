// Item 93 (owner, 2026-10-15; aligns Phase D with item 92): the ONE line a friend may see about your open business request,
// on the group-plan candidate rows and the typed-ask "{name} is also looking for this" result. Structured facts only: the
// category, the day and the party size, never the words you typed (`raw_text` is no longer returned by
// get_connected_open_business_requests). A fact that is not set is left out, never guessed.
import { tr, getCurrentLanguage } from '../i18n/translate';
import { categoryName } from '../i18n/categoryNames';
import { formatDateLabel } from './businessRequestWhen';

export function sharedRequestFactsLine({ category = null, date = null, party_size = null } = {}) {
  const parts = [
    category ? categoryName(category, getCurrentLanguage()) : null,
    formatDateLabel(date),
    Number.isInteger(party_size) && party_size > 0 ? tr('ui.common.count.people', { count: party_size }) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
