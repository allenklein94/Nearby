// Item 104 (CLAUDE.md, "There could eventually be an 'Occasions'
// recommendation engine"). User's own mock: "Upcoming in your world / 🎂
// Sarah's birthday — 10 days / 💍 Anniversary — 22 days / 🎓 John's
// graduation — 31 days / Plan Something" -- a real, forward-looking
// preview, distinct from the single "what's most urgent right now" nudge
// card Home already shows. Pure regrouping of two already-real, already-
// fetched lists (getUpcomingOccasions()/getUpcomingConnectedBirthdays()),
// same "regroup what's already real, nothing new fetched" shape
// occasionGrouping.js's own header comment already established.
//
// Deliberately does NOT duplicate the item Home's own existing single-item
// nudge card already features -- see `skip` below -- so a user never sees
// the exact same "Sarah's birthday — 10 days" rendered twice on the same
// screen. This widget is the fuller picture beyond that one urgent thing,
// not a second copy of it.
import { occasionIcon } from '../constants/businessAttributes';

// Merges real occasions + real connected birthdays into one list, sorted
// soonest-first, with the single soonest overall item skipped by default
// (that's what the existing birthdayNudge/occasionNudge card already
// shows). Returns at most `limit` items.
export function buildUpcomingWorldItems({ occasions = [], birthdays = [], skip = 1, limit = 3 } = {}) {
  const occasionItems = (occasions ?? []).map((o) => ({
    key: `occasion_${o.occasion_id}`,
    kind: 'occasion',
    icon: occasionIcon(o.occasion_type) ?? '📅',
    label: o.title,
    daysUntil: o.days_until,
    occasionId: o.occasion_id,
    occasionType: o.occasion_type,
    whoForName: o.who_for_name ?? null,
    whoForFriendId: o.who_for_friend_id ?? null,
  }));
  const birthdayItems = (birthdays ?? []).map((b) => ({
    key: `birthday_${b.connection_id}`,
    kind: 'birthday',
    icon: '🎂',
    label: `${b.display_name}'s birthday`,
    daysUntil: b.days_until,
    occasionId: null,
    occasionType: 'birthday',
    whoForName: b.display_name,
    whoForFriendId: b.connection_id,
  }));

  const merged = [...occasionItems, ...birthdayItems]
    .filter((item) => typeof item.daysUntil === 'number')
    .sort((a, b) => a.daysUntil - b.daysUntil);

  return merged.slice(skip, skip + limit);
}

// "🎂 Sarah's birthday — 10 days" -- the exact compact shape the user's own
// mock uses. Never fabricates a day count; the caller already filtered to
// real, resolved daysUntil values above.
//
// A wizard-composed occasion title (composeCelebrationTitle,
// celebrateSomething.js) already bakes the same occasion icon onto the end
// of the title itself ("Sarah's Birthday 🎂") -- prepending item.icon
// unconditionally would double it ("🎂 Sarah's Birthday 🎂"). Only
// prepends when the label doesn't already end with that exact icon.
// Split into {prefix, days} -- Item 123 ("Use 'anticipation' animations") needs the real day
// count as its own fragment so a caller can give it AnticipationText's subtle, proximity-scaled
// treatment without re-deriving the day text itself (one place computes "today"/"tomorrow"/"N
// days", not two that could drift). formatUpcomingWorldItemLine below is now a thin join of this.
export function formatUpcomingWorldItemParts(item) {
  if (!item) return { prefix: '', days: '' };
  const days = item.daysUntil === 0 ? 'today' : item.daysUntil === 1 ? 'tomorrow' : `${item.daysUntil} days`;
  const label = item.label ?? '';
  const alreadyIconSuffixed = !!item.icon && label.trim().endsWith(item.icon);
  const prefix = alreadyIconSuffixed ? label : `${item.icon} ${label}`.trim();
  return { prefix, days };
}

export function formatUpcomingWorldItemLine(item) {
  const { prefix, days } = formatUpcomingWorldItemParts(item);
  if (!prefix && !days) return '';
  return `${prefix} — ${days}`;
}
