import React, { useState, useEffect, useMemo } from 'react';
import ExperiencePerkLine from '../components/ExperiencePerkLine';
import ExperienceComponentList from '../components/ExperienceComponentList';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { getMyFriends, getMutualFriends } from '../services/friends';
import { getMyCommunities } from '../services/communities';
import { addOccasion, linkOccasionToPlan } from '../services/occasions';
import { resolveIntent, runIntentSearch, navigateToIntentResultItem } from '../services/intentResolver';
import { intentSearchFallbackTitle, INTENT_SEARCH_TYPE_EMOJI, intentPhaseCaption } from '../services/intentResolverScoring';
import { routeClassifiedIntentToCreation } from '../services/createAssistant';
import { recordIntentSelection } from '../services/intentOutcomes';
import { submitBusinessRequest, createPlanAddonRequest } from '../services/businessFulfillment';
import { createOccasionGroupPlan, linkOccasionGroupPlanToPlan } from '../services/occasionGroupPlans';
import { sendPreferencePoll, getMyAskedPreferencePolls } from '../services/preferencePolls';
import { PREFERENCE_POLL_QUESTIONS } from '../constants/preferencePollQuestions';
import { occasionGroupOptions } from '../constants/businessAttributes';
import { WHEN_PRESETS, dateForPreset } from '../utils/whenPresets';
import {
  composeCelebrationTitle,
  composeCelebrationAskText,
  composeCelebrationAskTextForBusiness,
  resolveCelebrationDestination,
  resolveCelebrationVisibility,
  celebrationCategoryHint,
  shouldOfferCalendarSave,
  buildOccasionSaveParams,
  dateWindowForWhenPreset,
  dedupeBusinessCandidates,
  possessiveFriendsLabel,
  ACTIVITY_OPTIONS,
  BUDGET_LEVEL_OPTIONS,
  resolveBudgetMax,
  initialBudgetSelectionFromMax,
  formatBudgetRange,
  EXPERIENCE_LEVEL_OPTIONS,
  experienceLevelToPriceLevel,
  buildAutoPlanSuggestion,
} from '../services/celebrateSomething';
import { experienceTemplateForOccasion } from '../constants/experienceTemplates';
import { OccasionAnimation, OCCASION_SELECT_ANIMATIONS, NearbyPickBadge, NLoader, FoundLine, showSuccessToast } from '../motion';
import FindingOptionsLoader from '../components/FindingOptionsLoader';
import StaggeredReveal from '../components/StaggeredReveal';
import { PICK_DATE_KEY } from './AskBusinessScreen';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { moneyLabel } from '../utils/outcomeDisplay';

// Item 61 ("Celebrate Something" life-events planning layer, CLAUDE.md):
// occasion -> who's it for -> what to do -> when -> who's involved, then
// hand off to a real existing screen (CreateGathering/AskBusiness/
// CreateHubScreen's own AI box) with full prefill. This screen creates
// nothing itself -- it's pure orchestration, same posture as
// SurpriseMeSheet.js. Full architecture rationale:
// PRODUCT_AUDIT/CELEBRATE_SOMETHING_2026-09-12.md.
//
// Renamed to "Occasion" in every user-facing surface (direct user request,
// CLAUDE.md, 2026-09-12) -- Create's own primary "Occasion" card, this
// screen's nav title ("Create an Occasion") and in-body header both said
// Occasion, matching the app's existing Gathering/Gatherings and
// Community/Communities create-vs-browse naming pattern (singular =
// create this one; plural, OccasionsScreen.js, = browse/manage the ones
// you've already logged -- a genuinely different, pre-existing screen,
// not this one). Internal identifiers (this file's own name, the
// 'CelebrateSomething' route key, celebrateSomething.js) deliberately
// were NOT renamed -- they're not user-visible, and renaming them risks
// exactly the file-name collision this comment is disambiguating
// (OccasionScreen.js vs OccasionsScreen.js) for no real benefit.
//
// Item 83 (CLAUDE.md, direct user request): user-facing name changed
// again, this time to "Plan for Someone" -- "'Occasion' sounds like
// internal product terminology; 'Plan for Someone' immediately
// communicates the action." Same internal-identifiers-untouched posture
// as the original rename above (still CelebrateSomethingScreen.js /
// 'CelebrateSomething' / celebrateSomething.js / occasion === the state
// key everywhere in this file). The occasion step itself also gained a
// real 5-tile quick-pick front door (Birthday / Anniversary / Celebration
// / Surprise / Custom) in front of the existing 24-value grouped picker
// (occasionGroupOptions(), unchanged, still reachable via "More
// occasions") -- per the user's own locked answer, "simple front door,
// full capability behind it," never a replacement for the full
// vocabulary. All five tiles funnel into the exact same `occasion` state
// and the same downstream pipeline every other occasion pick already
// used -- no second, divergent implementation.
//
// "Connect it to businesses" follow-up (direct user request): for a
// business-destined activity type (dinner/night_out/activity), the final
// step becomes a real live-options step ("options") instead of the
// otherwise-vestigial "who's involved" question -- that question never
// actually fed anything for a business ask (visibility only matters for
// the gathering destination), so this replaces it rather than bolting on
// a 6th step. Every other destination keeps "who's involved" unchanged.
//
// "Group planning for an Occasion" follow-up (CLAUDE.md, direct user
// request -- Sarah's 30th Birthday example): activityType === 'group_vote'
// is a special, non-real activity type -- it means "don't decide this
// myself," so instead of 'options'/'who_involved' the final step becomes
// 'group_invite' (pick real friends to invite, then create a real
// occasion_group_plans row for them to propose/vote on). Once the group
// decides, CelebrateSomethingScreen is re-entered from
// GroupOccasionPlanScreen with the real decided activityType already set,
// so this branch is never hit twice for the same plan.
//
// Item 74 (CLAUDE.md, "'Custom Occasion' is important"): a real life event
// like "my dad is visiting from out of town" doesn't fit who/what/when
// structured questions the way a birthday or dinner does -- forcing the
// same 4 more questions on it would fight the whole point of having an
// open-ended catch-all. occasion === 'other' ("Custom Occasion") is a
// wholly different, much shorter path: describe it in one free-text
// sentence, and Nearby classifies + resolves that directly (the same
// classify+resolve pipeline Home's ask box and Discover's search already
// use, runIntentSearch()) instead of asking who it's for, what to do, and
// when one question at a time.
function buildStepDefs(occasion, activityType) {
  if (occasion === 'other') {
    return [
      { key: 'occasion', label: 'Occasion' },
      { key: 'custom_describe', label: 'Describe' },
    ];
  }
  const base = [
    { key: 'occasion', label: 'Occasion' },
    { key: 'who_for', label: 'Who' },
    { key: 'activity', label: 'What' },
    { key: 'when', label: 'When' },
  ];
  if (activityType === 'group_vote') {
    base.push({ key: 'group_invite', label: 'Invite' });
  } else {
    // "ok do it" (CLAUDE.md, direct follow-up to the "Who to invite ->
    // Options" flow the user asked for): "Involve" now precedes "Options"
    // for a business-destined activity too, instead of the two being
    // mutually exclusive. It's the same real friend-picker the gathering/
    // custom destinations already use (WHO_INVOLVED_OPTIONS +
    // selectedInviteeIds) -- goNext() advances to 'options' instead of
    // calling proceedToDestination() directly when the destination is
    // 'business', and submitSelectedBusinessRequests() carries the real
    // selection forward as suggestedInviteeIds onto the resulting
    // BusinessRequestDetail screen's own already-existing "Invite Someone"
    // panel (Item 36) -- pre-highlighted, never auto-sent, same posture as
    // GatheringConfirmationScreen's identical suggestedInviteeIds already
    // established. No new invite mechanism, no new step type.
    base.push({ key: 'who_involved', label: 'Involve' });
    if (resolveCelebrationDestination(activityType) === 'business') {
      base.push({ key: 'options', label: 'Options' });
    }
  }
  return base;
}

// A real, optional guest count -- feeds resolveIntent()'s own real hard
// feasibility filter (a posting whose capacity can't fit this many people
// is excluded server-side, not just ranked lower) and the submitted
// business_request's own party_size column. Left unset (null) is honest
// and common -- never defaulted to a guessed number.
const PARTY_SIZE_OPTIONS = [2, 4, 6, 8, 10];

const WHO_FOR_OPTIONS = [
  { key: 'me', label: 'Me', icon: '🙋' },
  { key: 'friend', label: 'A Friend', icon: '🤝' },
  { key: 'family', label: 'Family Member', icon: '👨‍👩‍👧' },
  { key: 'someone_else', label: 'Someone Else', icon: '✨' },
];

// "Group planning for an Occasion" (CLAUDE.md): a real, distinct choice on
// the same step, not one of the 7 real activity types above -- picking it
// means "don't decide this myself," and the wizard branches to a real
// invite step instead of asking what to do. Rendered separately below the
// main row so it doesn't read as an 8th equivalent activity choice.
const GROUP_VOTE_OPTION = { key: 'group_vote', label: 'Let the Group Vote', icon: '🗳️' };

// Item 111 ("We'll plan it for you" -- CLAUDE.md): another real, distinct
// pseudo-activity-type, same shape as GROUP_VOTE_OPTION above -- picking it
// means "I don't know what to do, you decide," not an 8th equivalent
// activity choice. Only rendered when the current occasion has a real
// Experience Template (experienceTemplateForOccasion) to auto-select from
// -- an occasion with no template (e.g. a plain Farewell) has nothing
// multi-part to propose, so offering this would set up a false promise.
const AUTO_PLAN_OPTION = { key: 'auto_plan', label: 'Let Nearby Plan It', icon: '🤖' };

// Item 83 (CLAUDE.md, "Plan for Someone"): a real, fast front door in front
// of the existing 24-value grouped occasion picker below it -- "the most
// understandable/high-frequency entry points, not the entire underlying
// occasion system" (the user's own framing). Every key here maps onto a
// real occasion the wizard already fully supports (birthday/anniversary/
// celebration/other) -- 'surprise' is a pseudo-key handled specially in
// its own onPress below, not a real occasion_type: it sets
// occasion='celebration' and turns Item 65's real surprise_mode on,
// rather than inventing a new vocabulary value for something that's
// actually a privacy mode applicable to any occasion. Deliberately
// defined here rather than in businessAttributes.js, same precedent as
// WHO_FOR_OPTIONS/GROUP_VOTE_OPTION above -- wizard-UI-only presentation,
// not a data vocabulary any other screen needs.
const QUICK_OCCASION_TILES = [
  { key: 'birthday', label: 'Birthday', icon: '🎂' },
  { key: 'anniversary', label: 'Anniversary', icon: '💍' },
  { key: 'celebration', label: 'Celebration', icon: '🎉' },
  { key: 'surprise', label: 'Surprise', icon: '✨' },
  { key: 'other', label: 'Custom', icon: '✏️' },
];
const QUICK_PICK_OCCASION_KEYS = ['birthday', 'anniversary', 'celebration', 'other'];

const WHO_INVOLVED_OPTIONS = [
  { key: 'friends', label: 'Friends', icon: '👥' },
  { key: 'family', label: 'Family', icon: '👨‍👩‍👧‍👦' },
  { key: 'existing_group', label: 'Existing Group', icon: '👪' },
  { key: 'invite_specific', label: 'Invite Specific People', icon: '✋' },
];

