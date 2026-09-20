import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image } from 'react-native';
import { NLoader, PullToRefresh, AnticipationText, NearbyPickBadge, FoundLine, showSuccessToast } from '../motion';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getHomeDashboard, getSocialForecast, getContinueYourCommunities, getUnlockedPerksCount, getHomeInsight, getPendingInvitesCount } from '../services/homeDashboard';
import { setGatheringInterested, getInterestedDemandPrefs, getMostRecentUnratedGathering, getMyGatheringsNeedingVenue, getMyGatheringsWithOutstandingRsvps, getMyPositiveExperienceSignals, getSignedGatheringPhotoUrl } from '../services/gatherings';
import { classifyCreateRequest, routeClassifiedIntentToCreation } from '../services/createAssistant';
import { resolveIntent, resolveCommunityIntent, navigateToIntentResultItem, buildFriendDiscoveryResultItem } from '../services/intentResolver';
import { runSurpriseMe, pickNextFromPool, findConnectedPerson, suggestionCandidateKeys, moodToParams } from '../services/surpriseMe';
import { detectFriendDiscoveryIntent, intentPhaseCaption } from '../services/intentResolverScoring';
import { recordIntentSelection, recordIntentSubmission, getPendingIntentOutcomePrompt, recordIntentOutcome, dismissIntentOutcomePrompt, getMyIntentPatterns, recordNudgeEvent } from '../services/intentOutcomes';
import { getMyGroupIntentSignals, getGatheringPlaceStatuses } from '../services/businessFulfillment';
import { formatPlaceStatusLabel } from '../utils/planCompletion';
import { getUpcomingConnectedBirthdays } from '../services/friends';
import { getUpcomingOccasions, getOccasionRecall, setOccasionRecallShareable } from '../services/occasions';
import { formatOccasionRecallSummary, occasionRecallLikedText } from '../utils/occasionRecall';
import { buildUpcomingWorldItems, formatUpcomingWorldItemParts } from '../utils/upcomingWorld';
import { getMyPendingPreferencePolls } from '../services/preferencePolls';
import { occasionDueLabel } from '../utils/occasionDatePrecision';
import { isCalendarIntegrationEnabled, getUpcomingCalendarEvents } from '../services/deviceCalendar';
import { nearestCalendarHint } from '../utils/calendarOccasionSuggestion';
import { logBusinessProfileView, getActiveOffers } from '../services/brandOffers';
import { buildHomeRecommendations } from '../services/homeRecommendations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GatheringFeedbackModal from '../components/GatheringFeedbackModal';
import PlanCard from '../components/PlanCard';
import { resolveGatheringPlanStatus, resolveGroupPlanStatus } from '../constants/planStatus';
import { supabase } from '../services/supabase';
import StartSomethingModal, { CREATE_HUB_OPTIONS } from '../components/StartSomethingModal';
import SurpriseMeSheet from '../components/SurpriseMeSheet';
import QuickPicksEditModal from '../components/QuickPicksEditModal';
import DiningPreferencesPromptModal from '../components/DiningPreferencesPromptModal';
import { shouldOfferDiningPrompt, personalizeQuickOptions } from '../constants/interestGraph';
import useMyInterests from '../hooks/useMyInterests';
import useMyGoals from '../hooks/useMyGoals';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { iconNameForCategory } from '../constants/quickPickIcons';
import LoadErrorState from '../components/LoadErrorState';
import ExperiencePerkLine from '../components/ExperiencePerkLine';
import ExperienceComponentList from '../components/ExperienceComponentList';
import TabHeaderActions from '../components/TabHeaderActions';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { isGatheringPast } from '../utils/objectState';
import { recommendationFacts, recommendationRow } from '../utils/recommendationFacts';
import { categorizeReasonText, REASON_CATEGORIES } from '../constants/recommendationReasonVocabulary';
import { gatheringCardModel } from '../utils/recommendationCard';
import { mergeHomeGatheringSignals } from '../utils/homeSignalMerge';
import { homeLoadNotice } from '../utils/homeLoadNotice';
import { getGreeting, getTimePeriod, getPersonalizedQuickPicks, getPinnedQuickPicks, formatHeroDateTime, describeFriendGatheringTiming } from '../utils/timeContext';
import { homeWeatherCard } from '../constants/weatherRelevance';
import { attendeeTotal, gatheringFullnessLabel } from '../utils/gatheringFullness';
import { gatheringTimeBadge } from '../utils/gatheringTimeLabel';
import { lightenHex } from '../utils/colorUtils';
import { OCCASION_OPTIONS } from '../constants/businessAttributes';
import { getUserLocation } from '../services/userLocation';
import { placeDistanceLabel } from '../services/places';
import { gatheringPrimaryAction, peoplePrimaryAction } from '../utils/primaryAction';

import { countLabel } from '../utils/plural';
const PERIOD_DATE_FILTER = { morning: 'today', afternoon: 'today', evening: 'today', weekend: 'weekend' };

const PERIOD_SECTION_LABELS = { morning: 'Good Morning', afternoon: 'This Afternoon', evening: 'Tonight', weekend: 'This Weekend' };

// Phase 1a of the Intent Layer plan (CLAUDE.md) -- rotating placeholder
// examples for the new "What do you want to do?" box. Picked once per
// mount, not re-randomized on every keystroke.
// Item 60 (CEO test, CLAUDE.md): every prior example here was activity-shaped,
// so a first-time user skimming Home never saw a hint that meeting people is
// also part of the app -- "Meet new people…" is a real, already-supported
// intent phrase (detectFriendDiscoveryIntent in intentResolverScoring.js), not
// a placeholder that would resolve to nothing if actually typed.
const INTENT_PLACEHOLDER_EXAMPLES = ['Dinner tonight…', 'Something fun Saturday…', 'Find a pickleball game…', 'Meet new people…'];

// One icon per real resolver candidate type (intentResolver.js) -- kept as
// a lookup rather than a ternary chain now that there are 4 real types,
// not 2. 'community' reuses the same glyph as Home's own "Your
// Communities" section header for visual consistency; 'business_availability'
// reuses the same glyph as the empty-fallback's "Ask Nearby Businesses"
// button, since it's the same underlying supply.
const INTENT_RESULT_ICONS = {
  perk: 'gift-outline',
  friend_request: 'person-outline',
  community: 'business-outline',
  business_availability: 'storefront-outline',
  // Same storefront glyph as a confirmed business match -- the row's own
  // title/subtitle text (never "Available") is what carries the weaker
  // confidence, not a different icon.
  business_policy_match: 'storefront-outline',
  gathering: 'people-outline',
  // P1 remediation (CLAUDE.md, Aug 28 Full Coherence Audit, Scenario D) --
  // a real, honest "go meet people" action, never a stranger's profile
  // injected into this list; see detectFriendDiscoveryIntent()'s own
  // header comment for why this stays a navigation action, not a
  // resolver candidate.
  friend_discovery: 'heart-outline',
};

// Nearby 2.0 vision layer 4, "make it happen" multi-option planning (see
// CLAUDE.md's "Nearby 2.0 Vision" doc) -- scoped down from the vision
// doc's own full framing, deliberately: it explicitly warns that
// "composing three empty tiers... would be worse than today's honest
// single ranked list." This never composes anything that isn't already
// real -- it's a pure regrouping of resolveIntent()'s own already-fetched
// results, only when there's genuine diversity across tiers (2+ distinct
// real result types) to group in the first place. A single-type result
// set (by far the common case today) renders exactly as before -- no
// visual change, no risk of dressing up one real result as "three ways."
const INTENT_RESULT_TYPE_LABELS = {
  gathering: '🎉 Already happening',
  community: '🏘️ A community for this',
  friend_request: '👥 Someone you know wants this too',
  perk: '🎁 A perk that fits',
  // 🟢/🟡: real hierarchy per direct instruction -- confirmed live supply
  // is ranked and labeled distinctly from a business's standing willingness
  // to fulfill, which is never called "Available."
  business_availability: '🟢 A business has this ready',
  business_policy_match: '🟡 A business may be able to help',
  // P1 remediation (CLAUDE.md, Aug 28 Full Coherence Audit, Scenario D) --
  // see detectFriendDiscoveryIntent()'s own header comment: a real,
  // honest navigation action, grouped separately from any real resolver
  // candidate so it never reads as "we found this gathering/perk."
  friend_discovery: '💗 Meet new people',
};

// buildFriendDiscoveryResultItem moved to services/intentResolver.js
// (Item 39, CLAUDE.md) so Discover's own search box can build the
// identical synthetic result -- imported above.

function groupIntentResultsByType(items) {
  const order = [];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.type)) {
      groups.set(item.type, []);
      order.push(item.type);
    }
    groups.get(item.type).push(item);
  }
  return order.map((type) => ({ type, items: groups.get(type) }));
}

const PERIOD_SUBTITLES = {
  morning: 'What sounds good this morning?',
  afternoon: 'What sounds good this afternoon?',
  evening: 'What sounds good tonight?',
  weekend: 'What sounds good this weekend?',
};

// Same icon set OccasionsScreen.js's OCCASION_TYPES already uses -- kept
// in sync manually since neither file imports the other. 'birthday' was
// originally a defensive-only fallback here (birthdays lived only in
// profiles.birthdate, surfaced by the separate birthdayNudge above) --
// it's now a real, reachable case too: OccasionsScreen.js added 'birthday'
// as a selectable type (Item 61 follow-up, CLAUDE.md) for celebrating
// someone who isn't a Nearby user at all, so has no profiles.birthdate for
// birthdayNudge to ever find. The two nudges are independent and can both
// render at once (line ~1726) -- they're never about the same real person
// unless the caller deliberately double-entered one, which the Occasions
// screen's own subtitle now warns against.
// Item 73 (CLAUDE.md): this used to be its own small hardcoded map --
// exactly the "hard-coded around birthdays" pattern the item warns
// against, since every occasion type added since (graduation/milestone/
// etc., then wedding/retirement/new_job/... in this same item) had to be
// separately remembered here too, and several already weren't (this
// screen's own nudge card silently fell back to a generic 📅 for most of
// them until now). Derives from OCCASION_OPTIONS -- the one real source
// of truth for every occasion's icon -- so a future occasion added there
// is automatically covered here too, no second list to keep in sync.
function occasionTypeIcon(occasionType) {
  return OCCASION_OPTIONS.find((o) => o.key === occasionType)?.icon ?? '📅';
}


