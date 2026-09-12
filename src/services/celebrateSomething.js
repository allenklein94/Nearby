// Item 61 ("Celebrate Something" life-events planning layer, CLAUDE.md) --
// pure logic for the wizard: occasion -> who's it for -> what to do -> when
// -> who's involved -> route to an existing real creation/request screen
// with full prefill. No new entity; this is orchestration only, same
// discipline as surpriseMeLogic.js's own mood-to-real-params mapping.
import { occasionLabel, CALENDAR_SAVEABLE_OCCASION_KEYS } from '../constants/businessAttributes';

// The wizard's own 7 real activity types (CelebrateSomethingScreen.js's
// 'activity' step) -- exported so occasion_group_plan_options' own
// activity_type column (the exact same vocabulary, per the migration's own
// CHECK constraint) can be rendered with the same icon/label everywhere a
// group plan's proposed options show up (GroupOccasionPlanScreen.js), one
// source of truth instead of two copies that could drift.
export const ACTIVITY_OPTIONS = [
  { key: 'dinner', label: 'Dinner', icon: '🍽️' },
  { key: 'party', label: 'Party', icon: '🎉' },
  { key: 'surprise', label: 'Surprise', icon: '🎁' },
  { key: 'activity', label: 'Activity', icon: '🎯' },
  { key: 'night_out', label: 'Night Out', icon: '🌃' },
  { key: 'weekend_trip', label: 'Weekend Trip', icon: '🧳' },
  { key: 'custom', label: 'Something Custom', icon: '💡' },
];

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
// genuinely calendar-worthy occasions qualify (CALENDAR_SAVEABLE_
// OCCASION_KEYS's own header comment explains why 'other' is excluded
// outright). 'birthday' is a special case, not in that flat list: it
// already has its own dedicated, better-integrated reminder
// (profiles.birthdate + the existing Home nudge) -- but ONLY for a real
// connected Nearby user. "Don't require the celebrated person to be a
// Nearby user" (CLAUDE.md) means a birthday for someone who isn't one --
// a mother, say -- has no profiles.birthdate for that nudge to ever read,
// so it needs this same generic path everyone else already gets.
// `hasConnectedNearbyUser` should be true only when a real, picked
// connected friend/match is actually attached (never inferred from a
// hand-typed name, which could just as easily be a stranger to Nearby).
export function shouldOfferCalendarSave(occasion, hasConnectedNearbyUser = false) {
  if (occasion === 'birthday') return !hasConnectedNearbyUser;
  return CALENDAR_SAVEABLE_OCCASION_KEYS.includes(occasion);
}

// 'anniversary' and 'birthday' are the two calendar-saveable occasions
// that are genuinely annual by nature -- every other one (graduation/
// baby_shower/engagement/housewarming/promotion/farewell/milestone) is a
// real one-time date, so recursAnnually defaults per-occasion instead of
// asking a 6th question the wizard's own locked question list doesn't
// have room for.
// whoForName/whoForFriendId (added for "Occasion architecture should not be
// a silo," CLAUDE.md) are the same structured "person being celebrated"
// fields occasion_group_plans already had -- title alone used to conflate
// person+occasion as free text with no queryable field behind it.
export function buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId, whoForName = null, whoForFriendId = null }) {
  return {
    occasionType: occasion,
    title,
    occasionDate: scheduledAt.toISOString().slice(0, 10),
    recursAnnually: occasion === 'anniversary' || occasion === 'birthday',
    connectedUserId: connectedUserId ?? null,
    whoForName: whoForName ?? null,
    whoForFriendId: whoForFriendId ?? null,
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

// "Birthday reminders as a recurring retention mechanism" (CLAUDE.md):
// deep-linking an upcoming-birthday push straight into this wizard, for a
// real, self-logged Occasions row (a non-Nearby-user person, e.g. "Mom"),
// needs a real name to pre-fill -- but that table only stores a single
// free-text title ("Mom's Birthday"), no separate name field. Best-effort,
// honestly labeled extraction: only returns a name when the title
// genuinely matches the "X's Birthday" shape every wizard-composed title
// of this kind already has (composeCelebrationTitle's own output);
// anything else (a title typed some other way) returns null rather than
// guessing wrong -- the caller should fall back to letting the person
// re-type it, never silently mislabel an unrelated string as a name.
export function extractNameFromBirthdayTitle(title) {
  if (!title) return null;
  const match = title.match(/^(.+?)['’]s\s+birthday$/i);
  return match ? match[1].trim() : null;
}

// "Group planning for an Occasion" (CLAUDE.md, direct user follow-up):
// decide_occasion_group_plan()'s own jsonb payload already carries every
// real answer this wizard needs (occasion/who-for/activity/when -- the
// group already decided all of it) -- this maps that payload onto the
// wizard's existing initialOccasion/initialWhoFor/... route params
// (occasionGroupPlans.js) so the wizard can skip straight to its last real
// step (business 'options', or gathering/custom 'who_involved') instead of
// re-asking questions that are already answered. whoFor itself isn't a
// column on occasion_group_plans (only whoForName/whoForFriendId are) --
// inferred the same way every other entry point into this wizard already
// does: a real connected friend id means 'friend', a typed name with no id
// means 'someone_else', neither means 'me'. scheduledDate is a plain date
// (occasion_group_plans.scheduled_date has no time-of-day column, per the
// user's own "no complicated calendars" guardrail) -- a fixed noon time is
// only ever used downstream for its date portion (submitBusinessRequest's
// `date` field, the optional calendar save), never displayed as a real
// scheduled time.
// groupPlanId (added for "Occasion architecture should not be a silo,"
// CLAUDE.md) threads the real occasion_group_plans.id through so that once
// the wizard actually creates a real gathering/business_request from this
// decided plan, it can link back (linkOccasionGroupPlanToPlan) -- without
// this, the group plan itself never learns it was fulfilled.
export function resolveDecidedGroupPlanParams(decided, groupPlanId = null) {
  const whoFor = decided.whoForFriendId ? 'friend' : decided.whoForName ? 'someone_else' : 'me';
  return {
    initialOccasion: decided.occasionType,
    initialWhoFor: whoFor,
    initialWhoForName: decided.whoForName ?? null,
    initialWhoForFriendId: decided.whoForFriendId ?? null,
    initialActivityType: decided.activityType,
    initialWhenPreset: decided.whenPreset,
    initialScheduledAtISO: decided.scheduledDate ? `${decided.scheduledDate}T12:00:00` : null,
    initialPartySize: decided.partySize ?? null,
    initialGroupPlanId: groupPlanId,
  };
}
