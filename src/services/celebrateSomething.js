// Item 61 ("Celebrate Something" life-events planning layer, CLAUDE.md) --
// pure logic for the wizard: occasion -> who's it for -> what to do -> when
// -> who's involved -> route to an existing real creation/request screen
// with full prefill. No new entity; this is orchestration only, same
// discipline as surpriseMeLogic.js's own mood-to-real-params mapping.
import { occasionLabel, occasionIcon, CALENDAR_SAVEABLE_OCCASION_KEYS } from '../constants/businessAttributes';
import { experienceTemplateForOccasion } from '../constants/experienceTemplates';
import { relevantAddonTypesForOccasion } from '../constants/planAddons';
import { moneyLabel, moneyNumber } from '../utils/outcomeDisplay';

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

// Item 94 (CLAUDE.md, "Add budget without making it feel transactional") --
// replaces the original Item 66 design (a literal "$50-100" dollar-range
// chip row, exactly the "forced range feels transactional" pattern this
// item calls out) with a lightweight qualitative pick -- never AI-inferred.
// Reuses the exact same $/$$/$$$ symbols this app's own PRICE_LEVEL_LABELS
// (gatherings.price_level, business_experiences.price_level) already use
// for price tier elsewhere -- one shared vocabulary, not a fourth copy
// that could drift. Each tier's `max` is a real, honest representative
// per-person ceiling, not a fabricated range -- a disclosed judgment call,
// not a measured fact, same posture as this app's other "reasonable
// default" choices (see CLAUDE.md, e.g. Item 78's lead-time note). There is
// deliberately no `min` here -- the item's own design is a ceiling
// ("maximum per person"), never a floor; every call site now always sends
// budgetMin: null. The optional "Set a maximum per person" follow-up (see
// resolveBudgetMax below) always wins over a tier's own representative
// ceiling when the user bothers to type an exact number.
export const BUDGET_LEVEL_OPTIONS = [
  { key: 'any', label: 'No preference', max: null },
  // Item 82: people speak in words, not symbols. Keys and ceilings unchanged (budget contract); only the labels.
  { key: '$', label: 'Cheap · $', max: 25 },
  { key: '$$', label: 'Moderate · $$', max: 60 },
  { key: '$$$', label: 'Special occasion · $$$', max: 150 },
];

// The real budgetMax to submit -- an explicit numeric override always wins
// over the selected tier's own representative ceiling; an unrecognized key
// or no override at all falls back to 'any' (null), never a guess.
export function resolveBudgetMax(rangeKey, overrideInput) {
  const overrideNum = typeof overrideInput === 'string' && overrideInput.trim() ? parseInt(overrideInput.trim(), 10) : null;
  if (Number.isInteger(overrideNum) && overrideNum > 0) return overrideNum;
  const tier = BUDGET_LEVEL_OPTIONS.find((o) => o.key === rangeKey);
  return tier ? tier.max : null;
}

// Seeds the chip picker + override field from a real, already-saved
// budgetMax (e.g. a decided group plan's own agreed budget) -- an exact
// match to one of the tiers above re-selects that tier with the override
// field left collapsed; anything else (a custom number, or a value saved
// before this item under the old 4-bucket design) is honestly treated as a
// real custom ceiling, not silently rounded into the nearest tier.
export function initialBudgetSelectionFromMax(max) {
  if (max == null) return { key: 'any', override: '' };
  const match = BUDGET_LEVEL_OPTIONS.find((o) => o.key !== 'any' && o.max === max);
  if (match) return { key: match.key, override: '' };
  return { key: 'any', override: String(max) };
}