// "Birthday reminders as a recurring retention mechanism" (CLAUDE.md): a
// real reason to open the app should land somewhere useful, not back at
// step 1 to re-answer questions the push already answered. `initialOccasion`/
// `initialWhoFor`/`initialWhoForName`/`initialWhoForFriendId` (all optional)
// pre-seed the wizard's own state and skip straight past whichever leading
// steps are already known -- never further than the "What would you like
// to do?" step, since that answer is never knowable in advance. Generic by
// design, not birthday-specific -- any future deep link into this wizard
// can use the same convention.
// "Group planning for an Occasion" follow-up: once a group has decided
// (GroupOccasionPlanScreen navigates back in here via
// resolveDecidedGroupPlanParams()), occasion/who-for/activity/when are ALL
// already real, group-decided answers -- skip straight to this activity
// type's own real last step (business 'options', or gathering/custom
// 'who_involved') rather than re-asking anything.
function initialStepFor(route) {
  const occasion = route.params?.initialOccasion;
  const hasOccasion = !!occasion;
  const hasWhoFor = !!route.params?.initialWhoFor;
  const hasActivity = !!route.params?.initialActivityType;
  const hasWhen = !!route.params?.initialWhenPreset;
  // Latent bug fix, found while building Item 86: occasion === 'other' has
  // its own 2-step buildStepDefs() (occasion, custom_describe) with no
  // who_for/activity/when steps at all -- the hasWhoFor branch below would
  // return step index 2, out of bounds for that 2-step array. Not
  // previously reachable (no caller combined initialOccasion:'other' with
  // initialWhoFor), but Item 86's own ViewProfileScreen entry point can
  // reach it on a Back-navigation re-seed, so it's fixed here rather than
  // left as a live trap.
  if (hasOccasion && occasion === 'other') return 1; // 'custom_describe'
  if (hasOccasion && hasWhoFor && hasActivity && hasWhen) {
    return buildStepDefs(occasion, route.params.initialActivityType).length - 1;
  }
  if (hasOccasion && hasWhoFor) return 2; // 'activity'
  if (hasOccasion) return 1; // 'who_for'
  return 0;
}

