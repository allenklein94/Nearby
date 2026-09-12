// Item 61 ("Celebrate Something" life-events planning layer, CLAUDE.md) --
// pure logic for the wizard: occasion -> who's it for -> what to do -> when
// -> who's involved -> route to an existing real creation/request screen
// with full prefill. No new entity; this is orchestration only, same
// discipline as surpriseMeLogic.js's own mood-to-real-params mapping.
import { occasionLabel, CALENDAR_SAVEABLE_OCCASION_KEYS } from '../constants/businessAttributes';

const ACTIVITY_ASK_PHRASE = {
  dinner: 'dinner',
  night_out: 'night out',
  activity: 'activity',
  party: 'party',
  surprise: 'surprise party',
  weekend_trip: 'weekend trip',
};

// 'other' has no real label worth repeating twice ("Other Occasion
// Celebration" reads badly) -- collapses to the generic "Celebration" noun
// everywhere in this module instead.
function celebrationNoun(occasion) {
  return occasion === 'other' ? 'Celebration' : occasionLabel(occasion);
}

// A real chosen friend/match name (whoForName) always wins when present --
// never fabricated. Falls back to a generic, honest phrase per whoFor when
// no specific name was picked (allowed -- "someone else"/"a friend" doesn't
// require naming a real connected person, e.g. a coworker not on Nearby).
export function composeCelebrationTitle({ occasion, whoFor, whoForName }) {
  const noun = celebrationNoun(occasion);
  if (whoFor === 'me') return `My ${noun}`;
  if (whoForName) return `${whoForName}'s ${noun}`;
  return noun === 'Celebration' ? 'A Celebration' : `${noun} Celebration`;
}

const WHO_FOR_ASK_PHRASE = {
  me: 'for me',
  family: 'for a family member',
  someone_else: 'for someone special',
};

// Free-text framing used to prefill AskBusinessScreen's own text field and
// the "Custom" destination's assistant box -- a real, human-readable
// sentence built entirely from the wizard's own already-collected answers,
// never AI-generated at this step.
export function composeCelebrationAskText({ occasion, whoFor, whoForName, activityType }) {
  const parts = [];
  if (occasion && occasion !== 'other') parts.push(occasionLabel(occasion).toLowerCase());
  const activityPhrase = ACTIVITY_ASK_PHRASE[activityType];
  if (activityPhrase) parts.push(activityPhrase);
  const subject = parts.length > 0 ? `A ${parts.join(' ')}` : 'Something';
  const forClause = whoForName ? `for ${whoForName}` : WHO_FOR_ASK_PHRASE[whoFor] ?? 'for a friend';
  return `${subject} ${forClause}`;
}

// Which real existing screen this activity type routes to. 'gathering' and
// 'business' are both deterministic, no-AI mappings; 'custom' is the one
// case that hands off to the existing free-text AI classification pipeline
// (CreateHubScreen's "Something Else" box), since there's no structured
// answer to route on.
export function resolveCelebrationDestination(activityType) {
  if (activityType === 'party' || activityType === 'surprise' || activityType === 'weekend_trip') return 'gathering';
  if (activityType === 'dinner' || activityType === 'night_out' || activityType === 'activity') return 'business';
  return 'custom';
}

// A personal celebration never defaults to fully public -- 'surprise' is
// always invite_only regardless of who's involved (a public surprise isn't
// one); "Existing groups" maps to a real community (the only real "existing
// group" concept in this schema); every other who's-involved answer
// (Friends/Family/Invite specific people) maps to invite_only, relying on
// the gathering's own already-real post-create Invite Friends flow rather
// than a new in-wizard invite mechanism.
export function resolveCelebrationVisibility({ activityType, whoInvolved }) {
  if (activityType === 'surprise') return 'invite_only';
  if (whoInvolved === 'existing_group') return 'community';
  return 'invite_only';
}

// Only 'dinner' has an unambiguous real leaf-tag match (AskBusinessScreen's
// own 'Foodie' chip, which also unlocks its cuisine picker) -- every other
// activity type stays honestly uncategorized rather than guessing a category
// with no real signal behind it.
export function celebrationCategoryHint(activityType) {
  return activityType === 'dinner' ? 'Foodie' : null;
}

// Item 61's own design doc locked an optional "save to my calendar" step
// (occasions.occasion_type was widened specifically to support it) --
// only genuinely calendar-worthy occasions qualify (CALENDAR_SAVEABLE_
// OCCASION_KEYS's own header comment explains why 'birthday'/'other' are
// excluded).
export function shouldOfferCalendarSave(occasion) {
  return CALENDAR_SAVEABLE_OCCASION_KEYS.includes(occasion);
}

// 'anniversary' is the one calendar-saveable occasion that's genuinely
// annual by nature -- every other one (graduation/baby_shower/engagement/
// housewarming/promotion/farewell/milestone) is a real one-time date, so
// recursAnnually defaults per-occasion instead of asking a 6th question
// the wizard's own locked question list doesn't have room for.
export function buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId }) {
  return {
    occasionType: occasion,
    title,
    occasionDate: scheduledAt.toISOString().slice(0, 10),
    recursAnnually: occasion === 'anniversary',
    connectedUserId: connectedUserId ?? null,
  };
}

// "Connect it to businesses" (CLAUDE.md, direct follow-up to Item 61): for
// a business-destined activity type (dinner/night_out/activity), the
// wizard's own already-collected structured answers (occasion/when/party
// size) are ground truth -- richer and more precise than free text a user
// would otherwise have to retype into AskBusinessScreen's own "Find
// options nearby" search (Item 53). This maps the wizard's own deterministic
// WHEN_PRESETS key onto resolveIntent()'s real dateWindow vocabulary
// (matchesDateWindow in intentResolverScoring.js) -- 'now'/'tonight' both
// collapse to the same "later today" window that vocabulary already uses
// for both; a real picked custom date has no matching bucket, so it maps to
// null (matchesDateWindow's own "no date filter" value) rather than
// guessing a wrong one -- an honest breadth tradeoff, not a fabricated match.
const WHEN_PRESET_TO_DATE_WINDOW = { now: 'tonight', tonight: 'tonight', tomorrow: 'tomorrow', custom: null };
export function dateWindowForWhenPreset(whenPreset) {
  return WHEN_PRESET_TO_DATE_WINDOW[whenPreset] ?? null;
}
