// A gathering invitation is only actionable while the gathering is still ahead.
// Past gathering: viewable, never acceptable, and it is "expired" (the person
// missed the window), not "declined". Mirrors respond_to_social_invite
// (migration 20270125), which enforces the same rule server-side.
// Derived-state logic lives in utils/objectState.js (one home for Past/Expired); re-exported so imports keep working.
import { translate } from '../i18n/translate';
import { displayDay } from '../i18n/display';
export { isSocialInviteExpired as isInviteExpired, isGatheringRequestExpired, isOccasionInviteExpired } from './objectState';

// `language` (optional): English keeps its exact wording ("August 30 • Past"); other languages read ui.activity (localization pass 5).
const pastDate = (value, language) => (language && language !== 'en'
  ? displayDay(value, language) ?? ''
  : new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }));

export function expiredInviteLabel(invite, language = 'en') {
  return {
    title: translate(language, 'ui.activity.expiredTitle'),
    detail: translate(language, 'ui.activity.pastDetail', { date: pastDate(invite.scheduledAt, language) }),
  };
}

export function expiredDateLabel(dateLike, language = 'en') {
  const raw = typeof dateLike === 'string' && dateLike.length === 10 ? `${dateLike}T00:00:00` : dateLike;
  return translate(language, 'ui.activity.pastDetail', { date: pastDate(raw, language) });
}