// A real, honest display string for whatever min/max combination actually
// got saved -- never fabricates the other half when only one bound is set
// (e.g. a plan whose budget predates this feature, or a caller who only
// ever passes one bound directly rather than through the chip list above).
export function formatBudgetRange(min, max) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${moneyLabel(min)}–${moneyNumber(max)}/person`;
  if (min != null) return `${moneyLabel(min)}+/person`;
  return `Up to ${moneyLabel(max)}/person`;
}

// Item 95 (CLAUDE.md, "Ask 'How important is the occasion?'") -- a real,
// explicit, always-editable answer, never AI-inferred. Distinct from Item
// 94's own budget question -- this is about effort/curation, not dollar
// amount (a "keep it simple" ask can still have a real budget, and vice
// versa) -- but it reuses the exact same "one shared chip vocabulary, both
// stored on the request AND surfaced to the business" shape budget already
// established. Defaults to 'special', the sensible middle ground, per this
// item's own "keeps the initial interaction easy" spirit -- always
// changeable, never a forced choice.
export const EXPERIENCE_LEVEL_OPTIONS = [
  { key: 'simple', label: 'Keep it simple', icon: '🙂' },
  { key: 'special', label: 'Make it special', icon: '✨' },
  { key: 'go_all_out', label: 'Go all out', icon: '🎆' },
];

export function experienceLevelLabel(key) {
  return EXPERIENCE_LEVEL_OPTIONS.find((o) => o.key === key)?.label ?? null;
}

// The one real, concrete lever this signal pulls on the resolver side in
// this first increment: reuses resolveIntent()'s already-existing,
// already-tested `priceLevel` param (the same $/$$/$$$ vocabulary
// PRICE_LEVEL_LABELS/priceAndPartyBonus already use for gatherings
// scoring) rather than inventing a new heuristic. 'simple' stays
// unbiased (null) -- a simple ask isn't necessarily a cheap one, so this
// only ever nudges toward pricier/more curated gatherings, never away from
// anything.
export function experienceLevelToPriceLevel(level) {
  if (level === 'go_all_out') return '$$$';
  if (level === 'special') return '$$';
  return null;
}

const ACTIVITY_ASK_PHRASE = {
  dinner: 'dinner',
  night_out: 'night out',
  activity: 'activity',
  party: 'party',
  surprise: 'surprise party',
  weekend_trip: 'weekend trip',
};

// 'other' has no real label worth repeating twice ("Custom Occasion
// Celebration" reads badly) -- collapses to the generic "Celebration" noun
// everywhere in this module instead. Moot in practice since Item 74
// (CLAUDE.md): picking 'other' in the wizard now branches to its own
// 'custom_describe' step, which never calls composeCelebrationTitle at
// all -- kept correct anyway in case a future caller still reaches here
// with occasion === 'other' some other way.
function celebrationNoun(occasion) {
  return occasion === 'other' ? 'Celebration' : occasionLabel(occasion);
}

// A real chosen friend/match name (whoForName) always wins when present --
// never fabricated. Falls back to a generic, honest phrase per whoFor when
// no specific name was picked (allowed -- "someone else"/"a friend" doesn't
// require naming a real connected person, e.g. a coworker not on Nearby).
//
// Item 84 (CLAUDE.md, "make the UI feel emotionally different"): appends
// the occasion's own real icon (occasionIcon(), same one already shown on
// every occasion chip) -- "Sarah's Birthday 🎂," never a plain "Saturday
// Dinner." Deliberately baked into the title STRING itself rather than a
// UI treatment bolted onto each downstream screen -- this is the one real
// output of the wizard that already flows, unmodified, into every already-
// unified surface an occasion can become (gatherings.title via
// quickStartTitle, occasion_group_plans.title, occasions.title) per Item
// 85's own "extend what's unified, don't silo" directive, so the
// personality travels everywhere for free with zero new screen-level code.
export function composeCelebrationTitle({ occasion, whoFor, whoForName }) {
  const noun = celebrationNoun(occasion);
  const icon = occasionIcon(occasion);
  const suffix = icon ? ` ${icon}` : '';
  if (whoFor === 'me') return `My ${noun}${suffix}`;
  if (whoForName) return `${whoForName}'s ${noun}${suffix}`;
  return noun === 'Celebration' ? `A Celebration${suffix}` : `${noun} Celebration${suffix}`;
}

const WHO_FOR_ASK_PHRASE = {
  me: 'for me',
  family: 'for a family member',
  someone_else: 'for someone special',
};