export default function CelebrateSomethingScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [step, setStep] = useState(() => initialStepFor(route));

  const [occasion, setOccasion] = useState(route.params?.initialOccasion ?? null);

  // "Occasion architecture should not be a silo" (CLAUDE.md): present only
  // on a decided-group-vote re-entry (resolveDecidedGroupPlanParams) --
  // lets the eventual real business_request/gathering this wizard hands
  // off to link back to the occasion_group_plans row that decided it, so
  // that row learns it was actually fulfilled instead of staying 'decided'
  // forever with no trace of what happened next.
  const [groupPlanId] = useState(route.params?.initialGroupPlanId ?? null);

  const [whoFor, setWhoFor] = useState(route.params?.initialWhoFor ?? null);
  const [whoForName, setWhoForName] = useState(route.params?.initialWhoForName ?? '');
  const [whoForFriendId, setWhoForFriendId] = useState(route.params?.initialWhoForFriendId ?? null);
  const [friends, setFriends] = useState([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  // Item 63 (CLAUDE.md): "the app already knows... relevant friends" for
  // the group-vote invite step -- real mutual friends between the caller
  // and whoForFriendId (get_mutual_friends, already live infrastructure),
  // surfaced first/marked in the chip list below as a suggestion, never
  // auto-selected -- the user still makes the actual invite decision.
  const [mutualFriendIds, setMutualFriendIds] = useState(() => new Set());

  const [activityType, setActivityType] = useState(route.params?.initialActivityType ?? null);
  const [partySize, setPartySize] = useState(route.params?.initialPartySize ?? null);

  const [whenPreset, setWhenPreset] = useState(route.params?.initialWhenPreset ?? null);
  const [scheduledAt, setScheduledAt] = useState(() => (
    route.params?.initialScheduledAtISO
      ? new Date(route.params.initialScheduledAtISO)
      : new Date(Date.now() + 60 * 60 * 1000)
  ));
  const [showDatePicker, setShowDatePicker] = useState(false);

  // "Group planning for an Occasion": who to invite to propose/vote, and
  // the in-flight state of creating the real occasion_group_plans row.
  const [selectedInviteeIds, setSelectedInviteeIds] = useState(() => new Set());
  const [creatingGroupPlan, setCreatingGroupPlan] = useState(false);

  const [whoInvolved, setWhoInvolved] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);
  const [communityId, setCommunityId] = useState(null);

  const [saveToCalendar, setSaveToCalendar] = useState(false);
  // Item 62 (CLAUDE.md): naming a real connected friend as who this is for
  // is an organizational/grouping choice, not automatically a consent to
  // share the record with them -- occasions.connected_user_id (which
  // actually grants them read access via get_upcoming_occasions) is only
  // ever set when this is explicitly checked. Defaults OFF -- "the user
  // chooses what Nearby is allowed to remember," never an implicit share.
  const [shareOccasionWithFriend, setShareOccasionWithFriend] = useState(false);
  // Item 65 (CLAUDE.md, direct user request): "Maybe I'm planning a
  // surprise birthday. The birthday person should not automatically see:
  // Allen is planning your birthday." Only meaningful once a real
  // connected friend is picked as who_for -- there's nothing on Nearby to
  // hide from someone with no account. Turning this on forces
  // shareOccasionWithFriend off (a surprise occasion can never also be
  // shared with the person it's for -- also a hard DB constraint) and
  // excludes whoForFriendId from the group-vote invite list.
  // Seeded from a decided group plan (resolveDecidedGroupPlanParams) so a
  // host who decided a surprise plan doesn't lose that context navigating
  // back into this same wizard for the "find options nearby" step -- the
  // underlying group_plan row already has surprise_mode set regardless of
  // this local state, this just keeps the UI honest about it.
  const [surpriseMode, setSurpriseMode] = useState(route.params?.initialSurpriseMode ?? false);

  // Item 83 ("Plan for Someone"): the occasion step's own "More occasions"
  // reveal -- starts collapsed (just the 5 quick-pick tiles), but opens
  // automatically if the wizard is re-entered with an occasion already set
  // that isn't one of the tiles (e.g. Back-navigating after a deep link
  // pre-seeded a value like 'graduation'), so a real selection is never
  // hidden behind a link the user has to know to tap.
  const [showMoreOccasions, setShowMoreOccasions] = useState(
    () => !!route.params?.initialOccasion && !QUICK_PICK_OCCASION_KEYS.includes(route.params.initialOccasion)
  );

  // Item 112 (CLAUDE.md, "We should have animations for that too"): which
  // small, purposeful micro-celebration (if any) is currently playing --
  // null the rest of the time. Keyed by the TILE/option actually tapped,
  // not the resulting `occasion` state, since 'surprise' and 'celebration'
  // both resolve to occasion === 'celebration' but need two different
  // animations (OCCASION_SELECT_ANIMATIONS keeps them as separate keys).
  const [occasionAnimTrigger, setOccasionAnimTrigger] = useState(null);

  // Item 94 (CLAUDE.md, "Add budget without making it feel transactional"):
  // a lightweight qualitative $/$$/$$$/No preference pick for the group
  // vote -- 'any' (the default) means honestly unset, never a fabricated
  // guess. Seeded from a decided group plan the same way surpriseMode is
  // above, so a budget the group already agreed on carries into the
  // resulting business request; an exact custom ceiling (including one
  // saved under Item 66's original 4-bucket design) is preserved honestly
  // via the override field rather than silently rounded into a tier.
  const initialBudgetSelection = useMemo(
    () => initialBudgetSelectionFromMax(route.params?.initialBudgetMax ?? null),
    []
  );
  const [budgetRangeKey, setBudgetRangeKey] = useState(initialBudgetSelection.key);
  const [budgetMaxOverride, setBudgetMaxOverride] = useState(initialBudgetSelection.override);
  const [showBudgetMaxOverride, setShowBudgetMaxOverride] = useState(!!initialBudgetSelection.override);

  // Item 95 (CLAUDE.md, "Ask 'How important is the occasion?'"): a real,
  // explicit, always-editable answer -- never AI-inferred. Defaults to
  // 'special', the sensible middle ground (same "keeps the initial
  // interaction easy" spirit as Item 94's own budget default). Seeded from
  // a decided group plan the same way budget/surpriseMode already are, so
  // a host re-entering this wizard after "find options nearby" doesn't
  // lose the group's own real answer.
  const [experienceLevel, setExperienceLevel] = useState(route.params?.initialExperienceLevel ?? 'special');

  // "Connect it to businesses": resolveIntent()'s own real, already-scored
  // candidate pool (business_availability + gathering), fetched using the
  // wizard's own structured answers -- no free text, no AI classification
  // needed, since every field it needs is already real ground truth by the
  // time the user reaches this step.
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsFetched, setOptionsFetched] = useState(false);
  const [optionsResult, setOptionsResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [submittingOptions, setSubmittingOptions] = useState(false);

  // Item 111 ("We'll plan it for you" -- CLAUDE.md): activityType ===
  // 'auto_plan' reaches this exact same 'options' step and fetch (see
  // resolveCelebrationDestination/fetchOptions -- activityType was never
  // actually read by either), but presents it as a compact "Here's what
  // we'd do" summary first (autoPlanExpanded === false) rather than the
  // full browse-and-check UI -- tapping "Find available options →" reveals
  // that same existing UI, pre-selected with what was just proposed.
  // autoPlanAddonTypes holds which of buildAutoPlanSuggestion()'s real
  // add-on-type suggestions (e.g. Flowers) the user keeps checked; those
  // become real create_plan_addon_request() calls on the primary that
  // results from submission, not a second independent business_requests
  // row (they have no specific candidate/price of their own to preserve).
  const [autoPlanExpanded, setAutoPlanExpanded] = useState(false);
  const [autoPlanAddonTypes, setAutoPlanAddonTypes] = useState(() => new Set());

  // Item 74: "Custom Occasion" ('other') -- one open-ended free-text
  // description instead of who/what/when, resolved via the same
  // classify+resolve pipeline Home's ask box and Discover's search already
  // use (runIntentSearch()). customSearchResult holds the full
  // {outcome, items, experience, classifyResult, typedText, submissionId}
  // shape runIntentSearch() returns -- null until a search has actually run.
  // Item 75 (CLAUDE.md): landing here from OccasionsScreen's calendar
  // section ("Plan Something →" on a real device-calendar event) prefills
  // this with the event's own title -- still fully editable, same "AI/
  // signals suggest, never silently commit" posture as every other prefill
  // in this wizard.
  const [customDescription, setCustomDescription] = useState(route.params?.initialCustomDescription ?? '');
  const [customSearching, setCustomSearching] = useState(false);
  const [customPhase, setCustomPhase] = useState(null); // Item 135: real pipeline phase
  const [customSearchResult, setCustomSearchResult] = useState(null);

  async function ensureFriendsLoaded() {
    if (friendsLoaded || loadingFriends) return;
    setLoadingFriends(true);
    const data = await getMyFriends();
    setFriends(data);
    setLoadingFriends(false);
    setFriendsLoaded(true);
  }

  // Items 63/71 (CLAUDE.md) fix: mutual friends must be re-fetched whenever
  // whoForFriendId itself changes, not folded into ensureFriendsLoaded()'s
  // one-shot fetch above. Real bug found while building Item 71: the "who
  // is this for" step's onPress calls ensureFriendsLoaded() the instant the
  // "A Friend" chip is tapped -- BEFORE the user has picked which specific
  // friend, so whoForFriendId is still null at that moment. Baking the
  // mutual-friends fetch into that one-shot call meant it was permanently
  // stuck at an empty set for the rest of the wizard session (friendsLoaded
  // guards against ever calling it again), silently breaking Item 63's own
  // "🤝 marks a friend you both know" badge on the group-vote invite step
  // ever since it shipped -- fails quiet, not a crash, so nothing caught it.
  useEffect(() => {
    let cancelled = false;
    if (!whoForFriendId) {
      setMutualFriendIds(new Set());
      return undefined;
    }
    getMutualFriends(whoForFriendId).then((mutuals) => {
      if (!cancelled) setMutualFriendIds(new Set(mutuals.map((m) => m.id)));
    });
    return () => { cancelled = true; };
  }, [whoForFriendId]);

  // Item 100 (CLAUDE.md): which of the 2 fixed preference questions have
  // already been asked of this real friend, so the "Ask a quick question"
  // panel can honestly show "Waiting for a reply" instead of letting a
  // duplicate ask hit send_preference_poll's own "already have a question
  // pending" rejection. Re-fetched whenever whoForFriendId changes, same
  // shape as the mutual-friends effect above.
  const [askedPollKeys, setAskedPollKeys] = useState(() => new Set());
  const [askPollExpanded, setAskPollExpanded] = useState(false);
  const [askPollSending, setAskPollSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAskPollExpanded(false);
    if (!whoForFriendId) {
      setAskedPollKeys(new Set());
      return undefined;
    }
    getMyAskedPreferencePolls(whoForFriendId).then((polls) => {
      if (cancelled) return;
      setAskedPollKeys(new Set(polls.filter((p) => !p.answeredAt).map((p) => p.questionKey)));
    });
    return () => { cancelled = true; };
  }, [whoForFriendId]);

  async function handleSendPreferencePoll(questionKey) {
    if (!whoForFriendId || askPollSending) return;
    setAskPollSending(true);
    try {
      await sendPreferencePoll(whoForFriendId, questionKey, composeCelebrationTitle({ occasion, whoFor, whoForName: whoForName.trim() || null }));
      setAskedPollKeys((prev) => new Set(prev).add(questionKey));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Couldn't send", e.message || 'Please try again.');
    }
    setAskPollSending(false);
  }

  async function ensureCommunitiesLoaded() {
    if (communitiesLoaded || loadingCommunities) return;
    setLoadingCommunities(true);
    const data = await getMyCommunities();
    setCommunities(data.filter((c) => c.status === 'active'));
    setLoadingCommunities(false);
    setCommunitiesLoaded(true);
  }

  function pickWhoFor(key) {
    Haptics.selectionAsync();
    setWhoFor(key);
    if (key !== 'me') {
      ensureFriendsLoaded();
    } else {
      setSurpriseMode(false);
      setShareOccasionWithFriend(false);
    }
  }

  function setSurpriseModeOn(next) {
    Haptics.selectionAsync();
    setSurpriseMode(next);
    if (next) setShareOccasionWithFriend(false);
  }

  // A push-deep-link entry (initialWhoFor pre-seeded) skips straight past
  // the "who's for" step's own onPress, which is normally what triggers
  // this -- pre-load anyway so a real Back-to-review still shows the real
  // friend chip list instead of an empty one.
  useEffect(() => {
    if (whoFor && whoFor !== 'me') ensureFriendsLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickWhoInvolved(key) {
    Haptics.selectionAsync();
    setWhoInvolved(key);
    if (key === 'existing_group') ensureCommunitiesLoaded();
  }

  function toggleInvitee(friendId) {
    Haptics.selectionAsync();
    setSelectedInviteeIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId); else next.add(friendId);
      return next;
    });
  }

  // Creates the real occasion_group_plans row and hands off to
  // GroupOccasionPlanScreen -- everyone invited proposes/votes there;
  // Nearby turns the winner back into this same wizard, pre-decided
  // (resolveDecidedGroupPlanParams), once the host picks it.
  async function createGroupVote() {
    if (selectedInviteeIds.size === 0) {
      return Alert.alert('Invite someone', 'Pick at least one friend to invite to vote.');
    }
    Haptics.selectionAsync();
    setCreatingGroupPlan(true);
    const trimmedName = whoForName.trim() || null;
    const title = composeCelebrationTitle({ occasion, whoFor, whoForName: trimmedName });
    if (saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId)) {
      addOccasion(buildOccasionSaveParams({ occasion, title, scheduledAt, connectedUserId: shareOccasionWithFriend ? whoForFriendId : null, whoForFriendId, surpriseMode })).catch(() => {});
    }
    try {
      const result = await createOccasionGroupPlan({
        occasionType: occasion,
        title,
        whoForName: trimmedName,
        whoForFriendId,
        whenPreset,
        scheduledDate: scheduledAt.toISOString().slice(0, 10),
        inviteeIds: Array.from(selectedInviteeIds),
        surpriseMode,
        budgetMin: null,
        budgetMax: resolveBudgetMax(budgetRangeKey, budgetMaxOverride),
        experienceLevel,
      });
      navigation.replace('GroupOccasionPlan', { planId: result.planId });
    } catch (e) {
      console.error('createOccasionGroupPlan error', e);
      Alert.alert('Something went wrong', "We couldn't create the group vote. Please try again.");
      setCreatingGroupPlan(false);
    }
  }

  function pickWhenPreset(key) {
    Haptics.selectionAsync();
    setWhenPreset(key);
    if (key === 'custom') {
      setShowDatePicker(true);
    } else {
      setScheduledAt(dateForPreset(key));
    }
  }

  const stepDefs = buildStepDefs(occasion, activityType);
  const stepKey = stepDefs[step].key;
  const destination = resolveCelebrationDestination(activityType);

  useEffect(() => {
    if (stepKey === 'options' && !optionsFetched && !optionsLoading) {
      fetchOptions();
    }
    if (stepKey === 'group_invite') {
      ensureFriendsLoaded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // A real staleness guard: going Back from 'options' to change occasion/
  // when/party size/experience level (all real inputs to the query above)
  // must force a fresh fetch next time 'options' is reached, not silently
  // keep serving results computed from the answers the user just changed.
  useEffect(() => {
    setOptionsFetched(false);
    setOptionsResult(null);
    setSelectedIds(new Set());
    setAutoPlanExpanded(false);
    setAutoPlanAddonTypes(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasion, activityType, whenPreset, scheduledAt, partySize, experienceLevel, whoForFriendId]);

  // Item 111: the real add-on-type suggestions depend on live-fetched
  // candidates (which template components actually found a match), so
  // they're only known once fetchOptions() resolves -- seed the accepted
  // set once, the moment that happens, rather than on every render (the
  // user's own later unchecks must survive a re-render of this same
  // result).
  const autoPlanSuggestion = useMemo(
    () => buildAutoPlanSuggestion(occasion, optionsResult),
    [occasion, optionsResult]
  );
  useEffect(() => {
    if (activityType === AUTO_PLAN_OPTION.key && optionsFetched) {
      setAutoPlanAddonTypes(new Set(autoPlanSuggestion.suggestions.map((s) => s.type)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsFetched]);

  function toggleAutoPlanAddonType(type) {
    Haptics.selectionAsync();
    setAutoPlanAddonTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  // "Find available options →" on the auto-plan summary: pre-selects
  // exactly what was just proposed (the real top candidate per matched
  // template component) and reveals the existing full browse-and-check UI
  // below it -- the user can still freely add/remove candidates from
  // there, this just saves re-picking what Nearby already suggested.
  function proceedFromAutoPlanSummary() {
    Haptics.selectionAsync();
    setSelectedIds(new Set(autoPlanSuggestion.items.map((i) => i.id)));
    setAutoPlanExpanded(true);
  }

  async function fetchOptions() {
    setOptionsLoading(true);
    try {
      const result = await resolveIntent({
        category: null,
        dateWindow: dateWindowForWhenPreset(whenPreset),
        rawText: '',
        partySize,
        occasion,
        // Item 95 (CLAUDE.md): "How important is the occasion?" adjusts
        // recommendations -- a real, concrete lever, not just a stored
        // field. 'simple' stays unbiased (null); 'special'/'go_all_out'
        // nudge toward pricier/more-curated real candidates.
        priceLevel: experienceLevelToPriceLevel(experienceLevel),
        // Item 100 (CLAUDE.md): a real connected friend's own standing/
        // polled preferences bias which businesses surface here -- never
        // exposed to them, never a filter, only ever set when a real
        // connected friend was picked as who-for.
        whoForFriendId,
        whoForName: whoForName.trim() || null,
      });
      setOptionsResult(result);
    } catch (e) {
      console.error('CelebrateSomething fetchOptions error', e);
      setOptionsResult({ items: [], experience: null });
    }
    setOptionsFetched(true);
    setOptionsLoading(false);
  }

  // Item 74: submits the free-text "What are you planning?" description
  // through the exact same classify+resolve pipeline Home's ask box and
  // Discover's search already use -- "Nearby then understands the intent
  // and starts building options," per the user's own framing. A
  // 'business_partner' classification ("propose this specific business as
  // a sponsor") has no results concept, same as every other caller of this
  // pipeline -- routes straight to creation instead of ever rendering a
  // results block.
  async function submitCustomDescription() {
    const typedText = customDescription.trim();
    if (!typedText) {
      return Alert.alert('Tell us more', "What are you planning? A sentence or two is enough.");
    }
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setCustomSearching(true);
    setCustomSearchResult(null);
    try {
      const result = await runIntentSearch(typedText, { onPhase: setCustomPhase });
      if (result.outcome === 'business_partner') {
        routeClassifiedIntentToCreation(navigation, result.classifyResult, typedText);
        return;
      }
      setCustomSearchResult(result);
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setCustomSearching(false);
  }

  // Tapping a real result leaves the wizard entirely -- same as every other
  // caller of navigateToIntentResultItem (Home's ask box, Discover's
  // search), a gathering/business/perk/community result is a real existing
  // thing to go look at or request, not another wizard step.
  function handleCustomResultTap(item) {
    const { classifyResult, typedText, submissionId } = customSearchResult ?? {};
    recordIntentSelection({
      rawText: typedText, category: classifyResult?.category ?? null, dateWindow: classifyResult?.dateWindow ?? null,
      resultType: item.type, resultId: item.id ?? null, resultTitle: item.title, submissionId,
    });
    navigateToIntentResultItem(navigation, item, { typedText, classifyResult });
  }

  // The real escape hatch when nothing already exists that fits -- same
  // "post what you need, businesses respond" flow (AskBusinessScreen) every
  // other unclear/empty intent result in this app already offers, prefilled
  // exactly the same way HomeScreen's own goAskBusiness() prefills it.
  function goAskBusinessFromCustom() {
    const { classifyResult, typedText, submissionId } = customSearchResult ?? {};
    recordIntentSelection({
      rawText: typedText, category: classifyResult?.category ?? null, dateWindow: classifyResult?.dateWindow ?? null,
      resultType: 'created_new', resultId: null, resultTitle: typedText, submissionId,
    });
    navigation.navigate('AskBusiness', {
      prefillText: typedText,
      prefillCategory: classifyResult?.category ?? null,
      prefillPartySize: classifyResult?.partySize ?? null,
      prefillBudgetMax: classifyResult?.budgetMax ?? null,
      prefillDateWindow: classifyResult?.dateWindow ?? null,
      prefillOccasion: classifyResult?.occasion ?? null,
      prefillSubmissionId: submissionId ?? null,
    });
  }

  // "None of these? Create it yourself" -- the same real fallback Home's
  // own ask box offers once resolveIntent() has genuinely found nothing
  // (routeClassifiedIntentToCreation, createAssistant.js): a gathering/
  // community/business_partner intent routes to its own real creation
  // screen, prefilled but never auto-submitted.
  function proceedToCustomCreation() {
    const { classifyResult, typedText, submissionId } = customSearchResult ?? {};
    routeClassifiedIntentToCreation(navigation, classifyResult, typedText);
    if (classifyResult?.intent !== 'business_partner') {
      recordIntentSelection({
        rawText: typedText, category: classifyResult?.category ?? null, dateWindow: classifyResult?.dateWindow ?? null,
        resultType: 'created_new', resultId: null, resultTitle: classifyResult?.title ?? typedText, submissionId,
      });
    }
  }

  // Every real, selectable business_availability candidate resolveIntent()
  // found -- bundles, per-component items, and (when no experience
  // assembled) the flat list, deduped by id since the same posting could
  // otherwise appear in more than one of those buckets. Shared with
  // GroupOccasionPlanScreen's own Item 67 candidate fetch --
  // dedupeBusinessCandidates() in celebrateSomething.js.
  const allCandidates = useMemo(() => dedupeBusinessCandidates(optionsResult), [optionsResult]);

  function toggleSelected(candidate) {
    // Item 68 (CLAUDE.md): a business_occasion_package is just as
    // selectable as a business_availability posting -- both are real,
    // bindable business supply, only 'gathering' (an already-happening
    // thing, rendered as a plain tap-to-view row above) isn't.
    if (candidate.type !== 'business_availability' && candidate.type !== 'business_occasion_package') return;
    Haptics.selectionAsync();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id);
      return next;
    });
  }

  // Submits one real business_request per selected candidate, each bound
  // via preferredAvailabilityId -- same "skip straight to offered" RPC
  // path AskBusinessScreen's own "Find options nearby" step (Item 53)
  // already uses for a single pick, extended here to several at once
  // since a birthday plan can genuinely need dinner AND something fun.
  // Never a blind bulk-submit with no visible outcome: a single success
  // lands on that request's own real detail screen exactly like a normal
  // solo ask would; several successes land on Plans, where every one of
  // them is independently already visible (Item 52).
  async function submitSelectedBusinessRequests() {
    const selected = allCandidates.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;
    setSubmittingOptions(true);
    const trimmedName = whoForName.trim() || null;
    const title = composeCelebrationTitle({ occasion, whoFor, whoForName: trimmedName });
    // Item 69 (CLAUDE.md): this submits straight to real businesses with
    // no user-review step in between -- the business-safe variant never
    // splices whoForName in ("A birthday dinner", never "A birthday
    // dinner for Sarah"). `title` above (which does carry the name) stays
    // scoped to the private calendar-save/occasion-link below, never sent
    // to a business.
    const askText = composeCelebrationAskTextForBusiness({ occasion, activityType });
    let savedOccasionId = null;
    if (saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId)) {
      const saveResult = await addOccasion(buildOccasionSaveParams({
        occasion, title, scheduledAt, connectedUserId: shareOccasionWithFriend ? whoForFriendId : null, whoForName: trimmedName, whoForFriendId, surpriseMode,
      })).catch(() => null);
      savedOccasionId = saveResult?.data?.id ?? null;
    }
    const dateParam = scheduledAt.toISOString().slice(0, 10);
    const results = await Promise.allSettled(
      selected.map((c) => submitBusinessRequest({
        text: askText,
        category: c.category ?? null,
        partySize,
        budgetMin: null,
        budgetMax: resolveBudgetMax(budgetRangeKey, budgetMaxOverride),
        date: dateParam,
        occasion,
        experienceLevel,
        surpriseMode,
        // Item 68 (CLAUDE.md): a picked business_occasion_package binds via
        // its own dedicated preferred param -- it has no business_
        // availability row behind it, so preferredAvailabilityId would be
        // the wrong id to send for one.
        preferredAvailabilityId: c.type === 'business_availability' ? c.id : null,
        preferredPackageId: c.type === 'business_occasion_package' ? c.id : null,
      }))
    );
    setSubmittingOptions(false);
    const succeeded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (succeeded.length === 0) {
      Alert.alert('Something went wrong', "We couldn't send those requests. Please try again.");
      return;
    }
    // Best-effort link-back to whichever real Occasion produced this --
    // the first succeeded request stands in for "the plan" when several
    // were submitted at once (this repo's own "no invented signals" rule
    // means we link to a real created plan, never guess which one is
    // primary beyond just picking the first real success).
    const primaryRequestId = succeeded[0].requestId;
    if (groupPlanId) {
      linkOccasionGroupPlanToPlan({ groupPlanId, resultingBusinessRequestId: primaryRequestId }).catch(() => {});
    }
    if (savedOccasionId) {
      linkOccasionToPlan({ occasionId: savedOccasionId, resultingBusinessRequestId: primaryRequestId }).catch(() => {});
    }
    // Item 111 ("We'll plan it for you"): the auto-plan summary's own
    // add-on-type suggestions (Flowers, a Photographer, ...) never had a
    // specific candidate/price of their own -- unlike the priced template
    // components above, which each keep their own real, already-bound
    // submission -- so they become real Item 80 add-on requests attached
    // to whichever primary just succeeded, rather than independent asks.
    // Best-effort: an add-on that fails to create (e.g. this occasion
    // genuinely has no nearby match for that category) never blocks or
    // undoes the primary submission that already succeeded.
    if (activityType === AUTO_PLAN_OPTION.key && autoPlanAddonTypes.size > 0) {
      Promise.allSettled(
        Array.from(autoPlanAddonTypes).map((type) => createPlanAddonRequest(primaryRequestId, type))
      ).catch(() => {});
    }
    if (succeeded.length === 1) {
      const params = {
        requestId: succeeded[0].requestId,
        justSubmitted: true,
        notifiedCount: succeeded[0].notifiedCount,
        duplicate: succeeded[0].duplicate,
        prefillText: askText,
        prefillOccasion: occasion,
        prefillPartySize: partySize,
        prefillDateWindow: whenPreset === 'custom' ? PICK_DATE_KEY : whenPreset,
        prefillPickedDateISO: whenPreset === 'custom' ? scheduledAt.toISOString() : null,
      };
      // "ok do it" (CLAUDE.md): the real "Involve" selection made just
      // before this step carries forward as suggested (never auto-sent)
      // invitees on the resulting request's own "Invite Someone" panel
      // (Item 36) -- same suggestedInviteeIds/suggestedInviteeLabel shape
      // GatheringConfirmationScreen already established, one convention
      // instead of two. Only threaded through the single-success path --
      // when several businesses were asked at once, each lands
      // independently on Plans (Item 52) with no one obvious request to
      // attach a suggestion to.
      if (selectedInviteeIds.size > 0) {
        params.suggestedInviteeIds = Array.from(selectedInviteeIds);
        params.suggestedInviteeLabel = possessiveFriendsLabel(whoForName);
      }
      navigation.replace('BusinessRequestDetail', params);
      return;
    }
    showSuccessToast('Requests sent', `🎉 Sent ${succeeded.length} requests — track them all from your Plans tab.`);
    navigation.navigate('Plans');
  }

  function goNext() {
    // Item 103 (CLAUDE.md, "Don't forget non-celebratory life events"):
    // these two validation prompts used to say "this celebration" --
    // wrong for a real Farewell/Moving/New Job occasion. Every other
    // on-screen label in this wizard was already neutral (see "What are
    // you planning?"/"Who is this for?" elsewhere in this file); these
    // two were the only stragglers.
    if (stepKey === 'occasion' && !occasion) {
      return Alert.alert('Pick an occasion', "What's the occasion?");
    }
    if (stepKey === 'who_for' && !whoFor) {
      return Alert.alert('Pick who it’s for', 'Who is this for?');
    }
    if (stepKey === 'activity' && !activityType) {
      return Alert.alert('Pick something to do', "What would you like to do?");
    }
    if (stepKey === 'when' && (!whenPreset || scheduledAt.getTime() <= Date.now())) {
      return Alert.alert('Pick a time', "When's this happening? Needs to be in the future.");
    }
    if (stepKey === 'who_involved') {
      if (!whoInvolved) {
        return Alert.alert('Pick who’s involved', 'Who should be involved?');
      }
      if (whoInvolved === 'existing_group' && !communityId) {
        if (!loadingCommunities && communities.length === 0) {
          return Alert.alert('No groups yet', "You're not a member of any active community yet — pick a different option instead.");
        }
        return Alert.alert('Pick a group', 'Choose which of your communities this is for.');
      }
      // "ok do it" (CLAUDE.md): for a business destination, "Involve" is
      // no longer the wizard's final step -- "Options" still follows it,
      // so just advance like any other step. Every other destination
      // (gathering/custom) keeps its original behavior: this IS the final
      // step, so hand off to the real destination screen now.
      if (destination === 'business') {
        Haptics.selectionAsync();
        return setStep((s) => Math.min(s + 1, stepDefs.length - 1));
      }
      return proceedToDestination();
    }
    Haptics.selectionAsync();
    setStep((s) => Math.min(s + 1, stepDefs.length - 1));
  }

  function goBack() {
    if (step === 0) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    setStep((s) => Math.max(s - 1, 0));
  }

  async function proceedToDestination() {
    const trimmedName = whoForName.trim() || null;
    const title = composeCelebrationTitle({ occasion, whoFor, whoForName: trimmedName });
    const askText = composeCelebrationAskText({ occasion, whoFor, whoForName: trimmedName, activityType });
    const visibility = resolveCelebrationVisibility({ activityType, whoInvolved });
    const destination = resolveCelebrationDestination(activityType);

    // Awaited (not fire-and-forget) only so the real created occasion's id
    // is available to link once CreateGathering's own creation succeeds --
    // still never blocks or fails the real navigation below on its own
    // failure (this repo's own "no dead ends" spirit run in reverse: an
    // optional extra never becomes a required gate either).
    let savedOccasionId = null;
    if (saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId)) {
      const saveResult = await addOccasion(buildOccasionSaveParams({
        occasion, title, scheduledAt, connectedUserId: shareOccasionWithFriend ? whoForFriendId : null, whoForName: trimmedName, whoForFriendId, surpriseMode,
      })).catch(() => null);
      savedOccasionId = saveResult?.data?.id ?? null;
    }

    if (destination === 'gathering') {
      const params = { quickStartTitle: title, initialVisibility: visibility };
      if (visibility === 'community' && communityId) params.initialCommunityId = communityId;
      if (whenPreset) {
        params.quickStartWhenPreset = whenPreset;
        if (whenPreset === 'custom') params.quickStartWhenISO = scheduledAt.toISOString();
      }
      // "Occasion architecture should not be a silo": lets
      // CreateGatheringScreen link the real gathering it creates back to
      // whichever Occasion/group plan sent it here.
      if (groupPlanId) params.linkOccasionGroupPlanId = groupPlanId;
      if (savedOccasionId) params.linkOccasionId = savedOccasionId;
      // Item 71 (CLAUDE.md): carries the who_involved step's own
      // suggested-invitee selections through so GatheringConfirmationScreen
      // can surface them as a real, pre-highlighted (never auto-sent)
      // suggestion once the gathering exists -- the organizer still taps
      // "Invite" per person there, same as any other invite.
      if (selectedInviteeIds.size > 0) {
        params.suggestedInviteeIds = Array.from(selectedInviteeIds);
        params.suggestedInviteeLabel = possessiveFriendsLabel(whoForName);
      }
      navigation.navigate('CreateGathering', params);
      return;
    }

    if (destination === 'business') {
      // Item 69 (CLAUDE.md): default the business-facing prefill to the
      // name-free variant -- still a fully editable field on
      // AskBusinessScreen, but the safe default should never require the
      // user to notice and manually strip a name before it reaches a
      // business. `askText` (with the name) stays reserved for the
      // 'custom' destination below, which hands off to a free-text box
      // with no fixed destination yet, not a business directly.
      const businessSafeAskText = composeCelebrationAskTextForBusiness({ occasion, activityType });
      const params = { prefillText: businessSafeAskText, prefillOccasion: occasion };
      const categoryHint = celebrationCategoryHint(activityType);
      if (categoryHint) params.prefillCategory = categoryHint;
      if (partySize) params.prefillPartySize = partySize;
      // Item 94: AskBusinessScreen's own budget field is a ceiling too now
      // (never a floor), so the resolved max carries straight across.
      const resolvedBudgetMax = resolveBudgetMax(budgetRangeKey, budgetMaxOverride);
      if (resolvedBudgetMax) params.prefillBudgetMax = resolvedBudgetMax;
      // Item 95: carries the wizard's own real experience-level answer
      // through the "Skip -- post manually" escape hatch too, same as
      // budget just above.
      params.prefillExperienceLevel = experienceLevel;
      // Item 96 ("Add surprise mode"): a surprise ask must stay a surprise
      // even when the user skips straight to AskBusinessScreen -- the
      // business still needs to know.
      if (surpriseMode) params.prefillSurpriseMode = true;
      if (whenPreset === 'now' || whenPreset === 'tonight') {
        params.prefillDateWindow = 'today';
      } else if (whenPreset === 'tomorrow') {
        params.prefillDateWindow = 'tomorrow';
      } else if (whenPreset === 'custom') {
        params.prefillDateWindow = PICK_DATE_KEY;
        params.prefillPickedDateISO = scheduledAt.toISOString().slice(0, 10);
      }
      // "ok do it" (CLAUDE.md): the "Skip -- post manually" escape hatch
      // reaches this branch too, and "Involve" already happened before it
      // (same step order as the main submit path now) -- carry the real
      // selection through AskBusinessScreen so it still reaches the
      // resulting request's own "Invite Someone" panel, same as the main
      // submit path just below.
      if (selectedInviteeIds.size > 0) {
        params.suggestedInviteeIds = Array.from(selectedInviteeIds);
        params.suggestedInviteeLabel = possessiveFriendsLabel(whoForName);
      }
      navigation.navigate('AskBusiness', params);
      return;
    }

    // 'custom' -- no structured destination; hand off to CreateHubScreen's
    // own existing free-text AI-classification box, pre-typed only, never
    // auto-submitted (this repo's own "AI suggests, never silently commits"
    // rule).
    navigation.navigate('Create', { prefillSomethingElseText: askText });
  }

  const finalStep = step === stepDefs.length - 1;

  // A real gathering candidate (assembleExperience() can bucket one into a
  // component alongside business_availability, e.g. a live-music gathering
  // filling "Something Fun") can't be requested from a business -- it's
  // already a real, already-happening thing, so it renders as a plain
  // tap-to-view row instead of a selectable checkbox.
  // Item 112 follow-up (CLAUDE.md, "the final options settle into place"):
  // `index` (optional, defaults to 0 for any caller that doesn't care)
  // drives StaggeredReveal's per-card entrance delay -- real content
  // fetched once, revealed in a small cascade rather than dumped in all at
  // once.
  function renderOptionCard(item, index = 0) {
    // Item 125 ("Make 'Nearby found this for you' visually recognizable"): the single real
    // top-scored item of an already relevance-sorted list gets the "✨ Nearby Pick" badge --
    // index === 0 only. Never on a bundle (it already has its own "✨ One place has it all"
    // section heading above it -- a second ✨ right below would be redundant, not clarifying).
    const isBundle = Array.isArray(item.componentLabels);
    const isTopPick = index === 0 && !isBundle;
    if (item.type === 'gathering') {
      return (
        <StaggeredReveal key={`gathering-${item.id}`} index={index}>
          <TouchableOpacity
            style={styles.optionCard}
            onPress={() => navigation.navigate('GatheringDetail', { gatheringId: item.id })}
            activeOpacity={0.85}
            accessibilityLabel={item.title}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              {isTopPick && <NearbyPickBadge />}
              <Text style={styles.optionTitle}>🎊 {item.title}</Text>
              {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
              <Text style={styles.optionHint}>Already happening — tap to view</Text>
            </View>
          </TouchableOpacity>
        </StaggeredReveal>
      );
    }
    const selected = selectedIds.has(item.id);
    return (
      <StaggeredReveal key={`business-${item.id}`} index={index}>
        <TouchableOpacity
          style={[styles.optionCard, selected && styles.optionCardSelected]}
          onPress={() => toggleSelected(item)}
          activeOpacity={0.85}
          accessibilityLabel={item.title}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
        >
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            {selected && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            {isTopPick && <NearbyPickBadge />}
            <Text style={styles.optionTitle}>{item.title}</Text>
            {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
            {isBundle && <Text style={styles.optionHint}>Covers: {item.componentLabels.join(', ')}</Text>}
          </View>
        </TouchableOpacity>
      </StaggeredReveal>
    );
  }

  // Item 74: a plain tap-to-view/tap-to-request row for a real
  // runIntentSearch() result -- unlike renderOptionCard's multi-select
  // checkboxes (built for the structured business-destined activity path's
  // own "Ask These Businesses" batch submit), a Custom Occasion result can
  // be any real type (gathering/business_availability/perk/community/
  // friend_discovery), so tapping always just navigates there directly via
  // navigateToIntentResultItem -- the same one-tap-and-you're-there
  // behavior Home's ask box and Discover's search already give the exact
  // same result shapes.
  function renderCustomResultRow(item) {
    return (
      <TouchableOpacity
        key={`${item.type}-${item.id}`}
        style={styles.optionCard}
        onPress={() => handleCustomResultTap(item)}
        activeOpacity={0.85}
        accessibilityLabel={item.title}
        accessibilityRole="button"
      >
        <Text style={{ fontSize: 18 }}>{INTENT_SEARCH_TYPE_EMOJI[item.type] ?? '📌'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            <Text style={styles.header} accessibilityRole="header">🎉 Plan for Someone</Text>
            <Text style={styles.subheader}>Let's turn this into a real plan.</Text>

            <View style={styles.progressRow} accessibilityLabel={`Step ${step + 1} of ${stepDefs.length}: ${stepDefs[step].label}`}>
              {stepDefs.map((s, i) => (
                <View key={s.key} style={styles.progressStep}>
                  <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{s.label}</Text>
                </View>
              ))}
            </View>

            {/* Item 84 (CLAUDE.md, "make the UI feel emotionally different"):
                a real, live preview of what's actually being planned --
                "🎂 Sarah's Birthday" instead of a plain "Saturday Dinner" --
                threaded through every step from here on as the wizard's one
                consistent, subtle "this is special" signal. Deliberately a
                warm amber tint, never colors.primary (coral) -- this is
                purely informational, not a tappable action, and this
                repo's own locked visual system reserves coral for that
                (CLAUDE.md, Standing Conventions). Excluded for occasion
                === 'other' -- Item 74's Custom Occasion path is a wholly
                different, more open-ended flow with its own framing, and
                a generic "A Celebration ✨" preview would add noise there,
                not personality. */}
            {occasion && occasion !== 'other' && (
              <View style={styles.occasionPreviewBanner}>
                <Text style={styles.occasionPreviewText} numberOfLines={1}>
                  {composeCelebrationTitle({ occasion, whoFor, whoForName: whoForName.trim() || null })}
                </Text>
              </View>
            )}

            {stepKey === 'occasion' && (
              <>
                {/* Item 86 (CLAUDE.md, "Let Nearby start from the person,
                    not just the occasion"): a real deep link into this
                    wizard (e.g. ViewProfileScreen's "Celebrate {name}")
                    can pre-seed who_for without pre-seeding an occasion --
                    "the user's relationship with the person becomes the
                    starting point." When that's true, whoForName is
                    already real at this very first step, so the header
                    speaks to it directly instead of the generic question. */}
                <Text style={styles.label}>
                  {whoForName.trim() ? `What are you planning for ${whoForName.trim()}?` : 'What are you planning?'}
                </Text>
                {/* Item 83 ("Plan for Someone", CLAUDE.md): a real, fast
                    front door -- "the most understandable/high-frequency
                    entry points, not the entire underlying occasion
                    system." 'surprise' is a pseudo-tile: it sets
                    occasion='celebration' and turns on Item 65's real
                    surprise_mode, rather than inventing a new occasion
                    value for what's actually a privacy mode. Every tile
                    (including Custom, occasion='other') feeds the exact
                    same `occasion` state and downstream pipeline the full
                    grouped list below does. */}
                <View style={styles.chipRow}>
                  {QUICK_OCCASION_TILES.map((tile) => {
                    const selected = tile.key === 'surprise'
                      ? occasion === 'celebration' && surpriseMode
                      : occasion === tile.key;
                    return (
                      <TouchableOpacity
                        key={tile.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          if (tile.key === 'surprise') {
                            setOccasion('celebration');
                            if (!surpriseMode) setSurpriseModeOn(true);
                          } else {
                            setOccasion(tile.key);
                          }
                          // Item 112: keyed on the TILE itself, not the
                          // resulting occasion -- 'surprise' plays its own
                          // lock animation even though it also sets
                          // occasion='celebration' under the hood.
                          if (OCCASION_SELECT_ANIMATIONS[tile.key]) setOccasionAnimTrigger(tile.key);
                        }}
                        activeOpacity={0.85}
                        accessibilityLabel={tile.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tile.icon} {tile.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Item 112 (CLAUDE.md, "We should have animations for
                    that too... purposeful and contextual, not generic
                    animations everywhere"): a small, self-dismissing
                    micro-celebration for exactly the 5 occasions the user
                    named -- rendered once, right below whichever picker
                    (quick tiles or the full grouped list) the user just
                    used. `key` forces a clean remount if a second
                    selection lands before the first animation finishes. */}
                {occasionAnimTrigger && (
                  <OccasionAnimation
                    key={occasionAnimTrigger}
                    triggerKey={occasionAnimTrigger}
                    onDone={() => setOccasionAnimTrigger(null)}
                  />
                )}

                {!showMoreOccasions && (
                  <TouchableOpacity
                    onPress={() => setShowMoreOccasions(true)}
                    style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
                    accessibilityLabel="More occasions"
                    accessibilityRole="button"
                  >
                    <Text style={styles.createOwnLinkText}>More occasions →</Text>
                  </TouchableOpacity>
                )}

                {/* Item 73 (CLAUDE.md): "have the category architecture
                    flexible enough for ... don't hard-code the product
                    around birthdays" -- real grouped sections
                    (Celebrations/Milestones/Social Moments/Custom)
                    instead of one long flat chip row, so the vocabulary
                    can keep growing without reading as "birthday, plus an
                    ever-longer afterthought list." Item 83: this full list
                    is preserved exactly as-is, just moved behind the
                    "More occasions" reveal above -- "don't sacrifice the
                    existing 24-value capability just to make the first
                    screen simpler" (the user's own words). */}
                {showMoreOccasions && (
                  <>
                    <Text style={[styles.sublabel, { marginTop: spacing.xs }]}>More Occasions</Text>
                    {occasionGroupOptions().map((group) => (
                      <View key={group.key} style={{ marginBottom: spacing.md }}>
                        <Text style={styles.sublabel}>{group.label}</Text>
                        <View style={styles.chipRow}>
                          {group.options.map((o) => {
                            const selected = occasion === o.key;
                            return (
                              <TouchableOpacity
                                key={o.key}
                                style={[styles.chip, selected && styles.chipSelected]}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setOccasion(o.key);
                                  // Item 112: Graduation lives only in this
                                  // full list, never a quick tile -- same
                                  // trigger lookup as the tiles above, so
                                  // it plays here too.
                                  if (OCCASION_SELECT_ANIMATIONS[o.key]) setOccasionAnimTrigger(o.key);
                                }}
                                activeOpacity={0.85}
                                accessibilityLabel={o.label}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}

            {/* Item 74 (CLAUDE.md): "Custom Occasion" is important -- "my
                dad is visiting from out of town" isn't a standard life
                event, so instead of forcing who/what/when questions on it,
                one open-ended description is classified + resolved
                directly (runIntentSearch(), the same pipeline Home's ask
                box and Discover's search already use). "Nearby then
                understands the intent and starts building options" per the
                user's own framing -- this renders real matching results
                inline, the same "no dead ends" escape hatches (Ask Nearby
                Businesses / Create it yourself) every other empty/unclear
                intent result in this app already offers. */}
            {stepKey === 'custom_describe' && (
              <>
                <Text style={styles.label}>What are you planning?</Text>
                <Text style={styles.helperText}>
                  Describe it in your own words — Nearby will figure out how to help.
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="e.g. Dad's visiting — want to take him somewhere special."
                  placeholderTextColor={colors.textTertiary}
                  value={customDescription}
                  onChangeText={(t) => {
                    setCustomDescription(t);
                    if (customSearchResult) setCustomSearchResult(null);
                  }}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  accessibilityLabel="What are you planning?"
                />

                {customSearching && (
                  <View style={styles.customSearchLoadingRow}>
                    <NLoader fullScreen={false} size="inline" caption={intentPhaseCaption(customPhase?.phase ?? 'understanding', customPhase?.classifyResult)} />
                  </View>
                )}

                {customSearchResult && !customSearching && (
                  <View style={styles.customResultsBlock}>
                    {customSearchResult.items.length > 0 ? (
                      <>
                        <FoundLine />
                        <Text style={styles.sublabel}>
                          {customSearchResult.experience?.title ?? intentSearchFallbackTitle(customSearchResult.classifyResult)}
                        </Text>
                        {(customSearchResult.experience?.bundles ?? []).map((bundle) => (
                          <View key={bundle.id} style={{ marginBottom: spacing.sm }}>
                            <Text style={styles.optionHint}>✨ One place has it all: {bundle.componentLabels.join(' + ')}</Text>
                            {renderCustomResultRow(bundle)}
                          </View>
                        ))}
                        {customSearchResult.experience
                          ? (
                            <ExperienceComponentList
                              experience={customSearchResult.experience}
                              renderItem={renderCustomResultRow}
                              navigation={navigation}
                              partySize={customSearchResult.classifyResult?.partySize ?? null}
                              labelStyle={styles.optionHint}
                            />
                          )
                          : customSearchResult.items.map(renderCustomResultRow)}
                      </>
                    ) : (
                      <Text style={styles.helperText}>Nothing already out there matches yet — but Nearby can still help.</Text>
                    )}
                    <TouchableOpacity
                      style={[styles.askBusinessButton, { marginTop: spacing.md }]}
                      onPress={goAskBusinessFromCustom}
                      activeOpacity={0.85}
                      accessibilityLabel="Ask Nearby Businesses"
                      accessibilityRole="button"
                    >
                      <Text style={styles.askBusinessButtonText}>🏪 Ask Nearby Businesses</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={proceedToCustomCreation}
                      style={{ marginTop: spacing.sm }}
                      accessibilityLabel="None of these? Create it yourself"
                      accessibilityRole="button"
                    >
                      <Text style={styles.createOwnLinkText}>None of these? Create it yourself →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setCustomSearchResult(null)}
                      style={{ marginTop: spacing.xs }}
                      accessibilityLabel="Try a different description"
                      accessibilityRole="button"
                    >
                      <Text style={styles.skipRowText}>← Try a different description</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {stepKey === 'who_for' && (
              <>
                <Text style={styles.label}>Who is this for?</Text>
                <View style={styles.chipRow}>
                  {WHO_FOR_OPTIONS.map((o) => {
                    const selected = whoFor === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhoFor(o.key)}
                        activeOpacity={0.85}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {whoFor && whoFor !== 'me' && (
                  <>
                    {loadingFriends && <NLoader fullScreen={false} size="inline" caption="Loading friends…" />}
                    {!loadingFriends && friends.length > 0 && (
                      <>
                        <Text style={styles.sublabel}>Pick a real friend (optional)</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                          {friends.map((f) => {
                            const selected = whoForName === f.display_name;
                            return (
                              <TouchableOpacity
                                key={f.id}
                                style={[styles.chip, selected && styles.chipSelected]}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setWhoForName(selected ? '' : f.display_name);
                                  setWhoForFriendId(selected ? null : f.id);
                                  setSurpriseMode(false);
                                  setShareOccasionWithFriend(false);
                                }}
                                activeOpacity={0.85}
                                accessibilityLabel={f.display_name}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.display_name}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </>
                    )}
                    <Text style={styles.sublabel}>Or type a name (optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Sarah"
                      placeholderTextColor={colors.textTertiary}
                      value={whoForName}
                      onChangeText={(t) => {
                        setWhoForName(t);
                        setWhoForFriendId(null);
                        setSurpriseMode(false);
                        setShareOccasionWithFriend(false);
                      }}
                      accessibilityLabel="Name (optional)"
                    />

                    {whoForFriendId && (
                      <TouchableOpacity
                        style={styles.calendarToggleRow}
                        onPress={() => setSurpriseModeOn(!surpriseMode)}
                        activeOpacity={0.85}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: surpriseMode }}
                        accessibilityLabel={`Surprise mode — keep this hidden from ${whoForName}`}
                      >
                        <View style={[styles.checkbox, surpriseMode && styles.checkboxChecked]}>
                          {surpriseMode && <Text style={styles.checkboxMark}>✓</Text>}
                        </View>
                        <Text style={styles.calendarToggleText}>
                          🔒 Surprise mode — keep this hidden from {whoForName}. Invited friends can still help plan; {whoForName} won't be invited or notified.
                        </Text>
                      </TouchableOpacity>
                    )}

                    {whoForFriendId && (
                      <View style={{ marginTop: spacing.md }}>
                        <TouchableOpacity
                          onPress={() => setAskPollExpanded((v) => !v)}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={`Ask ${whoForName} a quick question`}
                        >
                          <Text style={styles.expandLinkText}>
                            {askPollExpanded ? '▾' : '▸'} 💬 Ask {whoForName} a quick question
                          </Text>
                        </TouchableOpacity>
                        {askPollExpanded && (
                          <View style={styles.expandPanel}>
                            <Text style={styles.helperText}>
                              A plain question, never mentioning this occasion — {whoForName} never sees why you asked.
                            </Text>
                            {PREFERENCE_POLL_QUESTIONS.map((q) => {
                              const alreadyAsked = askedPollKeys.has(q.key);
                              return (
                                <TouchableOpacity
                                  key={q.key}
                                  style={[styles.chip, { marginTop: spacing.xs, alignSelf: 'flex-start' }, alreadyAsked && styles.chipDisabled]}
                                  onPress={() => handleSendPreferencePoll(q.key)}
                                  disabled={alreadyAsked || askPollSending}
                                  activeOpacity={0.85}
                                  accessibilityLabel={q.questionText}
                                  accessibilityRole="button"
                                >
                                  <Text style={styles.chipText}>
                                    {alreadyAsked ? `⏳ Asked: "${q.questionText}" — waiting for a reply` : `“${q.questionText}”`}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            {stepKey === 'activity' && (
              <>
                <Text style={styles.label}>What would you like to do?</Text>
                <View style={styles.chipRow}>
                  {ACTIVITY_OPTIONS.map((o) => {
                    const selected = activityType === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setActivityType(o.key); }}
                        activeOpacity={0.85}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.sublabel}>Not sure yet? Let the group decide together.</Text>
                <View style={styles.chipRow}>
                  {(() => {
                    const selected = activityType === GROUP_VOTE_OPTION.key;
                    return (
                      <TouchableOpacity
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setActivityType(GROUP_VOTE_OPTION.key); setPartySize(null); }}
                        activeOpacity={0.85}
                        accessibilityLabel={GROUP_VOTE_OPTION.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{GROUP_VOTE_OPTION.icon} {GROUP_VOTE_OPTION.label}</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                {/* Item 111 ("We'll plan it for you" -- CLAUDE.md): don't
                    know what to do at all? Skip picking Dinner/Night Out/
                    Activity yourself -- Nearby proposes a real, priced
                    multi-part plan from the occasion alone. Only offered
                    when this occasion actually has a template to build
                    from. */}
                {!!experienceTemplateForOccasion(occasion) && (
                  <>
                    <Text style={styles.sublabel}>Don't know what to do? Let Nearby plan it.</Text>
                    <View style={styles.chipRow}>
                      {(() => {
                        const selected = activityType === AUTO_PLAN_OPTION.key;
                        return (
                          <TouchableOpacity
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => { Haptics.selectionAsync(); setActivityType(AUTO_PLAN_OPTION.key); }}
                            activeOpacity={0.85}
                            accessibilityLabel={AUTO_PLAN_OPTION.label}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{AUTO_PLAN_OPTION.icon} {AUTO_PLAN_OPTION.label}</Text>
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                  </>
                )}

                {activityType !== GROUP_VOTE_OPTION.key && (
                  <>
                    <Text style={styles.sublabel}>How many people? (optional)</Text>
                    <View style={styles.chipRow}>
                      {PARTY_SIZE_OPTIONS.map((n, i) => {
                        const selected = partySize === n;
                        const label = i === PARTY_SIZE_OPTIONS.length - 1 ? `${n}+` : String(n);
                        return (
                          <TouchableOpacity
                            key={n}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => { Haptics.selectionAsync(); setPartySize(selected ? null : n); }}
                            activeOpacity={0.85}
                            accessibilityLabel={`${label} people`}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
              </>
            )}

            {stepKey === 'when' && (
              <>
                <Text style={styles.label}>When?</Text>
                <View style={styles.chipRow}>
                  {WHEN_PRESETS.map((p) => {
                    const selected = whenPreset === p.key;
                    return (
                      <TouchableOpacity
                        key={p.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhenPreset(p.key)}
                        activeOpacity={0.85}
                        accessibilityLabel={p.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{p.icon} {p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {whenPreset && (
                  <TouchableOpacity style={styles.dateDisplay} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel="Change date and time">
                    <Text style={styles.dateDisplayText}>
                      {scheduledAt.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={scheduledAt}
                    mode="datetime"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant={colors.background === '#000000' || colors.background === '#0a0a0a' ? 'dark' : 'light'}
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(Platform.OS === 'ios');
                      if (selectedDate) {
                        setScheduledAt(selectedDate);
                        setWhenPreset('custom');
                      }
                    }}
                  />
                )}

                {destination === 'business' && (
                  <>
                    {/* Item 111 ("We'll plan it for you" -- CLAUDE.md): the
                        mock's own "Budget: $$" input was already fully
                        built (BUDGET_LEVEL_OPTIONS, Item 94) but only ever
                        rendered on the group-vote path's own 'group_invite'
                        step -- every solo business-destined path (Dinner/
                        Night Out/Activity/the new auto_plan) silently never
                        asked at all, leaving resolveBudgetMax() permanently
                        at its unset default there. Same chip row, same
                        override field, duplicated here rather than
                        extracted -- matches this step's own existing
                        precedent of duplicating EXPERIENCE_LEVEL_OPTIONS
                        between this step and 'group_invite' just below. */}
                    <Text style={[styles.label, { marginTop: spacing.lg }]}>What's your budget?</Text>
                    <Text style={styles.helperText}>A rough feel helps Nearby find realistic options.</Text>
                    <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                      {BUDGET_LEVEL_OPTIONS.map((o) => {
                        const selected = budgetRangeKey === o.key;
                        return (
                          <TouchableOpacity
                            key={o.key}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => { Haptics.selectionAsync(); setBudgetRangeKey(o.key); }}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={o.label}
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {showBudgetMaxOverride ? (
                      <TextInput
                        style={[styles.input, { marginTop: spacing.sm }]}
                        placeholder="Maximum per person (optional)"
                        placeholderTextColor={colors.textTertiary}
                        value={budgetMaxOverride}
                        onChangeText={setBudgetMaxOverride}
                        keyboardType="number-pad"
                        accessibilityLabel="Maximum budget per person, optional"
                      />
                    ) : (
                      <TouchableOpacity
                        onPress={() => setShowBudgetMaxOverride(true)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Set a maximum per person"
                        style={{ marginTop: spacing.sm }}
                      >
                        <Text style={styles.createOwnLinkText}>+ Set a maximum per person</Text>
                      </TouchableOpacity>
                    )}

                    <Text style={[styles.label, { marginTop: spacing.lg }]}>What kind of experience are you looking for?</Text>
                    <Text style={styles.helperText}>A birthday dinner doesn't need the same options as a 50th anniversary — this helps Nearby adjust what it finds.</Text>
                    <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                      {EXPERIENCE_LEVEL_OPTIONS.map((o) => {
                        const selected = experienceLevel === o.key;
                        return (
                          <TouchableOpacity
                            key={o.key}
                            style={[styles.chip, selected && styles.chipSelected]}
                            onPress={() => { Haptics.selectionAsync(); setExperienceLevel(o.key); }}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={o.label}
                            accessibilityState={{ selected }}
                          >
                            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {shouldOfferCalendarSave(occasion, !!whoForFriendId) && (
                  <TouchableOpacity
                    style={styles.calendarToggleRow}
                    onPress={() => { Haptics.selectionAsync(); setSaveToCalendar((v) => !v); }}
                    activeOpacity={0.85}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: saveToCalendar }}
                    accessibilityLabel="Also save to your Occasions calendar"
                  >
                    <View style={[styles.checkbox, saveToCalendar && styles.checkboxChecked]}>
                      {saveToCalendar && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                    <Text style={styles.calendarToggleText}>🗓️ Also save this to your Occasions calendar</Text>
                  </TouchableOpacity>
                )}

                {saveToCalendar && shouldOfferCalendarSave(occasion, !!whoForFriendId) && whoForFriendId && (
                  surpriseMode ? (
                    <Text style={styles.helperText}>🔒 Surprise mode is on — this won't be shared with {whoForName}.</Text>
                  ) : (
                    <TouchableOpacity
                      style={styles.calendarToggleRow}
                      onPress={() => { Haptics.selectionAsync(); setShareOccasionWithFriend((v) => !v); }}
                      activeOpacity={0.85}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: shareOccasionWithFriend }}
                      accessibilityLabel={`Also share this with ${whoForName || 'them'}`}
                    >
                      <View style={[styles.checkbox, shareOccasionWithFriend && styles.checkboxChecked]}>
                        {shareOccasionWithFriend && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={styles.calendarToggleText}>
                        👀 Also share this with {whoForName || 'them'} — they'll see it on their own Occasions page too
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </>
            )}

            {stepKey === 'options' && activityType === AUTO_PLAN_OPTION.key && !autoPlanExpanded && (
              <>
                <Text style={styles.label}>✨ Here's what we'd do</Text>
                {optionsLoading && <FindingOptionsLoader />}
                {!optionsLoading && optionsFetched && (
                  autoPlanSuggestion.items.length === 0 && autoPlanSuggestion.suggestions.length === 0 ? (
                    <Text style={styles.helperText}>
                      Nothing live nearby right now — no worries, you can still post a request and businesses will respond.
                    </Text>
                  ) : (
                    <>
                      {autoPlanSuggestion.items.map((item, i) => (
                        <StaggeredReveal key={item.key} index={i}>
                          <View style={styles.autoPlanRow}>
                            <Text style={styles.autoPlanRowLabel}>{item.label}</Text>
                            <Text style={styles.autoPlanRowDetail}>
                              {item.businessName}{item.price != null ? ` · ${moneyLabel(item.price)}` : ' · price varies'}
                            </Text>
                          </View>
                        </StaggeredReveal>
                      ))}
                      {autoPlanSuggestion.suggestions.map((s, i) => {
                        const included = autoPlanAddonTypes.has(s.type);
                        return (
                          <StaggeredReveal key={s.type} index={autoPlanSuggestion.items.length + i}>
                            <TouchableOpacity
                              style={styles.autoPlanRow}
                              onPress={() => toggleAutoPlanAddonType(s.type)}
                              activeOpacity={0.85}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: included }}
                              accessibilityLabel={`${s.label}, ${included ? 'included' : 'not included'}`}
                            >
                              <Text style={[styles.autoPlanRowLabel, !included && styles.autoPlanRowLabelMuted]}>
                                {included ? '✓ ' : ''}{s.icon} {s.label}
                              </Text>
                              <Text style={styles.autoPlanRowDetail}>{included ? 'Added to your plan' : 'Tap to add'}</Text>
                            </TouchableOpacity>
                          </StaggeredReveal>
                        );
                      })}
                      {autoPlanSuggestion.items.length > 0 && (
                        <Text style={styles.autoPlanTotal}>
                          Estimated total: ${autoPlanSuggestion.estimatedTotal}{autoPlanSuggestion.hasUnknownPrice ? '+' : ''}
                        </Text>
                      )}
                    </>
                  )
                )}
              </>
            )}

            {stepKey === 'options' && !(activityType === AUTO_PLAN_OPTION.key && !autoPlanExpanded) && (
              <>
                <Text style={styles.label}>Nearby found these options</Text>
                {optionsLoading && <FindingOptionsLoader />}
                {!optionsLoading && optionsResult && (
                  <>
                    {optionsResult.experience ? (
                      <>
                        {optionsResult.experience.bundles.length > 0 && (
                          <View style={{ marginBottom: spacing.md }}>
                            <Text style={styles.sublabel}>✨ One place has it all</Text>
                            {optionsResult.experience.bundles.map((item, i) => renderOptionCard(item, i))}
                          </View>
                        )}
                        {optionsResult.experience.components.map((comp) => (
                          <View key={comp.key} style={{ marginBottom: spacing.md }}>
                            <Text style={styles.sublabel}>{comp.label}</Text>
                            {comp.items.map((item, i) => (<React.Fragment key={`${item.type}-${item.id}`}>{renderOptionCard(item, i)}<ExperiencePerkLine item={item} /></React.Fragment>))}
                          </View>
                        ))}
                      </>
                    ) : optionsResult.items.some((i) => i.type === 'business_availability') ? (
                      <View style={{ marginBottom: spacing.md }}>
                        <Text style={styles.sublabel}>🍽️ Nearby options</Text>
                        {optionsResult.items
                          .filter((i) => i.type === 'business_availability')
                          .slice(0, 5)
                          .map((item, i) => renderOptionCard(item, i))}
                      </View>
                    ) : null}
                    {optionsResult.items.some((i) => i.type === 'business_occasion_package') && (
                      // Item 68 (CLAUDE.md): a business's own durable,
                      // named occasion package -- shown as its own section
                      // regardless of whether an Experience also assembled,
                      // since packages are never fed into that bundling.
                      <View style={{ marginBottom: spacing.md }}>
                        <Text style={styles.sublabel}>🎁 Occasion Packages</Text>
                        {optionsResult.items
                          .filter((i) => i.type === 'business_occasion_package')
                          .slice(0, 5)
                          .map((item, i) => renderOptionCard(item, i))}
                      </View>
                    )}
                    {!optionsResult.experience &&
                      !optionsResult.items.some((i) => i.type === 'business_availability') &&
                      !optionsResult.items.some((i) => i.type === 'business_occasion_package') && (
                        <Text style={styles.helperText}>
                          Nothing live nearby right now — no worries, you can still post a request and businesses will respond.
                        </Text>
                      )}
                  </>
                )}
                {/* Item 111: a quiet reminder of what "Let Nearby Plan It"
                    also carries into this submission -- the accepted
                    add-on-type suggestions from the summary, which don't
                    appear as checkable candidates here since they have no
                    specific business/price of their own yet. */}
                {activityType === AUTO_PLAN_OPTION.key && autoPlanAddonTypes.size > 0 && (
                  <Text style={[styles.helperText, { marginTop: spacing.sm }]}>
                    + We'll also request: {autoPlanSuggestion.suggestions.filter((s) => autoPlanAddonTypes.has(s.type)).map((s) => `${s.icon} ${s.label}`).join(', ')}
                  </Text>
                )}
              </>
            )}

            {stepKey === 'who_involved' && (
              <>
                <Text style={styles.label}>Who should be involved?</Text>
                <View style={styles.chipRow}>
                  {/* "ok do it" (CLAUDE.md): "Existing Group" maps to a real
                      community, which only makes sense for the gathering
                      destination (resolveCelebrationVisibility's own
                      community branch) -- a business_requests row has no
                      community concept at all, so it's dropped here rather
                      than offering a chip that would silently do nothing. */}
                  {(destination === 'business' ? WHO_INVOLVED_OPTIONS.filter((o) => o.key !== 'existing_group') : WHO_INVOLVED_OPTIONS).map((o) => {
                    const selected = whoInvolved === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => pickWhoInvolved(o.key)}
                        activeOpacity={0.85}
                        accessibilityLabel={o.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {whoInvolved === 'existing_group' && (
                  <>
                    {loadingCommunities && <NLoader fullScreen={false} size="inline" caption="Loading communities…" />}
                    {!loadingCommunities && communities.length === 0 && communitiesLoaded && (
                      <Text style={styles.helperText}>You're not a member of any active community yet — pick a different option above.</Text>
                    )}
                    {!loadingCommunities && communities.length > 0 && (
                      <View style={styles.chipRow}>
                        {communities.map((c) => {
                          const selected = communityId === c.id;
                          return (
                            <TouchableOpacity
                              key={c.id}
                              style={[styles.chip, selected && styles.chipSelected]}
                              onPress={() => { Haptics.selectionAsync(); setCommunityId(c.id); }}
                              activeOpacity={0.85}
                              accessibilityLabel={c.name}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}

                {(whoInvolved === 'friends' || whoInvolved === 'family' || whoInvolved === 'invite_specific') && (
                  <>
                    {/* Item 71 (CLAUDE.md): "Occasions can automatically
                        suggest people" -- real, existing mutual friends
                        between the organizer and whoForFriendId (already
                        loaded via ensureFriendsLoaded/get_mutual_friends,
                        the same infrastructure Item 63 built for the
                        group-vote invite step), surfaced here as an
                        explicit suggestion. A tap only ever adds a friend
                        to selectedInviteeIds -- nothing is invited yet;
                        the actual send still requires the organizer's own
                        explicit tap on GatheringConfirmationScreen's real
                        per-friend "Invite" button once the gathering
                        exists. Never shown for a stranger the organizer
                        isn't already connected to (no whoForFriendId, or
                        zero real mutual friends) -- this repo's own
                        no-stranger-discovery rule. */}
                    {whoForFriendId && mutualFriendIds.size > 0 && (
                      <>
                        <Text style={[styles.label, { marginTop: spacing.lg }]}>People you may want to invite</Text>
                        <Text style={styles.helperText}>
                          {possessiveFriendsLabel(whoForName) ?? 'Friends you both know'} — just suggestions, you decide who to invite.
                        </Text>
                        <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                          {friends.filter((f) => mutualFriendIds.has(f.id)).map((f) => {
                            const selected = selectedInviteeIds.has(f.id);
                            return (
                              <TouchableOpacity
                                key={f.id}
                                style={[styles.chip, selected && styles.chipSelected]}
                                onPress={() => toggleInvitee(f.id)}
                                activeOpacity={0.85}
                                accessibilityLabel={f.display_name}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                  {selected ? '✓ ' : ''}🤝 {f.display_name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                    <Text style={[styles.helperText, { marginTop: spacing.md }]}>
                      We'll take you to your new plan — from there, "Invite Friends" lets you pick exactly who should know.
                    </Text>
                  </>
                )}
              </>
            )}

            {stepKey === 'group_invite' && (
              <>
                <Text style={styles.label}>Who should help decide?</Text>
                <Text style={styles.helperText}>
                  Invite real friends to propose ideas and vote — once you pick the winner, Nearby turns it into a real plan.
                </Text>
                {surpriseMode && (
                  <Text style={styles.helperText}>🔒 Surprise mode is on — {whoForName} won't appear in this list or be notified.</Text>
                )}
                {loadingFriends && <NLoader fullScreen={false} size="inline" caption="Loading friends…" />}
                {!loadingFriends && friendsLoaded && friends.filter((f) => !(surpriseMode && f.id === whoForFriendId)).length === 0 && (
                  <Text style={styles.helperText}>You don't have any friends connected yet to invite.</Text>
                )}
                {!loadingFriends && friends.filter((f) => !(surpriseMode && f.id === whoForFriendId)).length > 0 && (
                  <>
                    {mutualFriendIds.size > 0 && whoForName && (
                      <Text style={styles.helperText}>🤝 marks a friend you both know — a good place to start.</Text>
                    )}
                    <View style={[styles.chipRow, { marginTop: spacing.md }]}>
                      {friends
                        .filter((f) => !(surpriseMode && f.id === whoForFriendId))
                        .sort((a, b) => (mutualFriendIds.has(b.id) ? 1 : 0) - (mutualFriendIds.has(a.id) ? 1 : 0))
                        .map((f) => {
                          const selected = selectedInviteeIds.has(f.id);
                          const isMutual = mutualFriendIds.has(f.id);
                          return (
                            <TouchableOpacity
                              key={f.id}
                              style={[styles.chip, selected && styles.chipSelected]}
                              onPress={() => toggleInvitee(f.id)}
                              activeOpacity={0.85}
                              accessibilityLabel={isMutual ? `${f.display_name}, mutual friend` : f.display_name}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: selected }}
                            >
                              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                {selected ? '✓ ' : ''}{isMutual ? '🤝 ' : ''}{f.display_name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  </>
                )}

                <Text style={[styles.label, { marginTop: spacing.lg }]}>What's your budget?</Text>
                <Text style={styles.helperText}>A rough feel helps Nearby find realistic options once the group decides.</Text>
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  {BUDGET_LEVEL_OPTIONS.map((o) => {
                    const selected = budgetRangeKey === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setBudgetRangeKey(o.key); }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={o.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Item 94: progressive disclosure -- exact precision is
                    opt-in, never forced up front. */}
                {showBudgetMaxOverride ? (
                  <TextInput
                    style={[styles.input, { marginTop: spacing.sm }]}
                    placeholder="Maximum per person (optional)"
                    placeholderTextColor={colors.textTertiary}
                    value={budgetMaxOverride}
                    onChangeText={setBudgetMaxOverride}
                    keyboardType="number-pad"
                    accessibilityLabel="Maximum budget per person, optional"
                  />
                ) : (
                  <TouchableOpacity
                    onPress={() => setShowBudgetMaxOverride(true)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Set a maximum per person"
                    style={{ marginTop: spacing.sm }}
                  >
                    <Text style={styles.createOwnLinkText}>+ Set a maximum per person</Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.label, { marginTop: spacing.lg }]}>What kind of experience are you looking for?</Text>
                <Text style={styles.helperText}>A birthday dinner doesn't need the same options as a 50th anniversary — this helps Nearby adjust what it finds.</Text>
                <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
                  {EXPERIENCE_LEVEL_OPTIONS.map((o) => {
                    const selected = experienceLevel === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setExperienceLevel(o.key); }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={o.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.navRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={goBack}
                activeOpacity={0.85}
                accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
                accessibilityRole="button"
                disabled={submittingOptions || creatingGroupPlan}
              >
                <Text style={styles.backButtonText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
              </TouchableOpacity>
              {stepKey === 'options' && activityType === AUTO_PLAN_OPTION.key && !autoPlanExpanded ? (
                <TouchableOpacity
                  style={[styles.nextButton, (!optionsFetched || optionsLoading || (autoPlanSuggestion.items.length === 0 && autoPlanSuggestion.suggestions.length === 0)) && styles.nextButtonDisabled]}
                  onPress={proceedFromAutoPlanSummary}
                  activeOpacity={0.85}
                  disabled={!optionsFetched || optionsLoading || (autoPlanSuggestion.items.length === 0 && autoPlanSuggestion.suggestions.length === 0)}
                  accessibilityLabel="Find available options"
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>Find available options →</Text>
                </TouchableOpacity>
              ) : stepKey === 'options' ? (
                <TouchableOpacity
                  style={[styles.nextButton, (selectedIds.size === 0 || submittingOptions) && styles.nextButtonDisabled]}
                  onPress={submitSelectedBusinessRequests}
                  activeOpacity={0.85}
                  disabled={selectedIds.size === 0 || submittingOptions}
                  accessibilityLabel={`Ask These Businesses (${selectedIds.size})`}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>
                    {submittingOptions ? 'Sending…' : `Ask These Businesses (${selectedIds.size}) →`}
                  </Text>
                </TouchableOpacity>
              ) : stepKey === 'group_invite' ? (
                <TouchableOpacity
                  style={[styles.nextButton, (selectedInviteeIds.size === 0 || creatingGroupPlan) && styles.nextButtonDisabled]}
                  onPress={createGroupVote}
                  activeOpacity={0.85}
                  disabled={selectedInviteeIds.size === 0 || creatingGroupPlan}
                  accessibilityLabel={`Create Group Vote (${selectedInviteeIds.size})`}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>
                    {creatingGroupPlan ? 'Creating…' : `Create Group Vote (${selectedInviteeIds.size}) →`}
                  </Text>
                </TouchableOpacity>
              ) : stepKey === 'custom_describe' ? (
                // Item 74: once real results (or an honest empty state) are
                // showing, the actions are the inline rows/buttons above --
                // a generic "Next" here would have nowhere real to go.
                customSearchResult ? null : (
                  <TouchableOpacity
                    style={[styles.nextButton, (!customDescription.trim() || customSearching) && styles.nextButtonDisabled]}
                    onPress={submitCustomDescription}
                    activeOpacity={0.85}
                    disabled={!customDescription.trim() || customSearching}
                    accessibilityLabel="Find Options"
                    accessibilityRole="button"
                  >
                    <Text style={styles.nextButtonText}>{customSearching ? 'Finding…' : 'Find Options →'}</Text>
                  </TouchableOpacity>
                )
              ) : (
                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={goNext}
                  activeOpacity={0.85}
                  accessibilityLabel={finalStep ? "Let's Plan It" : 'Next'}
                  accessibilityRole="button"
                >
                  <Text style={styles.nextButtonText}>{finalStep ? "Let's Plan It →" : 'Next'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {stepKey === 'options' && !optionsLoading && (
              <TouchableOpacity
                style={styles.skipRow}
                onPress={proceedToDestination}
                activeOpacity={0.85}
                disabled={submittingOptions}
                accessibilityLabel="Skip, I'll ask myself"
                accessibilityRole="button"
              >
                <Text style={styles.skipRowText}>Skip — I'll post a general request myself →</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  progressRow: { flexDirection: 'row', marginBottom: spacing.xl },
  // Item 84: a soft, warm amber tint (never colors.primary/coral, which
  // this app reserves for actionable buttons) -- reads as "special"
  // against both light and dark backgrounds without a new theme token.
  occasionPreviewBanner: {
    backgroundColor: 'rgba(230, 168, 46, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(230, 168, 46, 0.4)',
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  occasionPreviewText: { ...typography.headline, color: colors.textPrimary, textAlign: 'center' },
  progressStep: { flex: 1, alignItems: 'center' },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginBottom: 6 },
  progressDotActive: { backgroundColor: colors.primary },
  progressLabel: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
  progressLabelActive: { color: colors.primary },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  sublabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  helperText: { color: colors.textTertiary, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  chipDisabled: { opacity: 0.5 },
  // Item 100: the "Ask a quick question" expand-in-place panel, same
  // Progressive Depth shape as GroupOccasionPlanScreen's own "+ Invite More
  // Guests" panel -- a link that expands in place, never a new screen.
  expandLinkText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  expandPanel: { marginTop: spacing.sm, gap: spacing.xs },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  // Item 74: the "Custom Occasion" free-text description box.
  textArea: { minHeight: 84, paddingTop: spacing.md },
  customSearchLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  customResultsBlock: { marginTop: spacing.lg },
  askBusinessButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm,
  },
  askBusinessButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  createOwnLinkText: { color: colors.primary, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  dateDisplay: {
    marginTop: spacing.md, backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  dateDisplayText: { color: colors.textPrimary, fontWeight: '600' },
  calendarToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.xs },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  calendarToggleText: { color: colors.textPrimary, fontSize: 14, flex: 1 },
  optionCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  optionCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryMuted },
  optionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  optionSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  optionHint: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  // Item 111 ("We'll plan it for you"): the "Here's what we'd do" summary
  // -- same optionCard visual language (surface/border/radius), laid out
  // as a simple label+detail row rather than a full tappable card, since
  // nothing here is individually selectable until "Find available options"
  // reveals the real checkable candidates below it.
  autoPlanRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs,
  },
  autoPlanRowLabel: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  autoPlanRowLabelMuted: { color: colors.textTertiary, fontWeight: '600' },
  autoPlanRowDetail: { color: colors.textSecondary, fontSize: 13 },
  autoPlanTotal: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginTop: spacing.sm, textAlign: 'right' },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  backButton: {
    paddingVertical: 16, paddingHorizontal: spacing.lg, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center', ...shadow.button },
  nextButtonDisabled: { opacity: 0.5 },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipRow: { alignItems: 'center', paddingVertical: spacing.md },
  skipRowText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
});
