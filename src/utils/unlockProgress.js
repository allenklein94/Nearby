import { tr } from '../i18n/translate';

// A locked perk's progress line. The count behind it can be unknown (the
// lookup failed or has not returned), and unknown is not zero: with an unknown
// count the line still states the requirement but never claims "(0/N so far)",
// and the perk stays locked (the server enforces the threshold on redemption
// either way, so a locked button here only ever declines to offer an action).
// null = the offer has no unlock rule.
export function unlockStatus(offer, progress) {
  if (!offer || offer.unlock_scope == null) return null;
  const min = Number(offer.unlock_min_members);
  const known = typeof progress === 'number' && Number.isFinite(progress);
  const isLocked = !known || !(Number.isFinite(min) ? progress >= min : false);
  // Wording lives in ui.community.unlock (English unchanged); the count noun is a plural chosen by the language.
  const scope = offer.unlock_scope === 'community' ? 'community' : 'attendees';
  let label;
  if (!isLocked) label = tr('ui.community.unlock.unlocked');
  else if (known) label = tr(`ui.community.unlock.${scope}Progress`, { count: min, progress });
  else label = tr(`ui.community.unlock.${scope}`, { count: min });
  return { known, isLocked, label };
}