// Free-text framing used to prefill AskBusinessScreen's own text field and
// the "Custom" destination's assistant box -- a real, human-readable
// sentence built entirely from the wizard's own already-collected answers,
// never AI-generated at this step. Both of those destinations show the
// text back to the user for review/edit before anything is ever sent
// anywhere, so a real picked name is fine here -- this is the user's own
// editable draft, not yet business-visible.
export function composeCelebrationAskText({ occasion, whoFor, whoForName, activityType }) {
  const parts = [];
  if (occasion && occasion !== 'other') parts.push(occasionLabel(occasion).toLowerCase());
  const activityPhrase = ACTIVITY_ASK_PHRASE[activityType];
  if (activityPhrase) parts.push(activityPhrase);
  const subject = parts.length > 0 ? `A ${parts.join(' ')}` : 'Something';
  const forClause = whoForName ? `for ${whoForName}` : WHO_FOR_ASK_PHRASE[whoFor] ?? 'for a friend';
  return `${subject} ${forClause}`;
}

// Item 69 (CLAUDE.md): "Businesses shouldn't need to know the person's
// identity." A business should see "A birthday dinner for 8" -- never
// "for Sarah." This is the ONLY ask-text builder used for the wizard's
// direct-to-business paths (submitSelectedBusinessRequests' silent
// multi-submit, which has no user-review step at all before the text
// reaches a business) -- composeCelebrationAskText() above stays exactly
// as-is for the two destinations where the text is shown back to the user
// for their own editing first (AskBusinessScreen's prefill, the "Custom"
// assistant box). party size/occasion/budget already reach the business
// as their own real structured fields (submitBusinessRequest's own
// partySize/occasion/budgetMin/budgetMax params) -- this text only needs
// to name the occasion + activity, never who it's for.
export function composeCelebrationAskTextForBusiness({ occasion, activityType }) {
  const parts = [];
  if (occasion && occasion !== 'other') parts.push(occasionLabel(occasion).toLowerCase());
  const activityPhrase = ACTIVITY_ASK_PHRASE[activityType];
  if (activityPhrase) parts.push(activityPhrase);
  return parts.length > 0 ? `A ${parts.join(' ')}` : 'A celebration';
}

