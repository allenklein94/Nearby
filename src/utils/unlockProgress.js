import { countLabel } from './plural';

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
  const noun = offer.unlock_scope === 'community'
    ? ['community member', 'community members']
    : ['attendee', 'attendees'];
  const need = countLabel(min, noun[0], noun[1]);
  let label;
  if (!isLocked) label = '🔓 Unlocked';
  else if (known) label = `🔒 Unlocks at ${need} (${progress}/${min} so far)`;
  else label = `🔒 Unlocks at ${need}`;
  return { known, isLocked, label };
}