function formatWeeklyRecap(recap) {
  const parts = [];
  if (recap.gatheringsAttended > 0) {
    parts.push(`${recap.gatheringsAttended} gathering${recap.gatheringsAttended === 1 ? '' : 's'}`);
  }
  if (recap.newFriends > 0) {
    parts.push(`${recap.newFriends} new connection${recap.newFriends === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export default function HomeScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors);
  const [dashboard, setDashboard] = useState(null);
  // Real, computed Place status for "Your Plans" gathering rows (CLAUDE.md,
  // Aug 29 2026) -- keyed by gathering id, `{ state: 'done'|'pending',
  // venueName }`. Deliberately closes a real gap PlanCard's own
  // hosting_partner_id lookup never covered: hosting_partner_id is only
  // ever set by the separate business-partnership-sponsorship flow, never
  // by accepting a business_request_offers row (the actual, more common
  // "asked local businesses, got an accepted offer" path) -- so this is
  // the one signal that makes Home's own Plans list honestly reflect the
  // real outcome of that flow, not a redraw of the offer-accept banner
  // Home already has a dedicated dismissible nudge for. Only ever
  // populated for a gathering with a real, currently-open or accepted
  // request -- a gathering that was never asked about at all has no
  // entry, so nothing new is shown for the common "never tried" case.
  const [planPlaceStatus, setPlanPlaceStatus] = useState({});
  // Phase 8 section H (CLAUDE.md) -- Home's own single hero moment.
  // dashboard.bestPick already only exists when a real gathering cleared
  // getGatheringFitReasons()'s own score>=5 threshold (homeDashboard.js),
  // so this never fetches a cover for an ordinary/filler pick. Deliberately
  // just one signed-URL fetch, not a batch like Discover's coverPhotoUrls
  // map -- Home has exactly one hero candidate, never a list of them.
  const [bestPickCoverUrl, setBestPickCoverUrl] = useState(null);
  const [myName, setMyName] = useState('');
  const [myUserId, setMyUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offersLoadFailed, setOffersLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [socialForecast, setSocialForecast] = useState(null);
  // No position at all (permission off/undetermined, no stored fix): nearby sections can't fill, so Home
  // says so and invites turning it on, instead of implying a quiet night.
  const [locationOff, setLocationOff] = useState(false);
  const [continueCommunities, setContinueCommunities] = useState([]);
  const [perksCount, setPerksCount] = useState(0);
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0);
  const [unratedGathering, setUnratedGathering] = useState(null);
  const [pinnedQuickPicks, setPinnedQuickPicks] = useState(null);
  // Progressive dining-taste prompt (Preference wiring Phase 4): a permanent, per-user dismissable Home card.
  const myDeclaredInterests = useMyInterests();
  const goalRow = useMyGoals();
  const [diningNudge, setDiningNudge] = useState(false);
  const [diningModalVisible, setDiningModalVisible] = useState(false);
  const [quickPicksEditVisible, setQuickPicksEditVisible] = useState(false);
  const [intentText, setIntentText] = useState('');
  const [intentThinking, setIntentThinking] = useState(false);
  const [intentPhase, setIntentPhase] = useState(null); // Item 135: real pipeline phase
  const [intentResults, setIntentResults] = useState(null);
  const [intentEmptyFallback, setIntentEmptyFallback] = useState(null);
  const [intentPlaceholder, setIntentPlaceholder] = useState(() => INTENT_PLACEHOLDER_EXAMPLES[Math.floor(Math.random() * INTENT_PLACEHOLDER_EXAMPLES.length)]);
  // "Surprise Me" (critique item 28) -- entirely separate state from the
  // typed-ask intentResults above (no classifyResult/typedText exists for
  // a quick-picker-only ask). `pool`/`connectedPeople` are the real,
  // already-fetched candidates a Shuffle Again re-rolls from -- never
  // refetched unless the pool is genuinely exhausted (see
  // handleSurpriseShuffle below). `shown` is every candidate key already
  // displayed this session, so a shuffle never repeats the same one back
  // to back.
  const [surpriseSheetVisible, setSurpriseSheetVisible] = useState(false);
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [surprise, setSurprise] = useState(null);
  const [outcomePrompt, setOutcomePrompt] = useState(null);
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);
  // Nearby 2.0 vision, partial build (see CLAUDE.md's "Nearby 2.0 Vision"
  // doc, layers 6 "Predictive Nearby" and 3 "Group intent") -- both are
  // real, dismissible Home nudges, never auto-acting, built on data this
  // app already collects. Dismissal is local/ephemeral (AsyncStorage, not
  // a DB row) since neither card is tied to a specific answerable record
  // the way the outcome-prompt card above is -- dismissing just means
  // "not today," and a fresh day naturally re-evaluates the real pattern.
  const [predictivePattern, setPredictivePattern] = useState(null);
  const [groupIntentSignal, setGroupIntentSignal] = useState(null);
  // "The Plan Engine" Phase 1 (CLAUDE.md, Aug 23 2026) -- a real, dismissible
  // advance-notice birthday nudge, same per-day AsyncStorage dismiss
  // convention as predictivePattern/groupIntentSignal above. Distinct from
  // the existing same-day "Birthday Today" push (-> ViewProfile, unchanged)
  // -- this fires days ahead, while there's still real time to plan, and
  // routes to gathering creation instead.
  const [birthdayNudge, setBirthdayNudge] = useState(null);
  const [occasionNudge, setOccasionNudge] = useState(null);
  // Item 101 (CLAUDE.md): a real recall of what happened the last time a
  // recurring occasion was fulfilled -- null whenever this is a first-time
  // occasion or the recall genuinely can't resolve (see get_occasion_recall).
  const [occasionRecall, setOccasionRecall] = useState(null);
  // Item 104 (CLAUDE.md, "There could eventually be an 'Occasions'
  // recommendation engine"): the full real sorted lists behind
  // birthdayNudge/occasionNudge above (not just their own soonest item),
  // kept only so the "Upcoming in Your World" widget below can show what's
  // coming up BEYOND the one thing already featured -- see
  // upcomingWorld.js's own header comment.
  const [allUpcomingOccasions, setAllUpcomingOccasions] = useState([]);
  const [allUpcomingBirthdays, setAllUpcomingBirthdays] = useState([]);
  // Item 100 (CLAUDE.md): a real count of pending "quick question" polls
  // waiting for this user's own answer.
  const [pendingPollsCount, setPendingPollsCount] = useState(0);
  // "The Plan Engine" Phase 2 (CLAUDE.md) -- the soonest real upcoming
  // hosted gathering that genuinely has no venue and no business_requests
  // row yet at all. Same per-day dismiss convention as the nudges above;
  // acting on it navigates to that gathering's own real detail screen,
  // never submits anything itself (the 4-state host banner there already
  // owns that decision).
  const [venueNeededGathering, setVenueNeededGathering] = useState(null);
  // "The Plan Engine" Phase 3 (CLAUDE.md) -- the soonest real upcoming
  // hosted gathering with at least one genuinely still-pending sent
  // invite. Same per-day dismiss convention as the other nudges here;
  // acting on it navigates to that gathering's own real detail screen,
  // never nudges the invitee itself (that's a separate, larger feature).
  const [rsvpsOutstandingGathering, setRsvpsOutstandingGathering] = useState(null);
  // Phase 6 of the "Build everything" plan (CLAUDE.md) -- a real, one-time
  // first-run demonstration moment, gated on the real profiles.
  // seen_home_first_run_moment flag (same "shown once, flip a flag, never
  // again" shape seen_browse_callout already established). null = not yet
  // known (never renders while null, avoiding a flash before the profile
  // fetch resolves); false = show it once; true = already seen, never
  // shown again. Content is honest either way -- real top recommendations
  // when Phase 1's engine has real content, an honest "we'll get smarter"
  // state when it doesn't -- never fabricated narrative.
  const [seenFirstRunMoment, setSeenFirstRunMoment] = useState(null);
  // Phase 1 of the "Build everything" plan (CLAUDE.md) -- the unified
  // recommendation engine's ranked output. A small, capped, additive
  // section (never a replacement for Best Pick/Trending/Because You Like),
  // reusing the same already-fetched nearby gatherings + a single new
  // getActiveOffers() call, scored on the shared intent-resolver axis.
  const [homeRecommendations, setHomeRecommendations] = useState([]);
  const period = getTimePeriod();
  // Impression analytics dedupe: this screen's own useFocusEffect re-runs the
  // "should I show a nudge" check on every focus, so a plain "log shown here"
  // would inflate the impression count every time the user tabs back to Home.
  // A per-session, in-memory set of already-logged dismissKeys keeps "shown"
  // honest -- one real impression per distinct nudge instance per app launch,
  // not one per refocus.
  const loggedNudgeShownRef = useRef(new Set());

  // Item 104 (CLAUDE.md): the real "Upcoming in Your World" preview --
  // whatever's coming up beyond the single item already featured by
  // birthdayNudge/occasionNudge above (see buildUpcomingWorldItems's own
  // header comment for why `skip` defaults to 1). Recomputes whenever
  // either underlying list changes; empty until both real fetches land.
  const upcomingWorldItems = useMemo(
    () => buildUpcomingWorldItems({ occasions: allUpcomingOccasions, birthdays: allUpcomingBirthdays }),
    [allUpcomingOccasions, allUpcomingBirthdays]
  );

  // Contextual primary CTA (utils/primaryAction.js): "Join | View", never a wall of buttons. Join opens the normal
  // confirmation on the detail screen (limits, approval, women-only all live there), so nothing is bypassed.
  // Private "I might go" toggled straight from the card. Optimistic; the first-ever Interested goes through the
  // detail screen instead so the one-time anonymous-demand disclosure is shown there (never skipped).
  const [interestedOverride, setInterestedOverride] = useState({});
  const interestedSet = useMemo(() => {
    const set = new Set(dashboard?.interestedIds ?? []);
    Object.entries(interestedOverride).forEach(([id, on]) => (on ? set.add(id) : set.delete(id)));
    return set;
  }, [dashboard?.interestedIds, interestedOverride]);
  async function toggleCardInterested(g, on) {
    if (!on) {
      const prefs = await getInterestedDemandPrefs().catch(() => null);
      if (prefs && prefs.share && !prefs.acknowledged) {
        navigation.navigate('GatheringDetail', { gatheringId: g.id });
        showSuccessToast('One quick step', 'Tap ☆ Interested there. We\'ll explain how it works once.');
        return;
      }
    }
    setInterestedOverride((o) => ({ ...o, [g.id]: !on }));
    try {
      await setGatheringInterested(g.id, !on);
    } catch (e) {
      setInterestedOverride((o) => ({ ...o, [g.id]: on }));
      Alert.alert('Error', e.message);
    }
  }

  // One object, multiple signals: a gathering that is a Best Pick, matches your interests, is trending and/or is hosted
  // by a friend renders ONCE with all its reasons (see utils/homeSignalMerge.js).
  const homeMerge = mergeHomeGatheringSignals({
    bestPick: dashboard?.bestPick,
    becauseYouLike: dashboard?.becauseYouLike,
    trending: dashboard?.trendingGatherings,
    friends: dashboard?.friendsActivity,
    soon: dashboard?.happeningNow,
    friendIds: dashboard?.friendIds ? new Set(dashboard.friendIds) : null,
    isPast: (g) => isGatheringPast(g),
  });

  // A starting-soon gathering that Picked For You already shows carries "Starting soon" as one of its reasons there,
  // so it is not repeated as a chip (one object, one place).
  const shownInMergeIds = new Set([homeMerge.hero?.id, ...homeMerge.cards.map((c) => c.gathering.id)].filter(Boolean));
  const startingSoonChips = (dashboard?.happeningNow ?? []).filter((g) => !shownInMergeIds.has(g.id));

  function renderGatheringCta(g, variant) {
    const action = gatheringPrimaryAction(g, myUserId, Date.now(), variant === 'trending' ? { lowCommitment: true, interestedIds: interestedSet } : {});
    const openDetail = (extra = {}) => navigation.navigate('GatheringDetail', { gatheringId: g.id, ...extra });
    const hero = variant === 'hero';
    const primaryStyle = hero ? styles.heroCta : styles.rowCta;
    const primaryText = hero ? styles.heroCtaText : styles.rowCtaText;
    const viewStyle = hero ? [styles.heroCta, styles.heroCtaGhost] : styles.rowCtaGhost;
    const viewText = hero ? styles.heroCtaText : styles.rowCtaGhostText;
    if (action.kind === 'view' || action.kind === 'view_plan') {
      return (
        <TouchableOpacity style={primaryStyle} onPress={() => openDetail()} accessibilityRole="button" accessibilityLabel={`${action.label} ${g.title}`}>
          <Text style={primaryText}>{action.label} →</Text>
        </TouchableOpacity>
      );
    }
    return (
      <View style={styles.ctaRow}>
        {action.kind === 'interested' ? (
          <TouchableOpacity style={action.on ? styles.rowCtaGhost : primaryStyle} onPress={() => toggleCardInterested(g, action.on)} accessibilityRole="button" accessibilityState={{ selected: action.on }} accessibilityLabel={action.on ? `Remove Interested: ${g.title}` : `Mark Interested: ${g.title}`}>
            <Text style={action.on ? styles.rowCtaGhostText : primaryText}>{action.label}</Text>
          </TouchableOpacity>
        ) : action.kind === 'join' ? (
          <TouchableOpacity style={primaryStyle} onPress={() => openDetail({ openJoin: true })} accessibilityRole="button" accessibilityLabel={`${action.label}: ${g.title}`}>
            <Text style={primaryText}>{action.label}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={hero ? styles.heroMeta : styles.trendingMeta}>{action.label}</Text>
        )}
        <TouchableOpacity style={viewStyle} onPress={() => openDetail()} accessibilityRole="button" accessibilityLabel={`View ${g.title}`}>
          <Text style={viewText}>View</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      setMyUserId(myId ?? null);
      if (myId) {
        // Phase J (CLAUDE.md) -- created_at is the one new column this
        // whole phase needs; a plain, already-fetched real timestamp, zero
        // new query, used below to compute real account-age maturity.
        const { data: profile } = await supabase.from('profiles').select('display_name, home_quick_pick_categories, seen_home_first_run_moment, social_comfort_level, created_at, interests, cuisine_preferences, venue_preferences, interest_groups').eq('id', myId).single();
        setMyName(profile?.display_name?.split(' ')[0] ?? '');
        setPinnedQuickPicks(Array.isArray(profile?.home_quick_pick_categories) ? profile.home_quick_pick_categories : null);
        setSeenFirstRunMoment(profile?.seen_home_first_run_moment ?? true);
        const diningDismissed = await AsyncStorage.getItem(`dining_prompt_dismissed_${myId}`).catch(() => null);
        setDiningNudge(shouldOfferDiningPrompt({ interests: profile?.interests, cuisinePreferences: profile?.cuisine_preferences, venuePreferences: profile?.venue_preferences, dismissed: !!diningDismissed }));
      }
      // Everything below is independent -- none of these fetches need each
      // other's *results* (each only ever sets its own isolated piece of
      // state), they were only ever chained one after another because
      // they're all "supplementary, non-fatal" content. Running them one
      // at a time meant the screen's loading spinner stayed up for the sum
      // of every round trip, not the slowest one -- on a real network
      // that's a dozen-plus sequential round trips before `loading` ever
      // flips false, which is the real, confirmed cause of Home
      // "sometimes taking a while to load." Firing them all at once and
      // awaiting together fixes both that and a real, related correctness
      // gap: in the old sequential chain, a failure partway through
      // silently skipped every fetch after it (including ones with their
      // own "non-fatal" try/catch, which never even got a chance to run) --
      // now each is genuinely independent, matching what the comments
      // here already claimed.
      const dashboardTask = getHomeDashboard().then((result) => {
        setDashboard(result);
        if (result?.bestPick?.cover_photo_path) {
          getSignedGatheringPhotoUrl(result.bestPick.cover_photo_path).then(setBestPickCoverUrl).catch(() => {});
        } else {
          setBestPickCoverUrl(null);
        }
        return result;
      });

      const weatherTask = (async () => {
        try {
          // Not ask:false. getHomeDashboard() below prompts anyway (nearby gatherings), and this call
          // starts first: a check-only read here saw "undetermined" before the prompt was answered, so a
          // first-run user who tapped Allow still got the location-off card and no weather.
          const myLocation = await getUserLocation();
          if (!myLocation) return { forecast: null, myLocation: null };
          const forecast = await getSocialForecast(myLocation.coords.latitude, myLocation.coords.longitude);
          setSocialForecast(forecast);
          return { forecast, myLocation };
        } catch (e) {
          // Same reasoning as the rest of this block -- the weather card
          // is a contextual extra, not core content; a failure here
          // shouldn't flip the whole screen into an error state.
          console.error('Social forecast fetch failed', e);
          return { forecast: null, myLocation: null };
        }
      })();

      const communitiesTask = getContinueYourCommunities().then(setContinueCommunities).catch((e) => console.error('getContinueYourCommunities failed', e));
      const perksTask = getUnlockedPerksCount().then(setPerksCount).catch((e) => console.error('getUnlockedPerksCount failed', e));
      const unratedTask = getMostRecentUnratedGathering().then(setUnratedGathering).catch((e) => console.error('getMostRecentUnratedGathering failed', e));
      const pendingInvitesTask = getPendingInvitesCount(myId).then(setPendingInvitesCount).catch((e) => console.error('getPendingInvitesCount failed', e));
      const pendingOutcomeTask = getPendingIntentOutcomePrompt().then(setOutcomePrompt).catch((e) => console.error('getPendingIntentOutcomePrompt failed', e));

      // 10/10 roadmap Part 7: a real, recurring pattern (if one exists for
      // right now) joins the existing static rotation as one more example
      // -- never replaces the box, never auto-submits, never shown for a
      // user without a real repeated pattern (falls back to today's
      // static examples exactly as before).
      const intentPatternTask = getMyIntentPatterns()
        .then((pattern) => {
          if (pattern?.placeholderText) {
            const pool = [...INTENT_PLACEHOLDER_EXAMPLES, pattern.placeholderText];
            setIntentPlaceholder(pool[Math.floor(Math.random() * pool.length)]);
          }
          return pattern;
        })
        .catch((e) => {
          console.error('getMyIntentPatterns failed', e);
          return null;
        });

      // Nearby 2.0 vision layer 6, "Predictive Nearby" -- a real proactive
      // nudge, not just a smarter placeholder: the same 3+-occurrence
      // pattern above (hence chained off intentPatternTask, the one real
      // dependency in this whole block), but only ever a dismissible
      // suggestion the user explicitly taps to act on, never
      // auto-submitted. Dismissed for today via a local, per-day key -- a
      // fresh day re-evaluates honestly rather than nagging forever.
      const predictiveNudgeTask = intentPatternTask
        .then(async (pattern) => {
          if (!pattern?.category) return;
          const dismissKey = `predictive_dismiss_${new Date().toDateString()}_${pattern.category}_${pattern.period}`;
          const dismissed = await AsyncStorage.getItem(dismissKey);
          if (!dismissed) {
            setPredictivePattern(pattern);
            if (!loggedNudgeShownRef.current.has(dismissKey)) {
              loggedNudgeShownRef.current.add(dismissKey);
              recordNudgeEvent('predictive', 'shown', pattern.category);
            }
          }
        })
        .catch((e) => console.error('predictive nudge dismiss check failed', e));

      // Nearby 2.0 vision layer 3, "Group intent" -- real, dismissible:
      // shown only when the RPC's own real >=2-connected-people threshold
      // is actually crossed, never fabricated. Takes the top
      // (highest-count) real signal only, so this reads as one honest
      // nudge, not a list of speculative categories.
      const groupIntentTask = (async () => {
        try {
          const groupSignals = await getMyGroupIntentSignals();
          if (groupSignals.length > 0) {
            const top = groupSignals[0];
            const dismissKey = `group_intent_dismiss_${new Date().toDateString()}_${top.category}_${top.request_count}`;
            const dismissed = await AsyncStorage.getItem(dismissKey);
            if (!dismissed) {
              setGroupIntentSignal(top);
              if (!loggedNudgeShownRef.current.has(dismissKey)) {
                loggedNudgeShownRef.current.add(dismissKey);
                recordNudgeEvent('group_intent', 'shown', top.category);
              }
            }
          }
        } catch (e) {
          console.error('getMyGroupIntentSignals failed', e);
        }
      })();

      // "The Plan Engine" Phase 1 (CLAUDE.md) -- real, dismissible: the
      // single soonest real upcoming birthday among the caller's own real
      // connections (friends+matches), scoped server-side. Per-day
      // dismiss, same convention as the two nudges above.
      const birthdayTask = (async () => {
        try {
          const birthdays = await getUpcomingConnectedBirthdays();
          setAllUpcomingBirthdays(birthdays);
          if (birthdays.length > 0) {
            const soonest = birthdays[0];
            const dismissKey = `birthday_dismiss_${new Date().toDateString()}_${soonest.connection_id}`;
            const dismissed = await AsyncStorage.getItem(dismissKey);
            if (!dismissed) {
              setBirthdayNudge(soonest);
              if (!loggedNudgeShownRef.current.has(dismissKey)) {
                loggedNudgeShownRef.current.add(dismissKey);
                recordNudgeEvent('predictive', 'shown', 'birthday');
              }
            }
          }
        } catch (e) {
          console.error('getUpcomingConnectedBirthdays failed', e);
        }
      })();

      // Phase H (CLAUDE.md, "global onboarding -> product wiring" master
      // plan) -- real, dismissible: the single soonest real Occasion
      // (anniversary/graduation/milestone/life_event/other) among the
      // caller's own saved occasions plus any a real connected person
      // shared with them, scoped server-side. Same per-day dismiss
      // convention as every other nudge here. Deliberately additive to
      // birthdayTask above, never a replacement -- birthdays stay their
      // own, already-live signal.
      const occasionTask = (async () => {
        try {
          const occasions = await getUpcomingOccasions();
          setAllUpcomingOccasions(occasions);
          if (occasions.length > 0) {
            const soonest = occasions[0];
            const dismissKey = `occasion_dismiss_${new Date().toDateString()}_${soonest.occasion_id}`;
            const dismissed = await AsyncStorage.getItem(dismissKey);
            if (!dismissed) {
              setOccasionNudge(soonest);
              if (!loggedNudgeShownRef.current.has(dismissKey)) {
                loggedNudgeShownRef.current.add(dismissKey);
                recordNudgeEvent('predictive', 'shown', 'occasion');
              }
              // Item 101 (CLAUDE.md, "Occasions can become recurring"): only
              // fetched when this occasion has genuine prior-year history
              // (a real resulting_plan_id + last_planned_at) -- a first-
              // time occasion never triggers this extra round trip.
              // Best-effort: a failed/null recall just falls back to the
              // existing plain nudge card, never blocks it.
              if (soonest.resulting_plan_id && soonest.last_planned_at) {
                getOccasionRecall(soonest.occasion_id).then(setOccasionRecall).catch(() => {});
              }
            }
          }
        } catch (e) {
          console.error('getUpcomingOccasions failed', e);
        }
      })();

      // "The Plan Engine" Phase 2 (CLAUDE.md) -- real, dismissible: the
      // soonest real upcoming hosted gathering with genuinely no venue and
      // no business_requests row yet. Per-day dismiss, same convention as
      // every other nudge here.
      // Item 100 (CLAUDE.md, "Let the recipient contribute preferences
      // without spoiling the surprise"): a real, un-dismissible entry
      // point so a pending "quick question" is never a dead end if the
      // push notification was missed -- distinct from the other nudge
      // cards above/below, which are all optional suggestions; this one is
      // a real pending action someone else is waiting on.
      const pendingPollsTask = (async () => {
        try {
          const pending = await getMyPendingPreferencePolls();
          setPendingPollsCount(pending.length);
        } catch (e) {
          console.error('getMyPendingPreferencePolls failed', e);
        }
      })();

      const venueTask = (async () => {
        try {
          const needingVenue = await getMyGatheringsNeedingVenue();
          if (needingVenue.length > 0) {
            const soonest = needingVenue[0];
            const dismissKey = `venue_needed_dismiss_${new Date().toDateString()}_${soonest.id}`;
            const dismissed = await AsyncStorage.getItem(dismissKey);
            if (!dismissed) {
              setVenueNeededGathering(soonest);
              if (!loggedNudgeShownRef.current.has(dismissKey)) {
                loggedNudgeShownRef.current.add(dismissKey);
                recordNudgeEvent('predictive', 'shown', 'venue_needed');
              }
            }
          }
        } catch (e) {
          console.error('getMyGatheringsNeedingVenue failed', e);
        }
      })();

      // "The Plan Engine" Phase 3 (CLAUDE.md) -- real, dismissible: the
      // soonest real upcoming hosted gathering with at least one real
      // still-pending sent invite. Per-day dismiss, same convention as
      // every other nudge here.
      const rsvpsTask = (async () => {
        try {
          const outstandingRsvps = await getMyGatheringsWithOutstandingRsvps();
          if (outstandingRsvps.length > 0) {
            const soonest = outstandingRsvps[0];
            const dismissKey = `rsvps_dismiss_${new Date().toDateString()}_${soonest.id}`;
            const dismissed = await AsyncStorage.getItem(dismissKey);
            if (!dismissed) {
              setRsvpsOutstandingGathering(soonest);
              if (!loggedNudgeShownRef.current.has(dismissKey)) {
                loggedNudgeShownRef.current.add(dismissKey);
                recordNudgeEvent('predictive', 'shown', 'rsvps_outstanding');
              }
            }
          }
        } catch (e) {
          console.error('getMyGatheringsWithOutstandingRsvps failed', e);
        }
      })();

      // Item 75 (CLAUDE.md): a real, best-effort calendar signal joins the
      // existing placeholder rotation -- same "merge into the pool, pick
      // one at random" mechanism intentPatternTask already established
      // above. Never requests calendar permission itself; only reads if
      // the user already opted in elsewhere (OccasionsScreen). A benign
      // race with intentPatternTask over which one last sets
      // intentPlaceholder is fine -- it's placeholder text, not data.
      const calendarHintTask = (async () => {
        try {
          const enabled = await isCalendarIntegrationEnabled();
          if (!enabled) return;
          const events = await getUpcomingCalendarEvents(7);
          const hint = nearestCalendarHint(events, 5);
          if (!hint) return;
          const pool = [...INTENT_PLACEHOLDER_EXAMPLES, `Plan something for ${hint.title}…`];
          setIntentPlaceholder(pool[Math.floor(Math.random() * pool.length)]);
        } catch (e) {
          console.error('calendarHintTask failed', e);
        }
      })();

      const [result, weatherResult] = await Promise.all([
        dashboardTask,
        weatherTask,
        communitiesTask,
        perksTask,
        unratedTask,
        pendingInvitesTask,
        pendingOutcomeTask,
        predictiveNudgeTask,
        groupIntentTask,
        birthdayTask,
        occasionTask,
        venueTask,
        rsvpsTask,
        calendarHintTask,
        pendingPollsTask,
      ]);
      const { forecast, myLocation } = weatherResult;
      setLocationOff(!myLocation);
      setLoadError(false);

      // Real, computed Place status for "Your Plans" (CLAUDE.md, Aug 29
      // 2026) -- fired here rather than inside the earlier Promise.all
      // batch since it genuinely depends on that batch's own result
      // (which gathering ids are actually on Home right now). Supplementary
      // and non-fatal, same convention as every other secondary fetch on
      // this screen.
      const planGatheringIds = [
        ...(result?.plansGoing ?? []).map((p) => p.id),
        ...(result?.plansHosting ?? []).map((p) => p.id),
      ];
      getGatheringPlaceStatuses(planGatheringIds)
        .then(setPlanPlaceStatus)
        .catch((e) => console.error('getGatheringPlaceStatuses failed', e));

      // Phase 1 of the "Build everything" plan -- the unified Home
      // recommendation engine. Reuses the already-fetched nearby
      // gatherings from result.nearbyGatherings (no second query) plus one
      // new getActiveOffers() call (the same real function BrandOffers/
      // Discover already use, same location it already scopes to) -- no
      // new data source beyond that. Excludes anything already committed
      // to (Your Plans) so nothing is suggested twice. Supplementary,
      // non-fatal — a failure here shouldn't affect anything else on the
      // screen.
      try {
        setOffersLoadFailed(false);
        const offers = await getActiveOffers(myLocation?.coords?.latitude ?? null, myLocation?.coords?.longitude ?? null).catch((e) => { console.error('home offers failed', e); setOffersLoadFailed(true); return []; });
        // "The Plan Engine" Phase 4 (CLAUDE.md) -- real post-visit
        // feedback (gathering_feedback/business_offer_outcomes) feeding
        // back into this same scoring pass. Supplementary, non-fatal --
        // falls back to two empty Sets (no bonus applied) on failure,
        // matching this whole block's own established convention.
        const { positiveHostIds, positivePartnerIds, positiveCategories } = await getMyPositiveExperienceSignals().catch(() => ({
          positiveHostIds: new Set(),
          positivePartnerIds: new Set(),
          positiveCategories: new Set(),
        }));
        // Phase J (CLAUDE.md) -- both real, zero-new-query: accountAgeDays
        // from profile.created_at (this same load() call's own already-
        // fetched profile row); hasBehavioralHistory from
        // result.becauseYouLikeCategories (getHomeDashboard()'s own
        // already-fetched getMyTopGatheringCategories() result, reused
        // here for a second, different purpose -- non-empty means the
        // caller has genuinely joined/hosted something with a real
        // category before, empty means a brand-new account with nothing
        // yet). A missing created_at (shouldn't happen for a real row,
        // but never trusted blind) falls back to null, which
        // computeAccountMaturity() reads as "unknown -> full trust", the
        // same safe default as omitting the param entirely.
        const accountAgeDays = profile?.created_at
          ? (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
          : null;
        const hasBehavioralHistory = (result?.becauseYouLikeCategories?.length ?? 0) > 0;
        setHomeRecommendations(
          buildHomeRecommendations({
            gatherings: result?.nearbyGatherings ?? [],
            offers,
            weather: forecast,
            excludeIds: new Set(result?.upcomingPlanIds ?? []),
            positiveHostIds,
            positivePartnerIds,
            positiveCategories,
            // Sep 3 2026 ("global onboarding -> product wiring" master
            // plan, CLAUDE.md, Phase A) -- `profile` is the same select
            // from earlier in this same load() call (closure, not a
            // second fetch); social_comfort_level was a real, confirmed
            // orphaned onboarding field until this line.
            socialComfortLevel: profile?.social_comfort_level ?? null,
            interestGroups: profile?.interest_groups ?? [],
            accountAgeDays,
            hasBehavioralHistory,
          })
        );
      } catch (e) {
        console.error('buildHomeRecommendations failed', e);
      }
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function closeStartModal() {
    setStartModalVisible(false);
  }

  function handleQuickAction(item) {
    // Discover-first, unconditionally — every Quick Pick browses what
    // already exists in this category before offering to create one,
    // matching Home's own job ("what's happening in my life") as distinct
    // from Create's ("what can I make happen"). Previously, any category
    // with a StartSomethingModal SUB_OPTIONS entry (only "Dinner") silently
    // skipped this and opened the creation sub-grid instead — that
    // exception is closed; every chip now behaves the same way.
    // GatheringsScreen's own filtered-empty-state carries the "+ Start a
    // {category} Gathering" fallback, so the creation path isn't lost,
    // just reordered to after browsing turns up nothing.
    //
    // Category alone is a broad, ~25-tag bucket (e.g. "Sports") — a chip
    // whose label is more specific than that (e.g. "Beach Volleyball")
    // also carries a real `searchTerm`, layered on as a real indexed text
    // search alongside the category filter so the result is an actual
    // narrower match, not just every gathering in the broad category.
    navigation.navigate('Gatherings', {
      initialCategoryFilter: item.category,
      initialDateFilter: PERIOD_DATE_FILTER[period],
      initialSearchQuery: item.searchTerm,
    });
  }

  // Phase 1 of the "Build everything" plan -- taps through to the same
  // real detail screens every other Home section already links to, per
  // the locked design (no new destination screens for this section).
  function handleRecommendationTap(item) {
    if (item.type === 'gathering') {
      navigation.navigate('GatheringDetail', { gatheringId: item.id });
    } else if (item.type === 'perk') {
      navigation.navigate('BrandOffers', { highlightOfferId: item.id });
    }
  }

  async function saveQuickPicks(categories) {
    setQuickPicksEditVisible(false);
    setPinnedQuickPicks(categories);
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) await supabase.from('profiles').update({ home_quick_pick_categories: categories }).eq('id', myId);
  }

  async function resetQuickPicksToAuto() {
    setQuickPicksEditVisible(false);
    setPinnedQuickPicks(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) await supabase.from('profiles').update({ home_quick_pick_categories: null }).eq('id', myId);
  }

  // Routes a classified intent straight to its creation screen -- the
  // Phase 1a behavior, now only reached (a) for community/business_partner
  // intents, which the resolver doesn't apply to, or (b) once Phase 1b's
  // resolver has already checked Tiers 1/3 and genuinely found nothing.
  function proceedToCreation(result, typedText, submissionId) {
    routeClassifiedIntentToCreation(navigation, result, typedText);
    // Only a real "no existing supply matched, I'm creating something new"
    // moment counts as a trackable intent outcome -- a business_partner
    // proposal has no existing-supply concept to have checked against, so
    // it's not part of this loop.
    if (result.intent !== 'business_partner') {
      recordIntentSelection({
        rawText: typedText,
        category: result.category ?? null,
        dateWindow: result.dateWindow ?? null,
        resultType: 'created_new',
        resultId: null,
        resultTitle: result.title ?? typedText,
        submissionId,
      });
    }
    setIntentText('');
    setIntentResults(null);
  }

  // A submitted intent checks every real existing fulfillment path before
  // ever falling through to creation. business_partner intents skip
  // resolution entirely -- "propose a specific business as a sponsor" has
  // no existing-supply concept to check. gathering/unclear intents go
  // through resolveIntent() (services/intentResolver.js -- gatherings,
  // communities the caller belongs to, friends/matches with a compatible
  // open ask, perks, and a business's own live posted availability),
  // ranked by one shared relevance score, not a fixed priority order --
  // see PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md, which
  // found and closed the gap where a rigid tier order let a handful of
  // loosely-matching gatherings silently starve out a better-fitting perk
  // or business availability posting. community intents go through the
  // dedicated resolveCommunityIntent() -- previously this branch skipped
  // resolution outright and went straight to creation, a real, confirmed
  // logic bug: it meant "I want to start a run club" would offer to
  // create a duplicate even when a matching community already existed.
  // See CLAUDE.md's "skeptical first-time-user critique" section,
  // recommendation 2, for the full writeup. Only when a resolver
  // genuinely finds nothing does the caller see either the gathering
  // path's "ask nearby businesses fresh, then wait for a real offer"
  // fallback (asynchronous, never framed as a fallback after "the real
  // options" failed) or, for a community intent, proceed straight to
  // creation -- asking a business to sponsor an as-yet-nonexistent
  // community doesn't make sense, so that path has no business-ask step.
  async function handleHomeIntentSubmit(overrideText) {
    const typedText = (overrideText ?? intentText).trim();
    if (!typedText) return;
    if (overrideText) setIntentText(overrideText);
    setIntentThinking(true);
    setIntentPhase({ phase: 'understanding' });
    setIntentResults(null);
    setIntentEmptyFallback(null);
    setSurprise(null);
    try {
      const result = await classifyCreateRequest(typedText);
      setIntentPhase({ phase: 'finding', classifyResult: result });
      if (result.intent === 'business_partner') {
        // No existing-supply concept to check for a business-partner
        // proposal -- logged for the funnel's own intent_kind breakdown,
        // but never counted as "had a result" or "reached fallback."
        const submissionId = await recordIntentSubmission({
          rawText: typedText, category: result.category ?? null, dateWindow: result.dateWindow ?? null,
          intentKind: 'business_partner', hadAnyResult: false, reachedBusinessFallback: false,
        });
        proceedToCreation(result, typedText, submissionId);
      } else if (result.intent === 'community') {
        const resolved = await resolveCommunityIntent({ category: result.category, rawText: typedText });
        const submissionId = await recordIntentSubmission({
          rawText: typedText, category: result.category ?? null, dateWindow: result.dateWindow ?? null,
          intentKind: 'community', hadAnyResult: resolved.length > 0, reachedBusinessFallback: false,
        });
        if (resolved.length > 0) {
          setIntentResults({ items: resolved, classifyResult: result, typedText, submissionId });
        } else {
          proceedToCreation(result, typedText, submissionId);
        }
      } else {
        // Intent engine vision -- Experiences assembly, first increment
        // (2026-09-10): resolveIntent() now also returns `experience`, a
        // pure regrouping of these same candidates into a real cross-
        // category "recommendation recipe" section (assembleExperience(),
        // experienceAssembly.js) -- null whenever there's no real occasion,
        // no template for it, or no genuine matching inventory.
        const { items: resolved, experience } = await resolveIntent({ category: result.category, dateWindow: result.dateWindow, rawText: typedText, partySize: result.partySize ?? null, priceLevel: result.priceLevel ?? null, partyType: result.partyType ?? null, attributes: result.attributes ?? [], cuisine: result.cuisine ?? null, occasion: result.occasion ?? null });
        // P1 remediation (CLAUDE.md, Aug 28 Full Coherence Audit,
        // Scenario D): a real, deterministic person-shaped-phrase check,
        // never a fabricated resolver candidate -- appends one honest
        // "go meet people" action alongside whatever real gatherings/
        // communities/etc. resolveIntent() already found. Counting this
        // toward hadAnyResult (and so skipping the "ask nearby
        // businesses" fallback) is deliberate: a person-search ask has no
        // honest business-ask shape, matching the no-stranger-discovery
        // principle everywhere else this app already enforces.
        const items = detectFriendDiscoveryIntent(typedText)
          ? [...resolved, buildFriendDiscoveryResultItem(result.category)]
          : resolved;
        const submissionId = await recordIntentSubmission({
          rawText: typedText, category: result.category ?? null, dateWindow: result.dateWindow ?? null,
          intentKind: result.intent, hadAnyResult: items.length > 0, reachedBusinessFallback: items.length === 0,
          partySize: result.partySize ?? null,
        });
        if (items.length > 0) {
          setIntentResults({ items, experience, classifyResult: result, typedText, submissionId });
        } else {
          setIntentEmptyFallback({ classifyResult: result, typedText, submissionId });
        }
      }
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    }
    setIntentThinking(false);
  }

  function handleIntentResultTap(item) {
    const { classifyResult, typedText, submissionId } = intentResults ?? {};
    setIntentResults(null);
    recordIntentSelection({
      rawText: typedText,
      category: classifyResult?.category ?? null,
      dateWindow: classifyResult?.dateWindow ?? null,
      resultType: item.type,
      resultId: item.id ?? null,
      resultTitle: item.title,
      submissionId,
    });
    // Item 39 (CLAUDE.md): this per-type routing switch used to be
    // inlined here -- extracted to navigateToIntentResultItem()
    // (intentResolver.js) so Discover's own search box, which needed the
    // identical routing (a gathering result always lands on
    // GatheringDetail regardless of which search box found it), doesn't
    // hand-roll a second copy that could quietly drift from this one.
    navigateToIntentResultItem(navigation, item, { typedText, classifyResult });
  }

  // Extracted so the multi-option grouped view (layer 4) and the
  // original flat view can share the exact same per-item rendering,
  // including the friend_request row's two-action treatment -- no
  // behavior duplicated or drifted between the two layouts.
  function renderIntentResultItem(item, index) {
    // Item 125 ("Make 'Nearby found this for you' visually recognizable"): the single real
    // top-scored item of an already relevance-sorted list (resolveIntent() sorts by real score
    // before this ever renders) gets the "✨ Nearby Pick" badge -- index === 0 only, and only on
    // real discovered supply, never a relationship-status item (friend_request) or the synthetic
    // friend_discovery fallback appended after real results, neither of which is a scored "pick."
    const isTopPick = index === 0 && item.type !== 'friend_request' && item.type !== 'friend_discovery';
    if (item.type === 'friend_request') {
      return (
        <View key={`${item.type}-${item.id}`} style={styles.intentResultRow}>
          <Ionicons
            name={INTENT_RESULT_ICONS[item.type]}
            size={18}
            color={colors.primary}
            style={styles.intentResultIcon}
          />
          <View style={styles.intentResultTextCol}>
            <Text style={styles.intentResultTitle} numberOfLines={1}>{item.title}</Text>
            {item.subtitle ? <Text style={styles.intentResultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
            <View style={styles.friendRequestActions}>
              <TouchableOpacity onPress={() => handleIntentResultTap(item)} accessibilityLabel="View Profile" accessibilityRole="button">
                <Text style={styles.friendRequestActionText}>View Profile</Text>
              </TouchableOpacity>
              {item.matchId && (
                <TouchableOpacity
                  onPress={() => {
                    const { classifyResult, typedText, submissionId } = intentResults ?? {};
                    setIntentResults(null);
                    recordIntentSelection({
                      rawText: typedText,
                      category: classifyResult?.category ?? null,
                      dateWindow: classifyResult?.dateWindow ?? null,
                      resultType: item.type,
                      resultId: item.id ?? null,
                      resultTitle: item.title,
                      submissionId,
                    });
                    navigation.navigate('Chat', { matchId: item.matchId });
                  }}
                  accessibilityLabel="Message"
                  accessibilityRole="button"
                >
                  <Text style={styles.friendRequestActionTextPrimary}>Message</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      );
    }
    return (
      <TouchableOpacity
        key={`${item.type}-${item.id}`}
        style={styles.intentResultRow}
        onPress={() => handleIntentResultTap(item)}
      >
        <Ionicons
          name={INTENT_RESULT_ICONS[item.type] ?? 'people-outline'}
          size={18}
          color={colors.primary}
          style={styles.intentResultIcon}
        />
        <View style={styles.intentResultTextCol}>
          {isTopPick && <NearbyPickBadge />}
          <Text style={styles.intentResultTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? (
            <Text
              style={[styles.intentResultSubtitle, item.isFull && { color: colors.danger }]}
              numberOfLines={1}
            >
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  }

  function handleIntentResultsDismiss() {
    setIntentResults(null);
    setIntentEmptyFallback(null);
    setIntentText('');
  }

  // "Surprise Me" (critique item 28) -- runs entirely off the locked-spec
  // quick-picker (When/Mood), never free text. Dismisses any in-progress
  // typed-ask results first so the two result blocks never show at once.
  async function handleSurpriseSubmit({ when, mood }) {
    setIntentResults(null);
    setIntentEmptyFallback(null);
    setSurprise(null);
    setSurpriseLoading(true);
    try {
      const { suggestion, pool, connectedPeople, connectedPerson, calendarHint } = await runSurpriseMe({ when, mood });
      if (!suggestion) {
        setSurprise({ when, mood, suggestion: null, pool, connectedPeople, connectedPerson: null, calendarHint, shown: new Set() });
        return;
      }
      setSurprise({
        when,
        mood,
        suggestion,
        pool,
        connectedPeople,
        connectedPerson,
        calendarHint,
        shown: new Set(suggestionCandidateKeys(suggestion)),
      });
    } catch (e) {
      console.error('runSurpriseMe failed', e);
      setSurprise({ when, mood, suggestion: null, pool: [], connectedPeople: [], connectedPerson: null, calendarHint: null, shown: new Set() });
    } finally {
      setSurpriseLoading(false);
    }
  }

  // Re-rolls within the pool already fetched for this Surprise Me tap --
  // only re-fetches (a fresh runSurpriseMe call, same when/mood) when that
  // real pool is genuinely exhausted, per the locked spec. Never fabricates
  // an alternative.
  async function handleSurpriseShuffle() {
    if (!surprise) return;
    const next = pickNextFromPool(surprise.pool, surprise.shown);
    if (next) {
      const connectedPerson = findConnectedPerson(next, surprise.connectedPeople);
      setSurprise((prev) => ({
        ...prev,
        suggestion: next,
        connectedPerson,
        shown: new Set([...prev.shown, ...suggestionCandidateKeys(next)]),
      }));
      return;
    }
    setSurpriseLoading(true);
    try {
      const { suggestion, pool, connectedPeople, connectedPerson, calendarHint } = await runSurpriseMe({ when: surprise.when, mood: surprise.mood });
      setSurprise({
        when: surprise.when,
        mood: surprise.mood,
        suggestion,
        pool,
        connectedPeople,
        connectedPerson: suggestion ? connectedPerson : null,
        calendarHint,
        shown: suggestion ? new Set(suggestionCandidateKeys(suggestion)) : new Set(),
      });
    } catch (e) {
      console.error('runSurpriseMe re-fetch failed', e);
    } finally {
      setSurpriseLoading(false);
    }
  }

  function handleSurpriseDismiss() {
    setSurprise(null);
  }

  // Mirrors handleIntentResultTap's own navigation branches, restricted to
  // the types Surprise Me can ever suggest (SURPRISE_ELIGIBLE_TYPES in
  // surpriseMeLogic.js) -- no classifyResult/typedText exists here since
  // this never went through a typed ask, so prefillText is honestly left
  // blank rather than inventing what the user "asked for."
  function handleSurpriseResultTap(item) {
    setSurprise(null);
    if (item.type === 'gathering') {
      navigation.navigate('GatheringDetail', { gatheringId: item.id });
    } else if (item.type === 'perk') {
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('BrandOffers', { highlightOfferId: item.id });
    } else if (item.type === 'community') {
      navigation.navigate('CommunityDetail', { communityId: item.id });
    } else if (item.type === 'business_availability') {
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('AskBusiness', {
        prefillText: '',
        prefillCategory: item.category ?? null,
        prefillDateWindow: surprise?.when ?? null,
        prefillOccasion: surprise?.mood ? moodToParams(surprise.mood).occasion : null,
        matchedAvailability: item.matchedAvailability ?? null,
      });
    } else if (item.type === 'business_policy_match') {
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('AskBusiness', {
        prefillText: '',
        prefillCategory: item.category ?? null,
        prefillDateWindow: surprise?.when ?? null,
      });
    }
  }

  async function handleOutcomeAnswer(outcome) {
    if (!outcomePrompt || outcomeSubmitting) return;
    setOutcomeSubmitting(true);
    try {
      await recordIntentOutcome(outcomePrompt.id, { outcome });
    } catch (e) {
      console.error('recordIntentOutcome failed', e);
    }
    setOutcomePrompt(null);
    setOutcomeSubmitting(false);
  }

  async function handleOutcomeDismiss() {
    if (!outcomePrompt) return;
    const id = outcomePrompt.id;
    setOutcomePrompt(null);
    try {
      await dismissIntentOutcomePrompt(id);
    } catch (e) {
      console.error('dismissIntentOutcomePrompt failed', e);
    }
  }

  // Same explicit-dismiss-only shape as DiscoveryScreen's own
  // dismissBrowseCallout() -- marked seen only once the user actually
  // acknowledges it, not silently on first render.
  async function handleDismissFirstRunMoment() {
    setSeenFirstRunMoment(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) await supabase.from('profiles').update({ seen_home_first_run_moment: true }).eq('id', myId);
  }

  function handlePredictiveAct() {
    if (!predictivePattern) return;
    const category = predictivePattern.category;
    const dismissKey = `predictive_dismiss_${new Date().toDateString()}_${predictivePattern.category}_${predictivePattern.period}`;
    setPredictivePattern(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', category);
    handleHomeIntentSubmit(category);
  }

  function handlePredictiveDismiss() {
    if (!predictivePattern) return;
    const dismissKey = `predictive_dismiss_${new Date().toDateString()}_${predictivePattern.category}_${predictivePattern.period}`;
    const category = predictivePattern.category;
    setPredictivePattern(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'dismissed', category);
  }

  function handleGroupIntentAct() {
    if (!groupIntentSignal) return;
    const dismissKey = `group_intent_dismiss_${new Date().toDateString()}_${groupIntentSignal.category}_${groupIntentSignal.request_count}`;
    const category = groupIntentSignal.category;
    setGroupIntentSignal(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('group_intent', 'acted', category);
    handleHomeIntentSubmit(category);
  }

  function handleGroupIntentDismiss() {
    if (!groupIntentSignal) return;
    const dismissKey = `group_intent_dismiss_${new Date().toDateString()}_${groupIntentSignal.category}_${groupIntentSignal.request_count}`;
    const category = groupIntentSignal.category;
    setGroupIntentSignal(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('group_intent', 'dismissed', category);
  }

  // "The Plan Engine" Phase 1 (CLAUDE.md) -- deliberately does NOT go
  // through handleHomeIntentSubmit/resolveIntent the way the two nudges
  // above do: this is a real creation intent from the moment it's tapped
  // (a birthday isn't "existing supply" to check against first), so it
  // navigates straight to gathering creation with an honest prefilled
  // title -- never auto-submits, never guesses a date/time.
  async function handleDiningDismiss() {
    setDiningNudge(false);
    setDiningModalVisible(false);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (uid) AsyncStorage.setItem(`dining_prompt_dismissed_${uid}`, '1').catch(() => {});
  }

  function handleBirthdayAct() {
    if (!birthdayNudge) return;
    const dismissKey = `birthday_dismiss_${new Date().toDateString()}_${birthdayNudge.connection_id}`;
    setBirthdayNudge(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'birthday');
    navigation.navigate('CreateGathering', { quickStartTitle: `${birthdayNudge.display_name}'s Birthday` });
  }

  function handleBirthdayDismiss() {
    if (!birthdayNudge) return;
    const dismissKey = `birthday_dismiss_${new Date().toDateString()}_${birthdayNudge.connection_id}`;
    setBirthdayNudge(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'dismissed', 'birthday');
  }

  // Phase H (CLAUDE.md) -- same "navigate straight to gathering creation
  // with an honest prefilled title, never auto-submit" posture as the
  // birthday nudge. Unlike a birthday (a bare display_name, no freeform
  // title), an occasion's own title is real, user-authored text (e.g.
  // "Our Anniversary") -- used verbatim, never re-templated.
  function handleOccasionAct() {
    if (!occasionNudge) return;
    const dismissKey = `occasion_dismiss_${new Date().toDateString()}_${occasionNudge.occasion_id}`;
    setOccasionNudge(null);
    setOccasionRecall(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'occasion');
    navigation.navigate('CreateGathering', { quickStartTitle: occasionNudge.title });
  }

  function handleOccasionDismiss() {
    if (!occasionNudge) return;
    const dismissKey = `occasion_dismiss_${new Date().toDateString()}_${occasionNudge.occasion_id}`;
    setOccasionNudge(null);
    setOccasionRecall(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'dismissed', 'occasion');
  }

  // Item 104 (CLAUDE.md): routes a tapped "Upcoming in Your World" row
  // into the Occasion wizard, pre-filled -- same real who_for-resolution
  // shape notifications.js's own occasion_upcoming tap routing already
  // uses (a real connected friend id wins, else a hand-typed name, else
  // occasion-only). No dismiss/suppression here -- this is a standing
  // preview list, not a one-shot nudge.
  function handlePlanFromUpcomingWorldItem(item) {
    if (!item) return;
    recordNudgeEvent('predictive', 'acted', 'upcoming_world');
    navigation.navigate('CelebrateSomething', {
      initialOccasion: item.occasionType,
      initialWhoFor: item.whoForFriendId ? 'friend' : item.whoForName ? (item.occasionType === 'birthday' ? 'family' : 'someone_else') : 'me',
      initialWhoForName: item.whoForName ?? null,
      initialWhoForFriendId: item.whoForFriendId ?? null,
    });
  }

  // Item 101 (CLAUDE.md, "Occasions can become recurring"): the real
  // "return to last year's place" action -- MakeAPlanScreen's existing
  // partnerId mode already does exactly this (a real plan at that exact
  // business), no new creation primitive needed.
  function handleOccasionRecallReturn() {
    if (!occasionNudge || !occasionRecall || occasionRecall.planType !== 'business') return;
    const dismissKey = `occasion_dismiss_${new Date().toDateString()}_${occasionNudge.occasion_id}`;
    const params = { partnerId: occasionRecall.partnerId, initialTitle: occasionNudge.title };
    setOccasionNudge(null);
    setOccasionRecall(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'occasion_recall_return');
    navigation.navigate('MakeAPlan', params);
  }

  // The real "try something new" action -- lands on the same Occasion
  // wizard a tapped occasion_upcoming push already uses (notifications.js),
  // pre-seeded with the real occasion/who-for so the wizard's own live
  // resolveIntent() options step runs a fresh search (whoForPreferenceBonus
  // still gently favors what's already known to fit, never excludes
  // anything else) instead of reusing last year's business unconditionally.
  function handleOccasionRecallNew() {
    if (!occasionNudge) return;
    const dismissKey = `occasion_dismiss_${new Date().toDateString()}_${occasionNudge.occasion_id}`;
    const params = {
      initialOccasion: occasionNudge.occasion_type,
      initialWhoFor: occasionNudge.who_for_friend_id ? 'friend' : occasionNudge.who_for_name ? 'someone_else' : 'me',
      initialWhoForName: occasionNudge.who_for_name,
      initialWhoForFriendId: occasionNudge.who_for_friend_id,
    };
    setOccasionNudge(null);
    setOccasionRecall(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'occasion_recall_new');
    navigation.navigate('CelebrateSomething', params);
  }

  // Item 102 (CLAUDE.md, "Businesses can participate in recurring
  // occasions"): the consumer's own real, explicit, per-occasion consent
  // that the business behind this recall may recognize them next time --
  // default OFF, and only ever meaningful right where the recall itself is
  // shown, since that's the one business it applies to. Optimistic local
  // update, same pattern as every other toggle in this screen.
  function handleToggleRecallShareable() {
    if (!occasionNudge || !occasionRecall || occasionRecall.planType !== 'business') return;
    const next = !occasionRecall.recall_shareable_with_business;
    setOccasionRecall((prev) => (prev ? { ...prev, recall_shareable_with_business: next } : prev));
    setOccasionRecallShareable(occasionNudge.occasion_id, next).then((ok) => {
      if (!ok) setOccasionRecall((prev) => (prev ? { ...prev, recall_shareable_with_business: !next } : prev));
    });
  }

  // "The Plan Engine" Phase 2 (CLAUDE.md) -- deliberately does NOT submit
  // or create anything itself. GatheringDetailScreen's own existing
  // 4-state host banner already owns the real decision/submit step; this
  // nudge's only job is surfacing that it's still pending.
  function handleVenueNeededAct() {
    if (!venueNeededGathering) return;
    const dismissKey = `venue_needed_dismiss_${new Date().toDateString()}_${venueNeededGathering.id}`;
    const gatheringId = venueNeededGathering.id;
    setVenueNeededGathering(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'venue_needed');
    navigation.navigate('GatheringDetail', { gatheringId });
  }

  function handleVenueNeededDismiss() {
    if (!venueNeededGathering) return;
    const dismissKey = `venue_needed_dismiss_${new Date().toDateString()}_${venueNeededGathering.id}`;
    setVenueNeededGathering(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'dismissed', 'venue_needed');
  }

  // "The Plan Engine" Phase 3 (CLAUDE.md) -- deliberately does NOT nudge
  // the invitee or resend anything itself. GatheringDetailScreen's own
  // existing "Manage attendees"/"Invite friends" host-banner links already
  // own the real follow-up action; this nudge's only job is surfacing that
  // real invites are still unanswered.
  function handleRsvpsOutstandingAct() {
    if (!rsvpsOutstandingGathering) return;
    const dismissKey = `rsvps_dismiss_${new Date().toDateString()}_${rsvpsOutstandingGathering.id}`;
    const gatheringId = rsvpsOutstandingGathering.id;
    setRsvpsOutstandingGathering(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'acted', 'rsvps_outstanding');
    navigation.navigate('GatheringDetail', { gatheringId });
  }

  function handleRsvpsOutstandingDismiss() {
    if (!rsvpsOutstandingGathering) return;
    const dismissKey = `rsvps_dismiss_${new Date().toDateString()}_${rsvpsOutstandingGathering.id}`;
    setRsvpsOutstandingGathering(null);
    AsyncStorage.setItem(dismissKey, '1').catch(() => {});
    recordNudgeEvent('predictive', 'dismissed', 'rsvps_outstanding');
  }

  // Shared by both "Ask Nearby Businesses" entry points (the empty-fallback
  // panel, and -- per CLAUDE.md's C1 -- the non-empty ranked-results panel
  // too) -- record+navigate only, no state-clearing responsibility of its
  // own, since the two callers clear two different state vars.
  function goAskBusiness({ classifyResult, typedText, submissionId }) {
    recordIntentSelection({
      rawText: typedText,
      category: classifyResult.category ?? null,
      dateWindow: classifyResult.dateWindow ?? null,
      resultType: 'created_new',
      resultId: null,
      resultTitle: typedText,
      submissionId,
    });
    navigation.navigate('AskBusiness', {
      prefillText: typedText,
      prefillCategory: classifyResult.category ?? null,
      prefillPartySize: classifyResult.partySize ?? null,
      prefillBudgetMax: classifyResult.budgetMax ?? null,
      prefillDateWindow: classifyResult.dateWindow ?? null,
      // Intent engine vision, first increment (2026-09-06): create-assistant
      // already extracts this from the same typed text every other prefill
      // field above comes from -- just never threaded through to this
      // screen before. Still only a prefill, same as every field above --
      // AskBusinessScreen's own occasion chips remain fully editable/
      // deselectable, this never silently commits anything.
      prefillOccasion: classifyResult.occasion ?? null,
      prefillSubmissionId: submissionId ?? null,
    });
  }

  function handleAskBusiness() {
    const { classifyResult, typedText, submissionId } = intentEmptyFallback;
    setIntentEmptyFallback(null);
    setIntentText('');
    goAskBusiness({ classifyResult, typedText, submissionId });
  }

  // C1 (CLAUDE.md's "connect existing consumer-intent + business systems"
  // plan): closes the gap where the resolver finding even one weak,
  // unsatisfying match silently closed off the business channel entirely.
  // Reachable from the non-empty ranked-results panel now too, alongside
  // (not instead of) "None of these? Create it yourself".
  function handleAskBusinessFromResults() {
    const { classifyResult, typedText, submissionId } = intentResults ?? {};
    setIntentResults(null);
    setIntentText('');
    goAskBusiness({ classifyResult, typedText, submissionId });
  }

  // Real Place status for a "Your Plans" gathering row (CLAUDE.md, Aug 29
  // 2026, extended Aug 30 2026 with a real staged sub-status -- "N
  // businesses found" / "N offers, choose one" -- instead of one fixed
  // "Finding a venue…" string). 'done' surfaces the real venue name
  // (PlanCard's `venueName` prop wins over its own `hostingPartnerId`
  // lookup); 'pending' surfaces honest real-count in-progress text. A
  // gathering with no entry at all (nothing ever asked) returns undefined,
  // so PlanCard falls back to its existing hostingPartnerId lookup
  // unchanged.
  function venueNameForPlan(gatheringId) {
    const status = planPlaceStatus[gatheringId];
    if (!status) return undefined;
    if (status.state === 'done') return status.venueName;
    return formatPlaceStatusLabel({
      place: 'pending',
      pendingCount: status.pendingCount ?? 0,
      offeredCount: status.offeredCount ?? 0,
    });
  }

  const quickPicks = pinnedQuickPicks && pinnedQuickPicks.length > 0
    ? getPinnedQuickPicks(pinnedQuickPicks, period, categoryStyleFor)
    : getPersonalizedQuickPicks(period, dashboard?.becauseYouLikeCategories, categoryStyleFor);
  const quickPicksAreCustom = pinnedQuickPicks && pinnedQuickPicks.length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={styles.loadingText}>Finding what's happening near you...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your home feed." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        // paddingBottom must clear the fixed "+ Start Something" FAB below
        // (position: absolute, pinned bottom-right) -- at xxl*2 the FAB
        // overlapped the tail end of the "Continue Browsing" button once
        // scrolled all the way down; xxl*3 leaves real breathing room.
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 3 }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{getGreeting()}{myName ? `, ${myName}` : ''} 👋</Text>
            <Text style={styles.subtitle}>{PERIOD_SUBTITLES[period]}</Text>
          </View>
          <TabHeaderActions navigation={navigation} />
        </View>

        {homeLoadNotice([...(dashboard?.loadFailures ?? []), ...(offersLoadFailed ? ['offers'] : [])]) && (
          <View style={styles.outcomePromptCard}>
            <Text style={styles.outcomePromptText}>{homeLoadNotice([...(dashboard?.loadFailures ?? []), ...(offersLoadFailed ? ['offers'] : [])])}</Text>
            <TouchableOpacity style={styles.predictiveActButton} onPress={onRefresh} accessibilityLabel="Try loading Home again" accessibilityRole="button">
              <Text style={styles.predictiveActButtonText}>Try again →</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.intentSection, shadow.card]}>
          <Text style={styles.intentHeading}>What do you want to do?</Text>
          <View style={styles.intentInputRow}>
            <TextInput
              style={styles.intentInput}
              placeholder={intentPlaceholder}
              placeholderTextColor={colors.textTertiary}
              value={intentText}
              onChangeText={setIntentText}
              onSubmitEditing={handleHomeIntentSubmit}
              returnKeyType="go"
              accessibilityLabel="What do you want to do?"
            />
            <TouchableOpacity
              style={[styles.intentButton, shadow.button, (intentThinking || !intentText.trim()) && styles.intentButtonDisabled]}
              onPress={handleHomeIntentSubmit}
              disabled={intentThinking || !intentText.trim()}
              accessibilityLabel="Find it"
              accessibilityRole="button"
            >
              {intentThinking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.intentButtonText}>Find it</Text>}
            </TouchableOpacity>
          </View>

          {/* "Surprise Me" (critique item 28) -- a small, visually
              secondary action beside the ask box, never a filled button
              competing with "Find it" above. Text-link-weight, same
              treatment intentResultsCreateNew already uses for a real
              coral-colored but visually secondary action on this screen. */}
          {!intentResults && !intentEmptyFallback && !surprise && !surpriseLoading && (
            <TouchableOpacity
              style={styles.surpriseMeLink}
              onPress={() => setSurpriseSheetVisible(true)}
              accessibilityLabel="Surprise Me"
              accessibilityRole="button"
            >
              <Text style={styles.surpriseMeLinkText}>✨ Surprise Me</Text>
            </TouchableOpacity>
          )}

          {intentThinking && (
            <View style={styles.intentResults}>
              <NLoader fullScreen={false} size="compact" caption={intentPhaseCaption(intentPhase?.phase ?? 'understanding', intentPhase?.classifyResult)} />
            </View>
          )}

          {surpriseLoading && (
            <View style={styles.intentResults}>
              <NLoader fullScreen={false} size="compact" kind="recommendations" />
            </View>
          )}

          {surprise && !surpriseLoading && (
            <View style={styles.intentResults}>
              {!surprise.suggestion ? (
                <>
                  <Text style={styles.intentResultsHeading}>Nothing real to suggest right now</Text>
                  <TouchableOpacity onPress={handleSurpriseDismiss}>
                    <Text style={styles.intentResultsDismiss}>Try something else</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {surprise.suggestion.kind === 'experience' ? (
                    <View style={{ marginBottom: spacing.sm }}>
                      <Text style={styles.intentResultsHeading}>{surprise.suggestion.experience.title}</Text>
                      {(surprise.suggestion.experience.bundles ?? []).map((bundle) => (
                        <View key={bundle.id} style={{ marginBottom: spacing.sm }}>
                          <Text style={styles.intentGroupLabel}>
                            ✨ One place has it all: {bundle.componentLabels.join(' + ')}
                          </Text>
                          <TouchableOpacity style={styles.intentResultRow} onPress={() => handleSurpriseResultTap(bundle)}>
                            <Ionicons name={INTENT_RESULT_ICONS[bundle.type] ?? 'sparkles-outline'} size={18} color={colors.primary} style={styles.intentResultIcon} />
                            <View style={styles.intentResultTextCol}>
                              <Text style={styles.intentResultTitle} numberOfLines={1}>{bundle.title}</Text>
                              {bundle.subtitle ? <Text style={styles.intentResultSubtitle} numberOfLines={1}>{bundle.subtitle}</Text> : null}
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {surprise.suggestion.experience.components.map((component) => (
                        <View key={component.key} style={{ marginBottom: spacing.sm }}>
                          <Text style={styles.intentGroupLabel}>{component.label}</Text>
                          {component.items.map((item) => (
                            <React.Fragment key={`${item.type}-${item.id}`}>
                            <TouchableOpacity style={styles.intentResultRow} onPress={() => handleSurpriseResultTap(item)}>
                              <Ionicons name={INTENT_RESULT_ICONS[item.type] ?? 'sparkles-outline'} size={18} color={colors.primary} style={styles.intentResultIcon} />
                              <View style={styles.intentResultTextCol}>
                                <Text style={styles.intentResultTitle} numberOfLines={1}>{item.title}</Text>
                                {item.subtitle ? <Text style={styles.intentResultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                              </View>
                              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                            </TouchableOpacity>
                            <ExperiencePerkLine item={item} />
                            </React.Fragment>
                          ))}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.surpriseCard}>
                      <View style={styles.intentResultRow}>
                        <Ionicons
                          name={INTENT_RESULT_ICONS[surprise.suggestion.candidate.type] ?? 'sparkles-outline'}
                          size={20}
                          color={colors.primary}
                          style={styles.intentResultIcon}
                        />
                        <View style={styles.intentResultTextCol}>
                          <Text style={styles.intentResultTitle}>{surprise.suggestion.candidate.title}</Text>
                          {surprise.suggestion.candidate.subtitle ? (
                            <Text style={styles.intentResultSubtitle}>{surprise.suggestion.candidate.subtitle}</Text>
                          ) : null}
                        </View>
                      </View>
                      {/* People/privacy hard rule (locked spec item 2): only
                          ever a real connected friend/match with a genuine,
                          verifiable interest overlap -- never a stranger,
                          never forced. */}
                      {surprise.connectedPerson && (
                        <Text style={styles.surpriseConnectedText}>
                          You could go with {surprise.connectedPerson.name} 👋
                        </Text>
                      )}
                    </View>
                  )}
                  {/* Item 75 (CLAUDE.md): a real, best-effort calendar
                      signal -- only ever rendered when the user has
                      already opted in to calendar integration elsewhere
                      (OccasionsScreen) and a genuine near-term event
                      exists. Purely informational context, never a gate
                      on the suggestion itself. */}
                  {surprise.calendarHint && (
                    <Text style={styles.surpriseConnectedText}>
                      📅 You also have "{surprise.calendarHint.title}" coming up ({surprise.calendarHint.dateLabel})
                    </Text>
                  )}
                  <View style={styles.surpriseActionsRow}>
                    {surprise.suggestion.kind === 'candidate' && (
                      <TouchableOpacity
                        style={styles.surpriseViewButton}
                        onPress={() => handleSurpriseResultTap(surprise.suggestion.candidate)}
                        accessibilityLabel={
                          surprise.suggestion.candidate.type === 'business_availability'
                          || surprise.suggestion.candidate.type === 'business_policy_match'
                            ? 'Plan This' : 'View'
                        }
                        accessibilityRole="button"
                      >
                        <Text style={styles.surpriseViewButtonText}>
                          {surprise.suggestion.candidate.type === 'business_availability'
                            || surprise.suggestion.candidate.type === 'business_policy_match'
                            ? 'Plan This' : 'View'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.surpriseShuffleButton}
                      onPress={handleSurpriseShuffle}
                      accessibilityLabel="Shuffle Again"
                      accessibilityRole="button"
                    >
                      <Text style={styles.surpriseShuffleButtonText}>🔀 Shuffle Again</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={handleSurpriseDismiss}>
                    <Text style={styles.intentResultsDismiss}>Try something else</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {intentResults && (
            <View style={styles.intentResults}>
              {intentResults.items?.length > 0 && <FoundLine />}
              {intentResults.classifyResult?.intent === 'unclear' && (
                <Text style={styles.intentUnclearNote}>
                  {detectFriendDiscoveryIntent(intentResults.typedText)
                    ? 'Nearby doesn\'t search for individual people directly, but Friend Discovery below is a real, opt-in way to meet someone new — separate from dating.'
                    : 'Nearby doesn\'t search for individual people directly — gatherings and communities are how you meet people here. Here\'s what\'s already happening that might fit.'}
                </Text>
              )}
              {/* Intent engine vision -- cross-category "Experiences"
                  assembly, first increment (2026-09-10): a real, already-
                  scored cross-category "recommendation recipe" section,
                  computed purely by regrouping the same candidates the flat
                  list below already has (assembleExperience(),
                  experienceAssembly.js) -- never a second fetch, never a
                  fabricated combination. Renders only when resolveIntent()
                  found genuine matching inventory for at least one
                  component; a claimed item is filtered out of the flat/
                  grouped list below so it's never shown twice. */}
              {intentResults.experience && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={styles.intentResultsHeading}>{intentResults.experience.title}</Text>
                  {/* Business-side Experience Bundles (2026-09-10): a single
                      business that explicitly declared it covers multiple
                      parts of this exact occasion by itself -- rendered as
                      its own "one business has it all" unit, ahead of the
                      per-component cross-business recipe below, using the
                      same generic renderIntentResultItem every other
                      business_availability result already uses (tapping it
                      still lands on AskBusiness prefilled from this exact
                      posting, unchanged). */}
                  {(intentResults.experience.bundles ?? []).map((bundle) => (
                    <View key={bundle.id} style={{ marginBottom: spacing.sm }}>
                      <Text style={styles.intentGroupLabel}>
                        ✨ One place has it all: {bundle.componentLabels.join(' + ')}
                      </Text>
                      {renderIntentResultItem(bundle)}
                    </View>
                  ))}
                  <ExperienceComponentList
                    experience={intentResults.experience}
                    renderItem={renderIntentResultItem}
                    navigation={navigation}
                    partySize={intentResults.classifyResult?.partySize ?? null}
                    labelStyle={styles.intentGroupLabel}
                  />
                </View>
              )}
              {(() => {
                const claimedIds = intentResults.experience?.claimedIds ?? [];
                const remainingItems = claimedIds.length > 0
                  ? intentResults.items.filter((i) => !claimedIds.includes(i.id))
                  : intentResults.items;
                if (remainingItems.length === 0) return null;
                // Friend Discovery, alone: never framed as "N ways to make
                // this happen" (that heading implies real existing supply,
                // not a navigation action) or as "Already happening near
                // you" (it isn't). Only reachable when resolveIntent()
                // genuinely found nothing else for a person-shaped ask.
                if (remainingItems.length === 1 && remainingItems[0].type === 'friend_discovery') {
                  return (
                    <>
                      <Text style={styles.intentResultsHeading}>{INTENT_RESULT_TYPE_LABELS.friend_discovery}</Text>
                      {renderIntentResultItem(remainingItems[0])}
                    </>
                  );
                }
                const distinctTypes = new Set(remainingItems.map((i) => i.type)).size;
                if (distinctTypes >= 2) {
                  const grouped = groupIntentResultsByType(remainingItems);
                  return (
                    <>
                      <Text style={styles.intentResultsHeading}>
                        I found {grouped.length} ways to make this happen
                      </Text>
                      {grouped.map((group) => (
                        <View key={group.type} style={{ marginBottom: spacing.sm }}>
                          <Text style={styles.intentGroupLabel}>
                            {INTENT_RESULT_TYPE_LABELS[group.type] ?? group.type}
                          </Text>
                          {group.items.map((item, index) => renderIntentResultItem(item, index))}
                        </View>
                      ))}
                    </>
                  );
                }
                return (
                  <>
                    <Text style={styles.intentResultsHeading}>Already happening near you</Text>
                    {remainingItems.map((item, index) => renderIntentResultItem(item, index))}
                  </>
                );
              })()}
              <TouchableOpacity style={styles.askBusinessButton} onPress={handleAskBusinessFromResults}>
                <Ionicons name="storefront-outline" size={18} color="#fff" style={styles.intentResultIcon} />
                <Text style={styles.askBusinessButtonText}>Ask Nearby Businesses</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => proceedToCreation(intentResults.classifyResult, intentResults.typedText, intentResults.submissionId)}>
                <Text style={styles.intentResultsCreateNew}>None of these? Create it yourself →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleIntentResultsDismiss}>
                <Text style={styles.intentResultsDismiss}>Try something else</Text>
              </TouchableOpacity>
            </View>
          )}

          {intentEmptyFallback && (
            <View style={styles.intentResults}>
              {intentEmptyFallback.classifyResult?.intent === 'unclear' && (
                <Text style={styles.intentUnclearNote}>
                  Nearby doesn't search for individual people directly — gatherings and
                  communities are how you meet people here.
                </Text>
              )}
              <Text style={styles.intentResultsHeading}>Nothing already happening for this</Text>
              <TouchableOpacity style={styles.askBusinessButton} onPress={handleAskBusiness}>
                <Ionicons name="storefront-outline" size={18} color="#fff" style={styles.intentResultIcon} />
                <Text style={styles.askBusinessButtonText}>Ask Nearby Businesses</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => proceedToCreation(intentEmptyFallback.classifyResult, intentEmptyFallback.typedText, intentEmptyFallback.submissionId)}>
                <Text style={styles.intentResultsCreateNew}>Or create it yourself →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleIntentResultsDismiss}>
                <Text style={styles.intentResultsDismiss}>Try something else</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Phase 6 of the "Build everything" plan (CLAUDE.md) -- a real,
            one-time first-run demonstration moment. Deliberately not styled
            like intentSection above (the one real hero on this screen, per
            the locked Home-hierarchy work) -- same calm colors.surface/
            colors.border treatment as outcomePromptCard, so it reads as a
            real explanatory card, not a second competing hero. */}
        {seenFirstRunMoment === false && (
          <View style={styles.firstRunCard}>
            {/* Was a header row with both a close icon and, below, a "Got
                it ->" button -- both called the same dismiss handler, no
                real distinction between them. "Got it ->" is the one real
                dismiss action now; the redundant X is gone. */}
            <Text style={styles.firstRunHeading}>👋 This is Nearby</Text>
            {homeRecommendations.length > 0 ? (
              <>
                <Text style={styles.firstRunBody}>
                  We looked at what's real nearby right now — here's {homeRecommendations.length === 1 ? 'what we found' : 'a couple of things we found'}:
                </Text>
                {homeRecommendations.slice(0, 2).map((item) => {
                  const row = recommendationRow(item);
                  return (
                  <View key={`firstrun-${item.type}-${item.id}`} style={styles.firstRunItemRow}>
                    <Text style={styles.firstRunItemIcon}>{item.type === 'perk' ? '🎁' : categoryStyleFor(item.data?.interest_tag).icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.firstRunItemTitle}>{item.title}</Text>
                      {row.why ? <Text style={styles.firstRunItemMeta}>{row.why}</Text> : null}
                      {row.meta ? <Text style={styles.firstRunItemMeta}>{row.meta}</Text> : null}
                    </View>
                  </View>
                  );
                })}
                <Text style={styles.firstRunFooter}>
                  That's the idea — real things nearby, with a real reason attached. Ask for
                  anything up top, or scroll down for more.
                </Text>
              </>
            ) : (
              <Text style={styles.firstRunBody}>
                Nothing real to show you here just yet — as you explore gatherings, communities,
                and perks nearby, Nearby gets smarter about what's actually worth your time.
              </Text>
            )}
            <TouchableOpacity onPress={handleDismissFirstRunMoment} accessibilityLabel="Got it" accessibilityRole="button">
              <Text style={styles.firstRunGotIt}>Got it →</Text>
            </TouchableOpacity>
          </View>
        )}

        {(() => {
          const insight = getHomeInsight(dashboard);
          if (!insight) return null;
          return (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={[styles.insightLine, { marginBottom: insight.basis ? 2 : 0 }]}>{insight.text}</Text>
              {insight.basis ? <Text style={styles.trendingMeta}>{insight.basis}</Text> : null}
              {insight.cta ? (
                <TouchableOpacity
                  style={[styles.rowCta, { alignSelf: 'flex-start', marginTop: spacing.xs }]}
                  onPress={() => navigation.navigate(insight.cta.screen, insight.cta.params)}
                  accessibilityRole="button"
                  accessibilityLabel={`${insight.cta.label}. ${insight.basis ?? ''}`}
                >
                  <Text style={styles.rowCtaText}>{insight.cta.label} →</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })()}

        {(dashboard?.plansGoing?.length > 0 || dashboard?.plansHosting?.length > 0 || dashboard?.plansGroup?.length > 0 || dashboard?.plansInterested?.length > 0) && (
          <>
            {/* Home hierarchy audit recommendation #3 (PRODUCT_AUDIT/
                HOME_VISUAL_HIERARCHY_AUDIT_2026-08-14.md): a real, heavier
                header distinct from the uniform caption-style sectionHeader
                every other section uses -- makes the primary/context split
                from the locked target model visually real, not just implied
                by position below the intent box. */}
            <Text style={styles.primaryHeader}>Your Plans</Text>
            <View style={styles.plansCard}>
              {dashboard.plansGoing.length > 0 && (
                <>
                  <Text style={styles.subLabel}>Going</Text>
                  {dashboard.plansGoing.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      icon={categoryStyleFor(plan.interest_tag).icon}
                      iconColor={categoryStyleFor(plan.interest_tag).color}
                      title={plan.title}
                      dateTimeText={formatHeroDateTime(plan.scheduled_at)}
                      peopleCount={plan.peopleCount}
                      hostingPartnerId={plan.hosting_partner_id}
                      venueName={venueNameForPlan(plan.id)}
                      status={resolveGatheringPlanStatus({ role: 'attending' })}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                    />
                  ))}
                </>
              )}
              {dashboard.plansHosting.length > 0 && (
                <>
                  <Text style={[styles.subLabel, dashboard.plansGoing.length > 0 && styles.subLabelSpaced]}>Hosting</Text>
                  {dashboard.plansHosting.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      icon={categoryStyleFor(plan.interest_tag).icon}
                      iconColor={categoryStyleFor(plan.interest_tag).color}
                      title={plan.title}
                      dateTimeText={formatHeroDateTime(plan.scheduled_at)}
                      peopleCount={plan.peopleCount}
                      hostingPartnerId={plan.hosting_partner_id}
                      venueName={venueNameForPlan(plan.id)}
                      status={resolveGatheringPlanStatus({ role: 'hosting' })}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                    />
                  ))}
                </>
              )}
              {dashboard.plansInterested?.length > 0 && (
                <>
                  <Text style={[styles.subLabel, (dashboard.plansGoing.length > 0 || dashboard.plansHosting.length > 0) && styles.subLabelSpaced]}>Your interest</Text>
                  {dashboard.plansInterested.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      icon={categoryStyleFor(plan.interest_tag).icon}
                      iconColor={categoryStyleFor(plan.interest_tag).color}
                      title={plan.title}
                      roleLabel="Interested"
                      dateTimeText={formatHeroDateTime(plan.scheduled_at)}
                      hostingPartnerId={plan.hosting_partner_id}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                    />
                  ))}
                </>
              )}
              {dashboard.plansGroup?.length > 0 && (
                <>
                  <Text style={[styles.subLabel, (dashboard.plansGoing.length > 0 || dashboard.plansHosting.length > 0 || dashboard.plansInterested?.length > 0) && styles.subLabelSpaced]}>Group Plans</Text>
                  {dashboard.plansGroup.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      icon={categoryStyleFor(plan.category).icon}
                      iconColor={categoryStyleFor(plan.category).color}
                      title={plan.raw_text}
                      dateTimeText={plan.date ? formatHeroDateTime(plan.date) : null}
                      peopleCount={plan.party_size}
                      status={resolveGroupPlanStatus(plan.status)}
                      onPress={() => navigation.navigate('GroupPlan', { proposalId: plan.group_plan_id })}
                    />
                  ))}
                </>
              )}
            </View>
            <TouchableOpacity
              style={styles.seeAllPlansButton}
              onPress={() => navigation.navigate('Plans')}
              accessibilityLabel="See all plans"
              accessibilityRole="button"
            >
              <Text style={styles.seeAllPlansText}>See All Plans →</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Phase 1 of the "Build everything" plan (CLAUDE.md) -- a new,
            genuinely additive section reusing the shared intent-resolver
            scoring axis across gatherings/perks (business availability not
            wired into this section yet, flagged rather than faked --
            Home's existing gathering/perk data was already fetched, a
            business-availability fetch is a real new query this pass
            didn't add). Deliberately not a replacement for Best Pick/
            Trending/Because You Like -- one more section, same data. */}
        {homeRecommendations.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="flash-outline" size={14} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.sectionHeaderText}>Nearby Right Now</Text>
            </View>
            <View style={[styles.plansCard, { marginBottom: spacing.lg }]}>
              {homeRecommendations.map((item) => {
                const row = recommendationRow(item);
                return (
                <TouchableOpacity
                  key={`${item.type}-${item.id}`}
                  style={styles.planRow}
                  onPress={() => handleRecommendationTap(item)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${item.title}, ${[row.why, row.meta].filter(Boolean).join(', ')}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.planIcon}>{item.type === 'perk' ? '🎁' : categoryStyleFor(item.data?.interest_tag).icon}</Text>
                  <View style={styles.planInfo}>
                    <Text style={styles.planTitle}>{item.title}</Text>
                    {row.why ? <Text style={styles.planMeta}>{row.why}</Text> : null}
                    {row.meta ? <Text style={styles.planMeta}>{row.meta}</Text> : null}
                    {item.type === 'gathering' && gatheringFullnessLabel(item.data) && (
                      <Text style={[styles.planMeta, gatheringFullnessLabel(item.data).startsWith('🔒') && { color: colors.danger }]}>
                        {gatheringFullnessLabel(item.data)}
                      </Text>
                    )}
                    {/* Phase 4 (see CLAUDE.md's "build everything" plan):
                        "Make a plan" is deliberately perk-only, not also
                        offered on a gathering-type recommendation — that
                        one already names a real, existing event someone
                        else is running; join (the row's own tap-through
                        above) is the honest one-tap action there, not a
                        second, duplicate gathering. A perk has no event
                        around it yet, which is exactly where creating one
                        is a real value-add. */}
                    {item.type === 'perk' && (
                      <TouchableOpacity
                        onPress={() => navigation.navigate('MakeAPlan', { offerId: item.id })}
                        activeOpacity={0.85}
                        accessibilityLabel={`Make a plan around ${item.title}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.makePlanLink}>📅 Make a plan →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.planChevron}>›</Text>
                </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {(diningNudge || pendingInvitesCount > 0 || perksCount > 0 || socialForecast || outcomePrompt || predictivePattern || groupIntentSignal || birthdayNudge || occasionNudge || pendingPollsCount > 0 || venueNeededGathering || rsvpsOutstandingGathering || (dashboard?.sinceAway && (dashboard.sinceAway.newPeopleCount > 0 || dashboard.sinceAway.newGatheringsCount > 0))) && (
          <View style={{ marginBottom: spacing.md }}>
            {predictivePattern && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    🔮 Want me to find something for {predictivePattern.category.toLowerCase()}?
                  </Text>
                  <TouchableOpacity onPress={handlePredictiveDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[styles.predictiveActButton, intentThinking && styles.intentButtonDisabled]} onPress={handlePredictiveAct} disabled={intentThinking} accessibilityLabel="Find something" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>Yes, find something →</Text>
                </TouchableOpacity>
              </View>
            )}
            {groupIntentSignal && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    👥 {groupIntentSignal.request_count} people you know are looking for {groupIntentSignal.category.toLowerCase()}
                  </Text>
                  <TouchableOpacity onPress={handleGroupIntentDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[styles.predictiveActButton, intentThinking && styles.intentButtonDisabled]} onPress={handleGroupIntentAct} disabled={intentThinking} accessibilityLabel="Find something together" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>Find something for the group →</Text>
                </TouchableOpacity>
              </View>
            )}
            {diningNudge && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>🍽️ Into food? Tell us what you like to eat and we'll find better spots.</Text>
                  <TouchableOpacity onPress={handleDiningDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.predictiveActButton} onPress={() => setDiningModalVisible(true)} accessibilityLabel="Set my tastes" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>Set my tastes →</Text>
                </TouchableOpacity>
              </View>
            )}
            {birthdayNudge && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  {/* Item 123 ("Use 'anticipation' animations"): the literal "Sarah's Birthday /
                      10 days" example -- a subtle, proximity-scaled treatment on just the
                      day-count fragment, not the whole card. */}
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    🎂 {birthdayNudge.display_name}'s birthday is{' '}
                    <AnticipationText daysUntil={birthdayNudge.days_until}>
                      {birthdayNudge.days_until === 0 ? 'today' : birthdayNudge.days_until === 1 ? 'tomorrow' : `in ${birthdayNudge.days_until} days`}
                    </AnticipationText>
                    {' '}— want to plan something?
                  </Text>
                  <TouchableOpacity onPress={handleBirthdayDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.predictiveActButton} onPress={handleBirthdayAct} accessibilityLabel="Plan something" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>Yes, let's plan something →</Text>
                </TouchableOpacity>
              </View>
            )}
            {occasionNudge && occasionRecall?.planType === 'business' && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    {occasionTypeIcon(occasionNudge.occasion_type)} {occasionNudge.title}{' '}
                    <AnticipationText daysUntil={occasionNudge.days_until}>
                      {occasionDueLabel(occasionNudge.date_precision, occasionNudge.occasion_date, occasionNudge.days_until)}
                    </AnticipationText>
                  </Text>
                  <TouchableOpacity onPress={handleOccasionDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                {/* Item 101: a real recall, never fabricated -- every part
                    of this line traces to get_occasion_recall()'s own
                    real resolved data. */}
                <Text style={styles.outcomePromptSubtext} numberOfLines={2}>
                  Nearby remembers: {formatOccasionRecallSummary(occasionRecall)}
                  {occasionRecallLikedText(occasionRecall) ? ` · ${occasionRecallLikedText(occasionRecall)}` : ''}
                </Text>
                <Text style={[styles.outcomePromptText, { marginTop: spacing.xs }]} numberOfLines={2}>
                  Want to return to {occasionRecall.partnerName} or try something new?
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TouchableOpacity
                    style={[styles.predictiveActButton, { flex: 1 }]}
                    onPress={handleOccasionRecallReturn}
                    accessibilityLabel={`Return to ${occasionRecall.partnerName}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.predictiveActButtonText} numberOfLines={1}>🔄 Return to {occasionRecall.partnerName}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.predictiveActButton, { flex: 1 }]}
                    onPress={handleOccasionRecallNew}
                    accessibilityLabel="Try something new"
                    accessibilityRole="button"
                  >
                    <Text style={styles.predictiveActButtonText}>✨ Try Something New</Text>
                  </TouchableOpacity>
                </View>
                {/* Item 102: a real, explicit, opt-in (default OFF)
                    consent -- never inferred from the reservation itself
                    -- that lets THIS specific business recognize a
                    returning customer next time. */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}
                  onPress={handleToggleRecallShareable}
                  accessibilityLabel={`${occasionRecall.recall_shareable_with_business ? 'Stop letting' : 'Let'} ${occasionRecall.partnerName} recognize you next time`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!occasionRecall.recall_shareable_with_business }}
                >
                  <Ionicons
                    name={occasionRecall.recall_shareable_with_business ? 'checkbox' : 'square-outline'}
                    size={16}
                    color={occasionRecall.recall_shareable_with_business ? colors.primary : colors.textTertiary}
                  />
                  <Text style={[styles.outcomePromptSubtext, { marginLeft: spacing.xs, flex: 1 }]} numberOfLines={2}>
                    Let {occasionRecall.partnerName} recognize you as a returning customer next time
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {occasionNudge && occasionRecall?.planType !== 'business' && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    {occasionTypeIcon(occasionNudge.occasion_type)} {occasionNudge.title}{' '}
                    <AnticipationText daysUntil={occasionNudge.days_until}>
                      {occasionDueLabel(occasionNudge.date_precision, occasionNudge.occasion_date, occasionNudge.days_until)}
                    </AnticipationText>
                    {' '}— want to plan something?
                  </Text>
                  <TouchableOpacity onPress={handleOccasionDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.predictiveActButton} onPress={handleOccasionAct} accessibilityLabel="Plan something" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>Yes, let's plan something →</Text>
                </TouchableOpacity>
              </View>
            )}
            {/* Item 104 (CLAUDE.md, "There could eventually be an
                'Occasions' recommendation engine"): a real, forward-
                looking preview -- what's coming up BEYOND the one thing
                already featured above (birthdayNudge/occasionNudge),
                never the same item twice on this screen. Each row is
                directly tappable (richer than the mock's single generic
                "Plan Something" button, consistent with how every other
                summary row in this app already works) -- lands on the
                Occasion wizard pre-filled for that specific item, same
                real routing shape a tapped occasion_upcoming push already
                uses. Purely informational otherwise -- no dismiss, no
                daily suppression, since it's a standing preview, not a
                one-shot nudge. */}
            {upcomingWorldItems.length > 0 && (
              <View style={styles.outcomePromptCard}>
                <Text style={styles.outcomePromptText} numberOfLines={1}>📅 Upcoming in Your World</Text>
                {upcomingWorldItems.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.upcomingWorldRow}
                    onPress={() => handlePlanFromUpcomingWorldItem(item)}
                    accessibilityLabel={`Plan something for ${item.label}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.outcomePromptSubtext} numberOfLines={1}>
                      {formatUpcomingWorldItemParts(item).prefix}
                      {' — '}
                      {/* Item 123 ("Use 'anticipation' animations"): the exact "Sarah's Birthday
                          / 10 days" mock, live here row-by-row. */}
                      <AnticipationText daysUntil={item.daysUntil}>
                        {formatUpcomingWorldItemParts(item).days}
                      </AnticipationText>
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {pendingPollsCount > 0 && (
              <View style={styles.outcomePromptCard}>
                <Text style={styles.outcomePromptText} numberOfLines={2}>
                  💬 Someone you know has a quick question for you
                </Text>
                <TouchableOpacity
                  style={styles.predictiveActButton}
                  onPress={() => navigation.navigate('PreferencePolls')}
                  accessibilityLabel="Answer question"
                  accessibilityRole="button"
                >
                  <Text style={styles.predictiveActButtonText}>Answer it →</Text>
                </TouchableOpacity>
              </View>
            )}
            {venueNeededGathering && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    {venueNeededGathering.requestId
                      ? `🍽️ Still waiting to hear back from local businesses for ${venueNeededGathering.title}`
                      : venueNeededGathering.ask_local_businesses
                        ? `🍽️ You asked us to look for local business options for ${venueNeededGathering.title} — ready to see what's available?`
                        : `📍 ${venueNeededGathering.title} still doesn't have a venue — want Nearby to look for local business options?`}
                  </Text>
                  <TouchableOpacity onPress={handleVenueNeededDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.predictiveActButton} onPress={handleVenueNeededAct} accessibilityLabel="View gathering" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>View Gathering →</Text>
                </TouchableOpacity>
              </View>
            )}
            {rsvpsOutstandingGathering && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    🙋 {rsvpsOutstandingGathering.pendingCount} invite{rsvpsOutstandingGathering.pendingCount === 1 ? '' : 's'} to {rsvpsOutstandingGathering.title}{' '}
                    {rsvpsOutstandingGathering.pendingCount === 1 ? "hasn't" : "haven't"} been answered yet — want to check in?
                  </Text>
                  <TouchableOpacity onPress={handleRsvpsOutstandingDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.predictiveActButton} onPress={handleRsvpsOutstandingAct} accessibilityLabel="View gathering" accessibilityRole="button">
                  <Text style={styles.predictiveActButtonText}>View Gathering →</Text>
                </TouchableOpacity>
              </View>
            )}
            {outcomePrompt && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    How did it go with {outcomePrompt.result_title ?? 'that'}?
                  </Text>
                  <TouchableOpacity onPress={handleOutcomeDismiss} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.outcomePromptRow}>
                  <TouchableOpacity style={styles.outcomePromptButton} onPress={() => handleOutcomeAnswer('great')} disabled={outcomeSubmitting} accessibilityLabel="Great" accessibilityRole="button">
                    <Text style={styles.outcomePromptButtonEmoji}>👍</Text>
                    <Text style={styles.outcomePromptButtonLabel}>Great</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.outcomePromptButton} onPress={() => handleOutcomeAnswer('okay')} disabled={outcomeSubmitting} accessibilityLabel="Okay" accessibilityRole="button">
                    <Text style={styles.outcomePromptButtonEmoji}>😐</Text>
                    <Text style={styles.outcomePromptButtonLabel}>Okay</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.outcomePromptButton} onPress={() => handleOutcomeAnswer('not_for_me')} disabled={outcomeSubmitting} accessibilityLabel="Not for me" accessibilityRole="button">
                    <Text style={styles.outcomePromptButtonEmoji}>👎</Text>
                    <Text style={styles.outcomePromptButtonLabel}>Not for me</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {pendingInvitesCount > 0 && (
              <TouchableOpacity
                style={styles.pendingInvitesBanner}
                onPress={() => navigation.navigate('Activity', { initialSubSection: 'invitations' })}
                activeOpacity={0.85}
                accessibilityLabel={`${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'} and requests`}
                accessibilityRole="button"
              >
                <View style={styles.bannerContent}>
                  <Ionicons name="notifications-outline" size={16} color={colors.primary} style={styles.bannerIcon} />
                  <Text style={styles.pendingInvitesBannerText}>
                    {pendingInvitesCount} pending invite{pendingInvitesCount === 1 ? '' : 's'} &amp; request{pendingInvitesCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={styles.pendingInvitesBannerArrow}>›</Text>
              </TouchableOpacity>
            )}
            {perksCount > 0 && (
              <TouchableOpacity
                style={styles.perksBanner}
                onPress={() => navigation.navigate('BrandOffers')}
                activeOpacity={0.85}
                accessibilityLabel={`${perksCount} perks available to redeem`}
                accessibilityRole="button"
              >
                <View style={styles.bannerContent}>
                  <Ionicons name="gift-outline" size={16} color={colors.primary} style={styles.bannerIcon} />
                  <Text style={styles.perksBannerText}>{perksCount} perk{perksCount === 1 ? '' : 's'} unlocked nearby</Text>
                </View>
                <Text style={styles.perksBannerArrow}>›</Text>
              </TouchableOpacity>
            )}
            {socialForecast && (() => {
              // Weather is a nudge, never a creator (constants/weatherRelevance.js): the card
              // renders only when a structured rule fires AND there is a real, still-upcoming,
              // classified gathering to point at, and never over an active intent/Surprise result.
              const nowMs = Date.now();
              const upcomingOnly = (list) => (list ?? []).filter((g) => new Date(g.scheduled_at).getTime() > nowMs);
              const card = homeWeatherCard({
                weather: socialForecast,
                indoorUpcoming: upcomingOnly(dashboard?.indoorGatheringsToday),
                outdoorUpcoming: upcomingOnly(dashboard?.outdoorGatheringsToday),
                intentActive: intentThinking || !!intentResults || !!surprise,
              });
              if (!card) return null;
              const showIndoor = card.bias === 'indoor';
              const showOutdoor = card.bias === 'outdoor';
              const indoorUpcoming = showIndoor ? card.gatherings : [];
              const outdoorUpcoming = showOutdoor ? card.gatherings : [];
              return (
                <View style={styles.forecastCard}>
                  <View style={styles.forecastLabelRow}>
                    <Ionicons name="partly-sunny-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
                    <Text style={styles.forecastLabel}>Right Now</Text>
                  </View>
                  <Text style={styles.forecastValue}>{card.label}</Text>
                  {!!card.detail && <Text style={styles.forecastDetail}>{card.detail}</Text>}
                  {showIndoor && (
                    <View style={styles.weatherSuggestions}>
                      <View style={styles.weatherSuggestionsHeaderRow}>
                        <Ionicons name="home-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
                        <Text style={styles.weatherSuggestionsHeader}>
                          {indoorUpcoming.length} indoor gathering{indoorUpcoming.length === 1 ? '' : 's'} today
                        </Text>
                      </View>
                      {indoorUpcoming.map((g) => (
                        <TouchableOpacity
                          key={g.id}
                          style={styles.weatherSuggestionRow}
                          onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                          activeOpacity={0.85}
                          accessibilityLabel={`${g.title}, ${formatHeroDateTime(g.scheduled_at)}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.weatherSuggestionIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                          <Text style={styles.weatherSuggestionText} numberOfLines={1}>{g.title}</Text>
                          <Text style={styles.weatherSuggestionTime}>{formatHeroDateTime(g.scheduled_at)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {showOutdoor && (
                    <View style={styles.weatherSuggestions}>
                      <View style={styles.weatherSuggestionsHeaderRow}>
                        <Ionicons name="sunny-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
                        <Text style={styles.weatherSuggestionsHeader}>
                          {outdoorUpcoming.length} outdoor gathering{outdoorUpcoming.length === 1 ? '' : 's'} today
                        </Text>
                      </View>
                      {outdoorUpcoming.map((g) => (
                        <TouchableOpacity
                          key={g.id}
                          style={styles.weatherSuggestionRow}
                          onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                          activeOpacity={0.85}
                          accessibilityLabel={`${g.title}, ${formatHeroDateTime(g.scheduled_at)}`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.weatherSuggestionIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                          <Text style={styles.weatherSuggestionText} numberOfLines={1}>{g.title}</Text>
                          <Text style={styles.weatherSuggestionTime}>{formatHeroDateTime(g.scheduled_at)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}
            {dashboard?.sinceAway && (dashboard.sinceAway.newPeopleCount > 0 || dashboard.sinceAway.newGatheringsCount > 0) && (
              <View style={styles.sinceAwayBanner}>
                <Text style={styles.sinceAwayTitle}>Since you were away</Text>
                {dashboard.sinceAway.newPeopleCount > 0 && (
                  <View style={styles.sinceAwayItemRow}>
                    <Ionicons name="people-outline" size={14} color={colors.textPrimary} style={styles.bannerIcon} />
                    <Text style={styles.sinceAwayItem}>{dashboard.sinceAway.newPeopleCount} new {dashboard.sinceAway.newPeopleCount === 1 ? 'person' : 'people'} nearby</Text>
                  </View>
                )}
                {dashboard.sinceAway.newGatheringsCount > 0 && (
                  <View style={styles.sinceAwayItemRow}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textPrimary} style={styles.bannerIcon} />
                    <Text style={styles.sinceAwayItem}>{dashboard.sinceAway.newGatheringsCount} new gathering{dashboard.sinceAway.newGatheringsCount === 1 ? '' : 's'}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {goalRow.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>What you're here to do</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              {goalRow.map((g) => (
                <TouchableOpacity
                  key={g.key}
                  style={styles.quickActionChip}
                  onPress={() => navigation.navigate(g.route, g.params)}
                  activeOpacity={0.85}
                  accessibilityLabel={g.label}
                  accessibilityRole="button"
                >
                  <Text style={[styles.quickActionIcon, { fontSize: 20 }]}>{g.icon}</Text>
                  <Text style={styles.quickActionLabel}>{g.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <View style={styles.quickPicksHeaderRow}>
          <Text style={styles.sectionHeader}>{quickPicksAreCustom ? 'Quick Picks' : PERIOD_SECTION_LABELS[period]}</Text>
          <TouchableOpacity onPress={() => setQuickPicksEditVisible(true)} accessibilityRole="button" accessibilityLabel="Edit quick picks">
            <Text style={styles.quickPicksEditLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
          {quickPicks.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.quickActionChip}
              onPress={() => handleQuickAction(item)}
              activeOpacity={0.85}
              accessibilityLabel={item.label}
              accessibilityRole="button"
            >
              <Ionicons name={iconNameForCategory(item.category)} size={22} color={colors.primary} style={styles.quickActionIcon} />
              <Text style={styles.quickActionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {locationOff && (
          <View style={styles.quietCard}>
            <Text style={styles.quietTitle}>See what's around you</Text>
            <Text style={styles.quietText}>Turn on location and Nearby will find what's happening near you, right now, today and this weekend.</Text>
            <TouchableOpacity
              onPress={async () => {
                const position = await getUserLocation({ fresh: true, force: true });
                if (position) load();
              }}
              accessibilityLabel="Turn on location"
              accessibilityRole="button"
              style={{ marginTop: spacing.sm }}
            >
              <Text style={styles.browseButtonText}>Turn on location →</Text>
            </TouchableOpacity>
          </View>
        )}

        {startingSoonChips.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="flame-outline" size={14} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.sectionHeaderText}>Starting Soon Near You</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              {startingSoonChips.map((g) => {
                const style = categoryStyleFor(g.interest_tag);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.happeningNowChip, { borderColor: style.color }]}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    activeOpacity={0.85}
                    accessibilityLabel={`${g.title}, ${g.interest_tag ?? 'General'}, happening now${placeDistanceLabel(g.distanceMiles) ? `, ${placeDistanceLabel(g.distanceMiles)}` : ''}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.happeningNowIcon}>{style.icon}</Text>
                    <Text style={styles.happeningNowLabel} numberOfLines={1}>
                      {g.title}
                      {placeDistanceLabel(g.distanceMiles) ? <Text style={styles.happeningNowDistance}>{`  ${placeDistanceLabel(g.distanceMiles)}`}</Text> : null}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {continueCommunities.length > 0 && (
          <>
            <View style={styles.continueCommunityLabelRow}>
              <Ionicons name="business-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.continueCommunityLabel}>Your Communities</Text>
            </View>
            {continueCommunities.map((community) => (
              <TouchableOpacity
                key={community.id}
                style={styles.continueCommunityCard}
                onPress={() => navigation.navigate('CommunityDetail', { communityId: community.id })}
                activeOpacity={0.85}
                accessibilityLabel={`Continue ${community.name}${community.recentMessageCount > 0 ? `, ${community.recentMessageCount} recent messages` : ''}`}
                accessibilityRole="button"
              >
                <Text style={styles.continueCommunityName}>{community.name}</Text>
                {community.recentMessageCount > 0 && (
                  <Text style={styles.continueCommunityDetail}>{community.recentMessageCount} new message{community.recentMessageCount === 1 ? '' : 's'} in the last day</Text>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Home hierarchy audit recommendation #5: a real, minimal label so
            this card doesn't read as unexplained dense content -- same
            caption style every other section already uses. */}
        <Text style={styles.sectionHeader}>Quick Stats</Text>
        <View style={styles.card}>
          {/* Item 41 ("make People about people, not dating"): this count
              is real, but it's a dating-filtered signal (getNearbyMatches()
              in homeDashboard.js) -- this used to route straight to the
              standalone, dating-only DiscoveryScreen ('Nearby'), a walled-
              off destination with no visible Friends option at all, despite
              the plain "people nearby" label implying something more
              general. Now lands on Discover's own real People > Dating|
              Friends toggle instead (same Dating content pre-selected, so
              this is the same real destination as before), with Friends
              one tap away rather than absent.
              Item 60 (CEO test): reworded "N people nearby" -> "N people
              nearby to meet" so this row itself signals the meet/connect
              action instead of reading as a passive stat -- a text-only
              change, keeps the same single-line row style as every other
              Quick Stats row (no new caption line). */}
          <TouchableOpacity
            style={styles.cardRow}
            onPress={() => navigation.navigate('Discover', { initialMode: 'people' })}
            accessibilityLabel={`${countLabel(dashboard?.nearbyPeopleCount ?? 0, 'person', 'people')} nearby to meet, tap to view`}
            accessibilityRole="button"
          >
            <Ionicons name="people-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{countLabel(dashboard?.nearbyPeopleCount ?? 0, 'person', 'people')} nearby to meet</Text>
            {peoplePrimaryAction(dashboard?.nearbyPeopleCount) ? (
              <View style={styles.rowCta}><Text style={styles.rowCtaText}>{peoplePrimaryAction(dashboard.nearbyPeopleCount).label}</Text></View>
            ) : (
              <Text style={styles.cardChevron}>›</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'today' })} accessibilityLabel={`${countLabel(dashboard?.gatheringsTodayCount ?? 0, 'gathering')} today, tap to view`} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{countLabel(dashboard?.gatheringsTodayCount ?? 0, 'gathering')} today</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          {dashboard?.mostRecentSighting && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('ViewProfile', { userId: dashboard.mostRecentSighting.otherUserId })} accessibilityLabel={`You crossed paths with ${dashboard.mostRecentSighting.profiles?.display_name}`} accessibilityRole="button">
                <Ionicons name="location-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
                <Text style={styles.cardText}>Crossed paths with {dashboard.mostRecentSighting.profiles?.display_name}</Text>
                <Text style={styles.cardChevron}>›</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Messages')} accessibilityLabel={`${dashboard?.unreadCount ?? 0} unread messages, tap to view`} accessibilityRole="button">
            <Ionicons name="chatbubble-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{dashboard?.unreadCount ?? 0} unread message{dashboard?.unreadCount === 1 ? '' : 's'}</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Friends')} accessibilityLabel={`${countLabel(dashboard?.friendsCount ?? 0, 'friend')}, tap to view`} accessibilityRole="button">
            <Ionicons name="people-circle-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{dashboard?.friendsCount ?? 0} friend{dashboard?.friendsCount === 1 ? '' : 's'}</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {(dashboard?.bestPick || dashboard?.becauseYouLike?.length > 0 || dashboard?.trendingGatherings?.length > 0 || dashboard?.friendsActivity?.length > 0) && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="sparkles-outline" size={14} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.sectionHeaderText}>Picked For You</Text>
            </View>

            {homeMerge.hero && (() => {
              // Phase 8 section H (CLAUDE.md) -- Home's one hero moment,
              // same visual language as Discover's own hero tier (full-bleed
              // cover image or a category-color gradient fallback, dark
              // scrim, white text). Deliberately the ONLY card on this whole
              // screen that gets this treatment: bestPick is the one signal
              // Home computes as a genuine standout (getGatheringFitReasons()
              // score >= 5, homeDashboard.js) -- manufacturing a second hero
              // out of, say, the #1 Trending item would be exactly the
              // "invented hierarchy" Discover's own build explicitly avoided.
              // Everything below (Trending, Friends' Activity, Nearby Right
              // Now) stays plain text rows, per the "not a wall of imagery"
              // instruction.
              const categoryStyle = categoryStyleFor(homeMerge.hero.interest_tag);
              const fullness = gatheringFullnessLabel(homeMerge.hero);
              return (
                <TouchableOpacity
                  style={[styles.heroCard, shadow.card]}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: homeMerge.hero.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`Best Pick${gatheringTimeBadge(homeMerge.hero.scheduled_at) === 'TONIGHT' ? ' Tonight' : ''}: ${homeMerge.hero.title}, ${homeMerge.hero.reasons.join(', ')}`}
                  accessibilityRole="button"
                >
                  {bestPickCoverUrl ? (
                    <Image source={{ uri: bestPickCoverUrl }} style={styles.heroImage} />
                  ) : (
                    <LinearGradient
                      colors={[lightenHex(categoryStyle.color, 0.28), categoryStyle.color]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.heroImage}
                    >
                      <Text style={styles.heroWatermarkIcon}>{categoryStyle.icon}</Text>
                    </LinearGradient>
                  )}
                  <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
                    style={styles.heroScrim}
                    pointerEvents="none"
                  />
                  <Text style={styles.heroEyebrow}>{gatheringTimeBadge(homeMerge.hero.scheduled_at) ?? 'BEST PICK'}</Text>
                  <View style={styles.heroBody}>
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <Text style={styles.heroTitle} numberOfLines={1}>{homeMerge.hero.title}</Text>
                      <Text style={styles.heroMeta} numberOfLines={1}>
                        {homeMerge.hero.reasons.filter((r) => categorizeReasonText(r) !== REASON_CATEGORIES.TIME).join(' · ')}
                      </Text>
                      {/* P1 remediation (CLAUDE.md, Aug 28 Full Coherence
                          Audit): the same real fullness signal every
                          recommendation surface shows, so a full gathering
                          never ranks #1 here with zero indication before
                          the tap. */}
                      {fullness && (
                        <Text style={[styles.heroMeta, fullness.startsWith('🔒') && { color: '#FFB4B4' }]}>{fullness}</Text>
                      )}
                    </View>
                    {renderGatheringCta(homeMerge.hero, 'hero')}
                  </View>
                </TouchableOpacity>
              );
            })()}

            {homeMerge.cards.map(({ gathering: g, signals, reasons, hasFriend, trendingOnly }) => {
              const card = gatheringCardModel(g, { signals });
              const timing = hasFriend && g.scheduled_at ? describeFriendGatheringTiming(g.scheduled_at) : null;
              const past = !!timing?.isPast;
              return (
                <TouchableOpacity
                  key={g.id}
                  style={styles.trendingCard}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  accessibilityLabel={`${g.title}, ${reasons.join(', ')}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.trendingTitle}>{categoryStyleFor(g.interest_tag).icon} {g.title}</Text>
                  {card.why ? <Text style={styles.trendingMeta}>{card.why}</Text> : null}
                  <Text style={styles.trendingMeta}>
                    {[recommendationFacts(g).distance,
                      g.scheduled_at ? (past ? `${timing.text} · Already happened` : formatHeroDateTime(g.scheduled_at)) : null,
                      g.approvedAttendees ? `${attendeeTotal(g)} attending` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {card.social ? <Text style={styles.trendingMeta}>{card.social}</Text> : null}
                  {gatheringFullnessLabel(g) && (
                    <Text style={[styles.trendingMeta, gatheringFullnessLabel(g).startsWith('🔒') && { color: colors.danger }]}>
                      {gatheringFullnessLabel(g)}
                    </Text>
                  )}
                  {!past && <View style={{ marginTop: spacing.xs }}>{renderGatheringCta(g, trendingOnly ? 'trending' : 'row')}</View>}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {dashboard?.weeklyRecap && (dashboard.weeklyRecap.gatheringsAttended > 0 || dashboard.weeklyRecap.newFriends > 0) && (
          <TouchableOpacity
            style={styles.recapCard}
            onPress={() => navigation.navigate('Momentum')}
            accessibilityLabel={`This week: ${formatWeeklyRecap(dashboard.weeklyRecap)}. View your activity`}
            accessibilityRole="button"
          >
            <Text style={styles.recapSummary}>This week: {formatWeeklyRecap(dashboard.weeklyRecap)}</Text>
            <Text style={styles.recapLink}>View your activity →</Text>
          </TouchableOpacity>
        )}

        {!locationOff && !dashboard?.bestPick && (!dashboard?.trendingGatherings || dashboard.trendingGatherings.length === 0) && (dashboard?.nearbyPeopleCount ?? 0) === 0 && (
          <View style={styles.quietCard}>
            <Text style={styles.quietTitle}>Quiet night nearby</Text>
            <Text style={styles.quietText}>Nothing notable happening right now — but that can change fast. Browse anyway, or check back later.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.browseButton} onPress={() => navigation.navigate('Discover')} accessibilityLabel="Continue browsing" accessibilityRole="button">
          <Text style={styles.browseButtonText}>Continue Browsing →</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, shadow.button]}
        onPress={() => setStartModalVisible(true)}
        activeOpacity={0.85}
        accessibilityLabel="Start something spontaneous"
        accessibilityRole="button"
      >
        <Text style={styles.fabText}>+ Start Something</Text>
      </TouchableOpacity>

      {/* Aug 23 2026 (CLAUDE.md): topLevelOptions is now always the fixed
          CREATE_HUB_OPTIONS set, not the modal's own default fallback
          (getQuickPrompts()) -- that default is period-flavored, and for
          the weekend period it's the exact same 3 items (Beach Volleyball/
          Beach Cleanup/Wine Tasting) already rendered a few sections up in
          Home's own Quick Picks row. Tapping "+ Start Something" would
          have opened a sheet showing the identical suggestions Home just
          showed, one tap away, from the same screen -- a real, confirmed
          duplication, not a stylistic quibble. CREATE_HUB_OPTIONS is a
          different, stable category set (Coffee/Dinner/Walk/Sports/Games/
          Music/Volunteer), matching what the Create tab's own grid shows,
          so the FAB now genuinely offers something Home's own Quick Picks
          row didn't already just say. */}
      <StartSomethingModal
        visible={startModalVisible}
        onClose={closeStartModal}
        navigation={navigation}
        topLevelOptions={personalizeQuickOptions(CREATE_HUB_OPTIONS, myDeclaredInterests, (t) => categoryStyleFor(t).icon)}
      />
      <GatheringFeedbackModal
        visible={!!unratedGathering}
        gatheringId={unratedGathering?.id}
        navigation={navigation}
        onClose={() => setUnratedGathering(null)}
      />
      <DiningPreferencesPromptModal
        visible={diningModalVisible}
        onClose={handleDiningDismiss}
        onSaved={() => { setDiningNudge(false); setDiningModalVisible(false); showSuccessToast('Saved', 'Your tastes are set.'); }}
      />
      <QuickPicksEditModal
        visible={quickPicksEditVisible}
        onClose={() => setQuickPicksEditVisible(false)}
        initialPicks={pinnedQuickPicks ?? []}
        onSave={saveQuickPicks}
        onResetToAuto={resetQuickPicksToAuto}
      />
      <SurpriseMeSheet
        visible={surpriseSheetVisible}
        onClose={() => setSurpriseSheetVisible(false)}
        onSubmit={(picks) => {
          setSurpriseSheetVisible(false);
          handleSurpriseSubmit(picks);
        }}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  greeting: { ...typography.title, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
  insightLine: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg, lineHeight: 19 },
  // Home Visual Hierarchy Audit, recommendation #1 (2026-08-14): this is
  // Home's one hero element -- "This is where I start," not "here's
  // another card." primaryMuted + a colors.primary border is the same
  // colored-card language already used elsewhere on this screen (perks/
  // invites banners, Best Pick), so it stays inside the existing Nearby
  // visual system rather than inventing a new promotional style; what
  // sets this container apart is shadow.card (applied via style array in
  // the JSX) -- otherwise reserved for the FAB alone -- plus the largest
  // padding and a full spacing.xl gap below it, so it reads as lifted and
  // deliberately breathing-room'd rather than louder-colored.
  intentSection: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.lg, marginBottom: spacing.xl,
  },
  // typography.title matches the greeting directly above it -- an
  // existing scale, not a new one -- so the heading reads as the
  // screen's real headline rather than a card label.
  intentHeading: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.sm },
  intentInputRow: { flexDirection: 'row', alignItems: 'center' },
  // colors.surface (plain, not surfaceElevated) reads as a clearly
  // separate, tappable field against the now-colored intentSection
  // background behind it, rather than blending into it.
  intentInput: {
    flex: 1, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginRight: spacing.sm,
  },
  intentButton: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minWidth: 68, alignItems: 'center', justifyContent: 'center',
  },
  intentButtonDisabled: { opacity: 0.5 },
  intentButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  intentResults: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  intentLoadingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  intentUnclearNote: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
  intentResultsHeading: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.sm },
  intentGroupLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, marginBottom: 4 },
  intentResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  intentResultIcon: { marginRight: spacing.sm },
  intentResultTextCol: { flex: 1 },
  intentResultTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  intentResultSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  friendRequestActions: { flexDirection: 'row', marginTop: spacing.xs, gap: spacing.md },
  friendRequestActionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  friendRequestActionTextPrimary: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  intentResultsCreateNew: { color: colors.primary, fontWeight: '600', fontSize: 14, marginTop: spacing.sm },
  intentResultsDismiss: { color: colors.textTertiary, fontSize: 13, marginTop: spacing.sm },
  // "Surprise Me" (critique item 28) -- a text-link-weight entry point
  // (no fill, no border) so it never competes visually with the coral
  // "Find it" button right above it; the same "secondary but still
  // coral-colored text" treatment intentResultsCreateNew already uses.
  surpriseMeLink: { alignSelf: 'flex-start', marginTop: spacing.sm },
  surpriseMeLinkText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  surpriseCard: { marginBottom: spacing.sm },
  surpriseConnectedText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginLeft: spacing.xl },
  surpriseActionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  surpriseViewButton: {
    flex: 1, backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center',
  },
  surpriseViewButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Secondary/outlined per the locked spec ("Shuffle Again should be
  // secondary/outlined") -- never coral, coral is reserved for this
  // card's own primary View/Plan This action beside it.
  surpriseShuffleButton: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center',
  },
  surpriseShuffleButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  askBusinessButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm,
  },
  askBusinessButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  plansCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  planRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  planIcon: { fontSize: 22, marginRight: spacing.sm },
  planInfo: { flex: 1 },
  planTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  planMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  makePlanLink: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 4 },
  planChevron: { color: colors.textTertiary, fontSize: 18 },
  subLabelSpaced: { marginTop: spacing.md },
  seeAllPlansButton: { alignItems: 'center', paddingVertical: spacing.xs, marginBottom: spacing.lg },
  seeAllPlansText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  quickActionChip: {
    alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginRight: spacing.sm, minWidth: 84,
  },
  quickActionIcon: { marginBottom: 4 },
  quickActionLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  happeningNowChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1.5,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginRight: spacing.sm, maxWidth: 180,
  },
  happeningNowIcon: { fontSize: 16, marginRight: 6 },
  happeningNowLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  happeningNowDistance: { color: colors.textTertiary, fontWeight: '400' },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  continueCommunityCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  continueCommunityLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  // Home hierarchy audit recommendation #6: was 11px, an undersized outlier
  // against its own tier siblings (Happening Near You's sectionHeader uses
  // typography.caption's 13px) -- a one-line correction, not a design call.
  continueCommunityLabel: { color: colors.textTertiary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  continueCommunityName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  continueCommunityDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  perksBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.md,
  },
  perksBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  perksBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  pendingInvitesBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.md,
  },
  pendingInvitesBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  pendingInvitesBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  // Shared by every banner/label/stat row that pairs a small Ionicons glyph
  // with adjacent text — bannerContent lets a left-aligned icon+text group
  // sit inside a space-between row (banners) without stretching; bannerIcon
  // is just the icon's own trailing gap, reused everywhere below instead of
  // a bespoke margin per call site.
  bannerContent: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: spacing.sm },
  bannerIcon: { marginRight: spacing.xs },
  outcomePromptCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  outcomePromptHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  outcomePromptText: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 14, marginRight: spacing.sm },
  outcomePromptSubtext: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
  upcomingWorldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.xs, marginTop: spacing.xs,
  },
  outcomePromptRow: { flexDirection: 'row', justifyContent: 'space-between' },
  outcomePromptButton: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  outcomePromptButtonEmoji: { fontSize: 20, marginBottom: 2 },
  outcomePromptButtonLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  predictiveActButton: { alignSelf: 'flex-start', paddingVertical: 6 },
  predictiveActButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  firstRunCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  firstRunHeading: { ...typography.headline, color: colors.textPrimary },
  firstRunBody: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  firstRunItemRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  firstRunItemIcon: { fontSize: 22, marginRight: spacing.sm },
  firstRunItemTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  firstRunItemMeta: { ...typography.caption, color: colors.textTertiary, marginTop: 1 },
  firstRunFooter: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
  firstRunGotIt: { color: colors.primary, fontWeight: '700', fontSize: 13, alignSelf: 'flex-start' },
  forecastCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  forecastLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  forecastLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  forecastValue: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  forecastDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  weatherSuggestions: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  weatherSuggestionsHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  weatherSuggestionsHeader: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  weatherSuggestionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  weatherSuggestionIcon: { fontSize: 14, marginRight: spacing.xs },
  weatherSuggestionText: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  weatherSuggestionTime: { color: colors.textTertiary, fontSize: 11, marginLeft: spacing.xs },
  sinceAwayBanner: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  sinceAwayTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  sinceAwayItemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  sinceAwayItem: { color: colors.textPrimary, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  cardIcon: { marginRight: spacing.sm },
  cardText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardChevron: { color: colors.textTertiary, fontSize: 18 },
  divider: { height: 1, backgroundColor: colors.border },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  // Home hierarchy audit recommendation #3: a real, heavier header, distinct
  // from the uniform caption-style sectionHeader above -- used only by "Your
  // Plans" (the one section the locked target model names "primary"), not
  // applied to Quick Picks/Happening Near You/Because You Like… or any other
  // section, per the recommendation's own explicit scope.
  primaryHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  sectionHeaderText: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickPicksHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quickPicksEditLink: { ...typography.caption, color: colors.primary, marginBottom: spacing.sm },
  subLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.xs },
  subLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs, marginTop: spacing.xs },
  subLabelText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  // Phase 8 section H (CLAUDE.md) -- Home's one hero moment, same visual
  // recipe as Discover's own hero tier (DiscoverHubScreen.js). Superseded
  // the old flat bestPickCard/bestPickTitle/bestPickReasons chrome (Home
  // hierarchy audit recommendation #4's "dialed down" card) now that the
  // content itself (a real cover image + time badge) carries the signal.
  heroCard: {
    borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm,
    minHeight: 132, justifyContent: 'flex-end',
  },
  heroImage: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'flex-start' },
  heroWatermarkIcon: { fontSize: 84, opacity: 0.25, marginTop: -18, marginRight: -6 },
  heroScrim: { ...StyleSheet.absoluteFillObject },
  heroEyebrow: {
    position: 'absolute', top: spacing.sm, left: spacing.sm,
    color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 0.6,
    backgroundColor: 'rgba(0,0,0,0.32)', paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.full, overflow: 'hidden',
  },
  heroBody: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: spacing.md, paddingTop: spacing.xl,
  },
  heroTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 17, marginBottom: 2 },
  heroMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '500' },
  heroCta: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  heroCtaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  heroCtaGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowCta: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, alignSelf: 'flex-start' },
  rowCtaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  rowCtaGhost: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  rowCtaGhostText: { color: colors.textPrimary, fontWeight: '600', fontSize: 12 },
  recapCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  recapSummary: { color: colors.textPrimary, fontSize: 13, flex: 1, marginRight: spacing.sm },
  recapLink: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  trendingCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  trendingTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  trendingMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  quietCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
  },
  quietTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  quietText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  browseButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.md },
  browseButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});