// Which real existing screen this activity type routes to. 'gathering' and
// 'business' are both deterministic, no-AI mappings; 'custom' is the one
// case that hands off to the existing free-text AI classification pipeline
// (CreateHubScreen's "Something Else" box), since there's no structured
// answer to route on.
//
// 'auto_plan' (Item 111, "We'll plan it for you" -- CLAUDE.md) is a
// pseudo-activity-type, same shape as 'group_vote' below it: picking it
// means "don't make me choose Dinner vs. Night Out vs. Activity myself,"
// and it routes to 'business' for the same reason those three already do
// -- fetchOptions() never actually reads activityType at all (only
// occasion/partySize/priceLevel/when), so which of the four the user picks
// has never changed what gets searched. What differs is only how the
// 'options' step presents itself once reached this way (see
// buildAutoPlanSuggestion below).
export function resolveCelebrationDestination(activityType) {
  if (activityType === 'party' || activityType === 'surprise' || activityType === 'weekend_trip') return 'gathering';
  if (activityType === 'dinner' || activityType === 'night_out' || activityType === 'activity' || activityType === 'auto_plan') return 'business';
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
// Item 65 (CLAUDE.md): surpriseMode always wins over connectedUserId --
// a surprise occasion can never be shared with the person it's for,
// enforced again at the DB layer (occasions_surprise_no_share_check) so
// this can't silently drift if some other caller ever forgets the rule.
export function buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId, whoForName = null, whoForFriendId = null, surpriseMode = false }) {
  return {
    occasionType: occasion,
    title,
    occasionDate: scheduledAt.toISOString().slice(0, 10),
    recursAnnually: occasion === 'anniversary' || occasion === 'birthday',
    connectedUserId: surpriseMode ? null : (connectedUserId ?? null),
    whoForName: whoForName ?? null,
    whoForFriendId: whoForFriendId ?? null,
    surpriseMode,
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
//
// Item 84 (CLAUDE.md): composeCelebrationTitle() now appends the
// occasion's own icon ("Sarah's Birthday 🎂") -- strip a real trailing
// " 🎂" (birthday's own icon, looked up rather than hardcoded so this
// can never drift from OCCASION_OPTIONS) before matching, so a title
// composed after this change still parses correctly. A title saved
// before this change (no trailing icon) is untouched and matches exactly
// as before.
export function extractNameFromBirthdayTitle(title) {
  if (!title) return null;
  const icon = occasionIcon('birthday');
  const stripped = icon && title.endsWith(` ${icon}`) ? title.slice(0, -(icon.length + 1)) : title;
  const match = stripped.match(/^(.+?)['’]s\s+birthday$/i);
  return match ? match[1].trim() : null;
}

// "Connect it to businesses" -- every real, selectable business_availability
// candidate resolveIntent() found: bundles, per-component items, and (when
// no experience assembled) the flat list, deduped by id since the same
// posting could otherwise appear in more than one of those buckets. Shared
// by CelebrateSomethingScreen's own solo 'options' step and, for Item 67
// ("Let the group vote on businesses," CLAUDE.md), GroupOccasionPlanScreen's
// real-candidates-for-the-group-to-vote-on fetch -- one dedup rule instead
// of two copies that could drift.
export function dedupeBusinessCandidates(optionsResult) {
  if (!optionsResult) return [];
  const byId = new Map();
  (optionsResult.experience?.bundles ?? []).forEach((c) => byId.set(c.id, c));
  (optionsResult.experience?.components ?? []).forEach((comp) => {
    comp.items.forEach((c) => { if (c.type === 'business_availability') byId.set(c.id, c); });
  });
  if (!optionsResult.experience) {
    (optionsResult.items ?? [])
      .filter((c) => c.type === 'business_availability')
      .forEach((c) => byId.set(c.id, c));
  }
  // Item 68 (CLAUDE.md): a business_occasion_package is a standing product,
  // never fed into assembleExperience()'s own bundle/component grouping
  // (that's keyed to dinner/dessert/etc-shaped categories, not "the whole
  // night handled by one business's package") -- always included from the
  // flat list directly, regardless of whether an Experience also assembled,
  // so a real published package is never hidden behind bundle/component
  // logic that was never built to recognize it.
  (optionsResult.items ?? [])
    .filter((c) => c.type === 'business_occasion_package')
    .forEach((c) => byId.set(c.id, c));
  return Array.from(byId.values());
}

// Item 67: the top few real business_availability ids for the group to vote
// on -- Nearby's own curated picks (highest-scored first), never an open
// proposal free-for-all. `limit` mirrors propose_occasion_business_options'
// own 5-option cap server-side (a lower client-side value is fine; a higher
// one just gets partially accepted, never an error).
// Deliberately filtered to business_availability only, even though
// dedupeBusinessCandidates() also now returns business_occasion_package
// candidates (Item 68, CLAUDE.md): occasion_group_plan_options' own real
// schema binds a proposed option to a business_availability_id FK -- a
// package has no such row to bind to. Group-voting on a package is a real,
// disclosed, bounded fast-follow, not built in this pass.
export function extractBusinessCandidateIds(optionsResult, limit = 5) {
  return dedupeBusinessCandidates(optionsResult)
    .filter((c) => c.type === 'business_availability')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((c) => c.id);
}

// Item 67: a real, honest one-line detail string for a business option
// being voted on -- "$65 · Fri, Sep 19 · 7:00 PM" -- built only from
// whatever the server actually returned (get_occasion_group_plan_detail's
// live-joined price/startsAt), same "$X" convention (no "/person" suffix)
// AskBusinessScreen already uses for the identical field.
export function formatBusinessOptionDetail({ price, startsAt }) {
  const parts = [];
  if (startsAt) {
    const d = new Date(startsAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    }
  }
  if (price != null) parts.push(`${moneyLabel(price)}`);
  return parts.join(' · ') || null;
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
    // Item 65 (CLAUDE.md): carries a surprise plan's own flag forward so
    // the wizard's post-decide "find options nearby" step doesn't lose
    // surprise context and re-show a "share with friend" checkbox as if
    // nothing was ever hidden.
    initialSurpriseMode: decided.surpriseMode ?? false,
    // Item 66 (CLAUDE.md): carries the group's own real budget forward into
    // the wizard's post-decide "find options nearby" step and, from there,
    // into whichever business request the group actually submits.
    initialBudgetMin: decided.budgetMin ?? null,
    initialBudgetMax: decided.budgetMax ?? null,
    // Item 95 (CLAUDE.md, "Ask 'How important is the occasion?'"): carries
    // the group's own real answer forward the same way budget already is.
    initialExperienceLevel: decided.experienceLevel ?? null,
  };
}

// Item 71 (CLAUDE.md): "Occasions can automatically suggest people" -- a
// real, honest possessive label ("Sarah's friends", "Chris' friends") for
// the who_involved step's suggestion panel and the confirmation screen it
// carries through to. Pure and dependency-free, same split as every other
// small formatter in this file.
export function possessiveFriendsLabel(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  return `${trimmed}${trimmed.endsWith('s') ? '’' : '’s'} friends`;
}

// Item 111 ("We'll plan it for you" -- CLAUDE.md): a real, honest
// aggregation of what the 'options' step's own already-fetched
// resolveIntent() result (via assembleExperience(), Item 61's own "connect
// it to businesses" follow-up) amounts to as ONE proposed plan -- never a
// second, speculative fetch, and never a fabricated price. Two kinds of
// line item, kept honestly distinct rather than blended into one
// misleading total:
// - `items`: one per real Experience Template component that found a
//   genuine top-scored match (e.g. "🍽️ Dinner" / "🎵 Something Fun") --
//   `estimatedTotal` is summed ONLY from these, and only from the ones
//   with a real known price; `hasUnknownPrice` tells the caller to render
//   the total as a floor ("$X+") rather than an exact figure when at
//   least one matched item's own price isn't listed.
// - `suggestions`: real, deterministic occasion -> relevant add-on TYPES
//   (planAddons.js's own relevantAddonTypesForOccasion) -- these have no
//   real matched business yet (an add-on only becomes a real request
//   against a real primary business_requests row, Item 80, which doesn't
//   exist until this plan is actually submitted), so they're shown as
//   ideas only, never priced, never counted toward the total. Filtered to
//   drop any add-on type whose own single category is already covered by
//   a real, genuinely-matched template component (e.g. birthday's
//   'entertainment'/'dessert' add-ons are dropped once "Something Fun"/
//   "Sweet Treat" already matched something in that same category) --
//   otherwise the same real idea (live music, dessert) would be shown
//   twice, once priced and once not. Capped at 2 so the summary stays
//   lean, matching the mock's own 3-total-items shape rather than dumping
//   every deterministically-relevant add-on type onto the screen at once.
export function buildAutoPlanSuggestion(occasion, optionsResult) {
  const template = experienceTemplateForOccasion(occasion);
  const components = optionsResult?.experience?.components ?? [];

  const items = components
    .map((comp) => {
      const top = comp.items?.[0] ?? null;
      if (!top) return null;
      return {
        key: comp.key,
        label: comp.label,
        id: top.id,
        businessName: top.matchedAvailability?.partnerName ?? top.title ?? null,
        price: top.matchedAvailability?.price ?? null,
      };
    })
    .filter(Boolean);

  const estimatedTotal = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const hasUnknownPrice = items.some((item) => item.price == null);

  // Only the categories a component that ACTUALLY found a real match
  // covers, not every category the static template merely lists -- a
  // component with zero genuine matches was already dropped by
  // assembleExperience() (never shown, never "covered"), so its own
  // add-on-type sibling should still be offered as a real, useful
  // suggestion rather than incorrectly hidden.
  const coveredCategories = new Set(
    components.flatMap((comp) => template?.components.find((t) => t.key === comp.key)?.categories ?? [])
  );
  const suggestions = relevantAddonTypesForOccasion(occasion)
    .filter((addon) => !addon.category || !coveredCategories.has(addon.category))
    .slice(0, 2)
    .map((addon) => ({ type: addon.key, label: addon.label, icon: addon.icon }));

  return { items, estimatedTotal, hasUnknownPrice, suggestions };
}
