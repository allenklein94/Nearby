import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getHomeDashboard, getSocialForecast, getContinueYourCommunities, getUnlockedPerksCount, getHomeInsight, getPendingInvitesCount } from '../services/homeDashboard';
import { getMostRecentUnratedGathering, getMyGatheringsNeedingVenue, getMyGatheringsWithOutstandingRsvps, getMyPositiveExperienceSignals } from '../services/gatherings';
import { classifyCreateRequest } from '../services/createAssistant';
import { resolveIntent, resolveCommunityIntent } from '../services/intentResolver';
import { recordIntentSelection, recordIntentSubmission, getPendingIntentOutcomePrompt, recordIntentOutcome, dismissIntentOutcomePrompt, getMyIntentPatterns, recordNudgeEvent } from '../services/intentOutcomes';
import { getMyGroupIntentSignals } from '../services/businessFulfillment';
import { getUpcomingConnectedBirthdays } from '../services/friends';
import { logBusinessProfileView, getActiveOffers } from '../services/brandOffers';
import { buildHomeRecommendations } from '../services/homeRecommendations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GatheringFeedbackModal from '../components/GatheringFeedbackModal';
import PlanCard from '../components/PlanCard';
import { resolveGatheringPlanStatus, resolveGroupPlanStatus } from '../constants/planStatus';
import { supabase } from '../services/supabase';
import * as Location from 'expo-location';
import StartSomethingModal from '../components/StartSomethingModal';
import QuickPicksEditModal from '../components/QuickPicksEditModal';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { iconNameForCategory } from '../constants/quickPickIcons';
import LoadErrorState from '../components/LoadErrorState';
import TabHeaderActions from '../components/TabHeaderActions';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getGreeting, getTimePeriod, getPersonalizedQuickPicks, getPinnedQuickPicks, formatHeroDateTime } from '../utils/timeContext';

const PERIOD_DATE_FILTER = { morning: 'today', afternoon: 'today', evening: 'today', weekend: 'weekend' };

const PERIOD_SECTION_LABELS = { morning: 'Good Morning', afternoon: 'This Afternoon', evening: 'Tonight', weekend: 'This Weekend' };

// Phase 1a of the Intent Layer plan (CLAUDE.md) -- rotating placeholder
// examples for the new "What do you want to do?" box. Picked once per
// mount, not re-randomized on every keystroke.
const INTENT_PLACEHOLDER_EXAMPLES = ['Dinner tonight…', 'Something fun Saturday…', 'Find a pickleball game…'];

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
};

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

// "Coffee" / "Coffee & Outdoors" / "Coffee, Outdoors & Music" — the real
// top categories this section is drawn from, not just the first result.
function formatCategoryList(categories) {
  if (!categories || categories.length === 0) return '';
  if (categories.length === 1) return categories[0];
  return `${categories.slice(0, -1).join(', ')} & ${categories[categories.length - 1]}`;
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
  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [socialForecast, setSocialForecast] = useState(null);
  const [continueCommunities, setContinueCommunities] = useState([]);
  const [perksCount, setPerksCount] = useState(0);
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0);
  const [unratedGathering, setUnratedGathering] = useState(null);
  const [pinnedQuickPicks, setPinnedQuickPicks] = useState(null);
  const [quickPicksEditVisible, setQuickPicksEditVisible] = useState(false);
  const [intentText, setIntentText] = useState('');
  const [intentThinking, setIntentThinking] = useState(false);
  const [intentResults, setIntentResults] = useState(null);
  const [intentEmptyFallback, setIntentEmptyFallback] = useState(null);
  const [intentPlaceholder, setIntentPlaceholder] = useState(() => INTENT_PLACEHOLDER_EXAMPLES[Math.floor(Math.random() * INTENT_PLACEHOLDER_EXAMPLES.length)]);
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

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      if (myId) {
        const { data: profile } = await supabase.from('profiles').select('display_name, home_quick_pick_categories, seen_home_first_run_moment').eq('id', myId).single();
        setMyName(profile?.display_name?.split(' ')[0] ?? '');
        setPinnedQuickPicks(Array.isArray(profile?.home_quick_pick_categories) ? profile.home_quick_pick_categories : null);
        setSeenFirstRunMoment(profile?.seen_home_first_run_moment ?? true);
      }
      const result = await getHomeDashboard();
      setDashboard(result);
      setLoadError(false);

      try {
        const communities = await getContinueYourCommunities();
        setContinueCommunities(communities);
        const perks = await getUnlockedPerksCount();
        setPerksCount(perks);
        const unrated = await getMostRecentUnratedGathering();
        setUnratedGathering(unrated);
        const pendingInvites = await getPendingInvitesCount(myId);
        setPendingInvitesCount(pendingInvites);
        const pendingOutcome = await getPendingIntentOutcomePrompt();
        setOutcomePrompt(pendingOutcome);

        // 10/10 roadmap Part 7: a real, recurring pattern (if one exists
        // for right now) joins the existing static rotation as one more
        // example -- never replaces the box, never auto-submits, never
        // shown for a user without a real repeated pattern (falls back to
        // today's static examples exactly as before).
        const pattern = await getMyIntentPatterns();
        if (pattern?.placeholderText) {
          const pool = [...INTENT_PLACEHOLDER_EXAMPLES, pattern.placeholderText];
          setIntentPlaceholder(pool[Math.floor(Math.random() * pool.length)]);
        }

        // Nearby 2.0 vision layer 6, "Predictive Nearby" -- a real
        // proactive nudge, not just a smarter placeholder: the same
        // 3+-occurrence pattern above, but only ever a dismissible
        // suggestion the user explicitly taps to act on, never
        // auto-submitted. Dismissed for today via a local, per-day key --
        // a fresh day re-evaluates honestly rather than nagging forever.
        if (pattern?.category) {
          const dismissKey = `predictive_dismiss_${new Date().toDateString()}_${pattern.category}_${pattern.period}`;
          const dismissed = await AsyncStorage.getItem(dismissKey);
          if (!dismissed) {
            setPredictivePattern(pattern);
            if (!loggedNudgeShownRef.current.has(dismissKey)) {
              loggedNudgeShownRef.current.add(dismissKey);
              recordNudgeEvent('predictive', 'shown', pattern.category);
            }
          }
        }

        // Nearby 2.0 vision layer 3, "Group intent" -- real, dismissible:
        // shown only when the RPC's own real >=2-connected-people
        // threshold is actually crossed, never fabricated. Takes the top
        // (highest-count) real signal only, so this reads as one honest
        // nudge, not a list of speculative categories.
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

        // "The Plan Engine" Phase 1 (CLAUDE.md) -- real, dismissible: the
        // single soonest real upcoming birthday among the caller's own real
        // connections (friends+matches), scoped server-side. Per-day
        // dismiss, same convention as the two nudges above.
        try {
          const birthdays = await getUpcomingConnectedBirthdays();
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

        // "The Plan Engine" Phase 2 (CLAUDE.md) -- real, dismissible: the
        // soonest real upcoming hosted gathering with genuinely no venue
        // and no business_requests row yet. Per-day dismiss, same
        // convention as every other nudge here.
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

        // "The Plan Engine" Phase 3 (CLAUDE.md) -- real, dismissible: the
        // soonest real upcoming hosted gathering with at least one real
        // still-pending sent invite. Per-day dismiss, same convention as
        // every other nudge here.
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
      } catch (e) {
        // These are supplementary cards, not core functionality — a
        // failure here should never block social forecast/location
        // code that runs afterward in the same function, nor the
        // core dashboard content that already rendered successfully.
        console.error('Continue Community / Perks / Feedback fetch failed', e);
      }

      let forecast = null;
      let myLocation = null;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          myLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
          if (myLocation) {
            forecast = await getSocialForecast(myLocation.coords.latitude, myLocation.coords.longitude);
            setSocialForecast(forecast);
          }
        }
      } catch (e) {
        // Same reasoning as above — the weather card is a contextual
        // extra, not core content; a failure here shouldn't flip the
        // whole screen into an error state once the dashboard is up.
        console.error('Social forecast fetch failed', e);
      }

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
        const offers = await getActiveOffers(myLocation?.coords?.latitude ?? null, myLocation?.coords?.longitude ?? null).catch(() => []);
        // "The Plan Engine" Phase 4 (CLAUDE.md) -- real post-visit
        // feedback (gathering_feedback/business_offer_outcomes) feeding
        // back into this same scoring pass. Supplementary, non-fatal --
        // falls back to two empty Sets (no bonus applied) on failure,
        // matching this whole block's own established convention.
        const { positiveHostIds, positivePartnerIds } = await getMyPositiveExperienceSignals().catch(() => ({
          positiveHostIds: new Set(),
          positivePartnerIds: new Set(),
        }));
        setHomeRecommendations(
          buildHomeRecommendations({
            gatherings: result?.nearbyGatherings ?? [],
            offers,
            weather: forecast,
            excludeIds: new Set(result?.upcomingPlanIds ?? []),
            positiveHostIds,
            positivePartnerIds,
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
    if (result.intent === 'gathering') {
      navigation.navigate('CreateGathering', { quickStartTitle: result.title, quickStartCategory: result.category });
    } else if (result.intent === 'community') {
      navigation.navigate('CreateCommunity', { quickStartTitle: result.title, quickStartCategory: result.category });
    } else if (result.intent === 'business_partner') {
      navigation.navigate('RequestBusinessPartner', { initialBusinessQuery: result.businessName ?? '' });
    } else {
      navigation.navigate('CreateGathering', { quickStartTitle: typedText, quickStartCategory: null });
    }
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
    setIntentResults(null);
    setIntentEmptyFallback(null);
    try {
      const result = await classifyCreateRequest(typedText);
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
        const resolved = await resolveIntent({ category: result.category, dateWindow: result.dateWindow, rawText: typedText, partySize: result.partySize ?? null });
        const submissionId = await recordIntentSubmission({
          rawText: typedText, category: result.category ?? null, dateWindow: result.dateWindow ?? null,
          intentKind: result.intent, hadAnyResult: resolved.length > 0, reachedBusinessFallback: resolved.length === 0,
        });
        if (resolved.length > 0) {
          setIntentResults({ items: resolved, classifyResult: result, typedText, submissionId });
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
    if (item.type === 'gathering') {
      navigation.navigate('GatheringDetail', { gatheringId: item.id });
    } else if (item.type === 'perk') {
      // C2: a real, honest "found because of what they asked for" signal
      // for the business -- fire-and-forget, never blocks navigation, and
      // never routes the consumer through BusinessProfileScreen (they
      // still land on BrandOffers exactly as before this change).
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('BrandOffers', { highlightOfferId: item.id });
    } else if (item.type === 'friend_request') {
      navigation.navigate('ViewProfile', { userId: item.userId });
    } else if (item.type === 'community') {
      navigation.navigate('CommunityDetail', { communityId: item.id });
    } else if (item.type === 'business_availability') {
      // A business already declared these terms in advance -- tapping
      // this doesn't submit anything by itself (same "review before
      // commit" discipline every other result type here already follows,
      // e.g. tapping a gathering navigates to its detail rather than
      // auto-joining) -- it lands on the real ask screen, prefilled from
      // both the original intent and the specific posting matched, so
      // submitting there is very likely to land as an immediate real
      // offer rather than a cold ask.
      // C2: same real discovery signal as the perk branch above.
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('AskBusiness', {
        prefillText: typedText ?? '',
        prefillCategory: classifyResult?.category ?? null,
        prefillPartySize: classifyResult?.partySize ?? null,
        prefillBudgetMax: classifyResult?.budgetMax ?? null,
        prefillDateWindow: classifyResult?.dateWindow ?? null,
        matchedAvailability: item.matchedAvailability ?? null,
      });
    } else if (item.type === 'business_policy_match') {
      // A business's own standing willingness, not a specific posting to
      // bind -- there's no matchedAvailability here, and no way to force
      // this exact business as the winner: the real match (or not) happens
      // inside _match_request_to_policy() when the request is actually
      // submitted, ranked among every other eligible policy the same way.
      // C2: same real discovery signal as the two branches above.
      if (item.partnerId) logBusinessProfileView(item.partnerId, 'intent_match');
      navigation.navigate('AskBusiness', {
        prefillText: typedText ?? '',
        prefillCategory: classifyResult?.category ?? null,
        prefillPartySize: classifyResult?.partySize ?? null,
        prefillBudgetMax: classifyResult?.budgetMax ?? null,
        prefillDateWindow: classifyResult?.dateWindow ?? null,
        matchedAvailability: null,
      });
    }
  }

  // Extracted so the multi-option grouped view (layer 4) and the
  // original flat view can share the exact same per-item rendering,
  // including the friend_request row's two-action treatment -- no
  // behavior duplicated or drifted between the two layouts.
  function renderIntentResultItem(item) {
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
          <Text style={styles.intentResultTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.intentResultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
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

  const quickPicks = pinnedQuickPicks && pinnedQuickPicks.length > 0
    ? getPinnedQuickPicks(pinnedQuickPicks, period, categoryStyleFor)
    : getPersonalizedQuickPicks(period, dashboard?.becauseYouLikeCategories, categoryStyleFor);
  const quickPicksAreCustom = pinnedQuickPicks && pinnedQuickPicks.length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
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
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{getGreeting()}{myName ? `, ${myName}` : ''} 👋</Text>
            <Text style={styles.subtitle}>{PERIOD_SUBTITLES[period]}</Text>
          </View>
          <TabHeaderActions navigation={navigation} />
        </View>

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

          {intentResults && (
            <View style={styles.intentResults}>
              {intentResults.classifyResult?.intent === 'unclear' && (
                <Text style={styles.intentUnclearNote}>
                  Nearby doesn't search for individual people directly — gatherings and
                  communities are how you meet people here. Here's what's already happening
                  that might fit.
                </Text>
              )}
              {(() => {
                const distinctTypes = new Set(intentResults.items.map((i) => i.type)).size;
                if (distinctTypes >= 2) {
                  const grouped = groupIntentResultsByType(intentResults.items);
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
                          {group.items.map((item) => renderIntentResultItem(item))}
                        </View>
                      ))}
                    </>
                  );
                }
                return (
                  <>
                    <Text style={styles.intentResultsHeading}>Already happening near you</Text>
                    {intentResults.items.map((item) => renderIntentResultItem(item))}
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
            <View style={styles.outcomePromptHeaderRow}>
              <Text style={styles.firstRunHeading}>👋 This is Nearby</Text>
              <TouchableOpacity onPress={handleDismissFirstRunMoment} accessibilityLabel="Dismiss" accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            {homeRecommendations.length > 0 ? (
              <>
                <Text style={styles.firstRunBody}>
                  We looked at what's real nearby right now — here's {homeRecommendations.length === 1 ? 'what we found' : 'a couple of things we found'}:
                </Text>
                {homeRecommendations.slice(0, 2).map((item) => (
                  <View key={`firstrun-${item.type}-${item.id}`} style={styles.firstRunItemRow}>
                    <Text style={styles.firstRunItemIcon}>{item.type === 'perk' ? '🎁' : categoryStyleFor(item.data?.interest_tag).icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.firstRunItemTitle}>{item.title}</Text>
                      <Text style={styles.firstRunItemMeta}>{item.reasons.join(' · ')}</Text>
                    </View>
                  </View>
                ))}
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
          return insight ? <Text style={styles.insightLine}>{insight}</Text> : null;
        })()}

        {(dashboard?.plansGoing?.length > 0 || dashboard?.plansHosting?.length > 0 || dashboard?.plansGroup?.length > 0) && (
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
                      status={resolveGatheringPlanStatus({ role: 'hosting' })}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                    />
                  ))}
                </>
              )}
              {dashboard.plansGroup?.length > 0 && (
                <>
                  <Text style={[styles.subLabel, (dashboard.plansGoing.length > 0 || dashboard.plansHosting.length > 0) && styles.subLabelSpaced]}>Group Plans</Text>
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
              {homeRecommendations.map((item) => (
                <TouchableOpacity
                  key={`${item.type}-${item.id}`}
                  style={styles.planRow}
                  onPress={() => handleRecommendationTap(item)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${item.title}, ${item.reasons.join(', ')}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.planIcon}>{item.type === 'perk' ? '🎁' : categoryStyleFor(item.data?.interest_tag).icon}</Text>
                  <View style={styles.planInfo}>
                    <Text style={styles.planTitle}>{item.title}</Text>
                    <Text style={styles.planMeta}>{item.reasons.join(' · ')}</Text>
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
                        activeOpacity={0.7}
                        accessibilityLabel={`Make a plan around ${item.title}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.makePlanLink}>📅 Make a plan →</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.planChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {(pendingInvitesCount > 0 || perksCount > 0 || socialForecast || outcomePrompt || predictivePattern || groupIntentSignal || birthdayNudge || venueNeededGathering || rsvpsOutstandingGathering || (dashboard?.sinceAway && (dashboard.sinceAway.newPeopleCount > 0 || dashboard.sinceAway.newGatheringsCount > 0))) && (
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
            {birthdayNudge && (
              <View style={styles.outcomePromptCard}>
                <View style={styles.outcomePromptHeaderRow}>
                  <Text style={styles.outcomePromptText} numberOfLines={2}>
                    🎂 {birthdayNudge.display_name}'s birthday is{' '}
                    {birthdayNudge.days_until === 0 ? 'today' : birthdayNudge.days_until === 1 ? 'tomorrow' : `in ${birthdayNudge.days_until} days`}
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
              // Broadened beyond current-conditions 'Quiet' to also cover a
              // real forecast-derived risk later today (rain_risk/heat_risk/
              // cold_risk — the new signals get_weather_result's forecast
              // leg computes) — weather should power a real recommendation
              // from the actual forecast, not just describe right now.
              // outdoor_favorable is the symmetric positive case: a
              // genuinely good day is a real reason to actively suggest an
              // outdoor gathering, not just avoid a warning. The two are
              // mutually exclusive so the card never suggests both at once.
              const forecastRisk = socialForecast.rain_risk === 'high' || socialForecast.heat_risk || socialForecast.cold_risk;
              const showIndoor = (socialForecast.forecast_label === 'Quiet' || forecastRisk) && dashboard?.indoorGatheringsToday?.length > 0;
              const showOutdoor = !showIndoor && socialForecast.outdoor_favorable === true && dashboard?.outdoorGatheringsToday?.length > 0;
              return (
                <View style={styles.forecastCard}>
                  <View style={styles.forecastLabelRow}>
                    <Ionicons name="partly-sunny-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
                    <Text style={styles.forecastLabel}>Right Now</Text>
                  </View>
                  <Text style={styles.forecastValue}>{socialForecast.forecast_label}</Text>
                  <Text style={styles.forecastDetail}>{socialForecast.forecast_detail}</Text>
                  {showIndoor && (
                    <View style={styles.weatherSuggestions}>
                      <View style={styles.weatherSuggestionsHeaderRow}>
                        <Ionicons name="home-outline" size={12} color={colors.textTertiary} style={styles.bannerIcon} />
                        <Text style={styles.weatherSuggestionsHeader}>
                          {dashboard.indoorGatheringsToday.length} indoor gathering{dashboard.indoorGatheringsToday.length === 1 ? '' : 's'} today
                        </Text>
                      </View>
                      {dashboard.indoorGatheringsToday.map((g) => (
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
                          {dashboard.outdoorGatheringsToday.length} outdoor gathering{dashboard.outdoorGatheringsToday.length === 1 ? '' : 's'} today
                        </Text>
                      </View>
                      {dashboard.outdoorGatheringsToday.map((g) => (
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

        {dashboard?.happeningNow?.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="flame-outline" size={14} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.sectionHeaderText}>Happening Near You</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              {dashboard.happeningNow.map((g) => {
                const style = categoryStyleFor(g.interest_tag);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.happeningNowChip, { borderColor: style.color }]}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    activeOpacity={0.85}
                    accessibilityLabel={`${g.title}, ${g.interest_tag ?? 'General'}, happening now`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.happeningNowIcon}>{style.icon}</Text>
                    <Text style={styles.happeningNowLabel} numberOfLines={1}>{g.title}</Text>
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
          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Nearby')} accessibilityLabel={`${dashboard?.nearbyPeopleCount ?? 0} people nearby, tap to view`} accessibilityRole="button">
            <Ionicons name="people-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{dashboard?.nearbyPeopleCount ?? 0} people nearby</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'today' })} accessibilityLabel={`${dashboard?.gatheringsTodayCount ?? 0} gatherings today, tap to view`} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{dashboard?.gatheringsTodayCount ?? 0} gatherings today</Text>
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

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Friends')} accessibilityLabel={`${dashboard?.friendsCount ?? 0} friends, tap to view`} accessibilityRole="button">
            <Ionicons name="people-circle-outline" size={20} color={colors.textPrimary} style={styles.cardIcon} />
            <Text style={styles.cardText}>{dashboard?.friendsCount ?? 0} friend{dashboard?.friendsCount === 1 ? '' : 's'}</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {(dashboard?.bestPick || dashboard?.becauseYouLike?.length > 0 || dashboard?.trendingGatherings?.length > 0 || dashboard?.friendsActivity?.length > 0) && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="sparkles-outline" size={14} color={colors.textTertiary} style={styles.bannerIcon} />
              <Text style={styles.sectionHeaderText}>Because You Like…</Text>
            </View>

            {dashboard?.becauseYouLike?.length > 0 && (
              <>
                <View style={styles.subLabelRow}>
                  <Ionicons name="bulb-outline" size={13} color={colors.textSecondary} style={styles.bannerIcon} />
                  <Text style={styles.subLabelText}>{formatCategoryList(dashboard.becauseYouLikeCategories)}</Text>
                </View>
                {dashboard.becauseYouLike.map((g) => {
                  const style = categoryStyleFor(g.interest_tag);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.trendingCard}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                      accessibilityLabel={`${g.title}, ${g.interest_tag}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.trendingTitle}>{style.icon} {g.title}</Text>
                      <Text style={styles.trendingMeta}>{g.interest_tag} · {formatHeroDateTime(g.scheduled_at)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {dashboard?.bestPick && (
              <>
                <View style={styles.subLabelRow}>
                  <Ionicons name="star-outline" size={13} color={colors.textSecondary} style={styles.bannerIcon} />
                  <Text style={styles.subLabelText}>Best Pick Tonight</Text>
                </View>
                <TouchableOpacity
                  style={styles.bestPickCard}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: dashboard.bestPick.id })}
                  accessibilityLabel={`${dashboard.bestPick.title}, ${dashboard.bestPick.reasons.join(', ')}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.bestPickTitle}>{dashboard.bestPick.title}</Text>
                  <View style={styles.bestPickReasons}>
                    {dashboard.bestPick.reasons.map((reason, i) => (
                      <Text key={i} style={styles.bestPickReason}>✓ {reason}</Text>
                    ))}
                  </View>
                  <Text style={styles.bestPickAction}>View →</Text>
                </TouchableOpacity>
              </>
            )}

            {dashboard?.trendingGatherings?.length > 0 && (
              <>
                <View style={styles.subLabelRow}>
                  <Ionicons name="flame-outline" size={13} color={colors.textSecondary} style={styles.bannerIcon} />
                  <Text style={styles.subLabelText}>Trending Near You</Text>
                </View>
                {dashboard.trendingGatherings.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.trendingCard}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    accessibilityLabel={`${g.title}, ${g.approvedAttendees?.length ?? 0} attending`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.trendingTitle}>{g.title}</Text>
                    <Text style={styles.trendingMeta}>{g.approvedAttendees?.length ?? 0} attending · {g.distanceLabel}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {dashboard?.friendsActivity?.length > 0 && (
              <>
                <View style={styles.subLabelRow}>
                  <Ionicons name="people-outline" size={13} color={colors.textSecondary} style={styles.bannerIcon} />
                  <Text style={styles.subLabelText}>Friends' Activity</Text>
                </View>
                {dashboard.friendsActivity.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.trendingCard}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    accessibilityLabel={`${g.profiles?.display_name} is hosting ${g.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.trendingTitle}>{g.profiles?.display_name} is hosting</Text>
                    <Text style={styles.trendingMeta}>{g.title}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {dashboard?.weeklyRecap && (dashboard.weeklyRecap.gatheringsAttended > 0 || dashboard.weeklyRecap.newFriends > 0) && (
          <TouchableOpacity
            style={styles.recapCard}
            onPress={() => navigation.navigate('Momentum')}
            accessibilityLabel={`This week: ${formatWeeklyRecap(dashboard.weeklyRecap)}. View Momentum`}
            accessibilityRole="button"
          >
            <Text style={styles.recapSummary}>This week: {formatWeeklyRecap(dashboard.weeklyRecap)}</Text>
            <Text style={styles.recapLink}>View Momentum →</Text>
          </TouchableOpacity>
        )}

        {!dashboard?.bestPick && (!dashboard?.trendingGatherings || dashboard.trendingGatherings.length === 0) && (dashboard?.nearbyPeopleCount ?? 0) === 0 && (
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

      <StartSomethingModal
        visible={startModalVisible}
        onClose={closeStartModal}
        navigation={navigation}
      />
      <GatheringFeedbackModal
        visible={!!unratedGathering}
        gatheringId={unratedGathering?.id}
        navigation={navigation}
        onClose={() => setUnratedGathering(null)}
      />
      <QuickPicksEditModal
        visible={quickPicksEditVisible}
        onClose={() => setQuickPicksEditVisible(false)}
        initialPicks={pinnedQuickPicks ?? []}
        onSave={saveQuickPicks}
        onResetToAuto={resetQuickPicksToAuto}
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
  // Home hierarchy audit recommendation #4: this card previously matched the
  // hero intent box's own loud primaryMuted/1.5px-border treatment, making a
  // "personalization"-tier element outstyle both the hero and the primary
  // (Your Plans) section. Dialed down to match ordinary trendingCard chrome --
  // its content (the real ✓ reasons list, the "Best Pick Tonight" sub-label)
  // carries the recommendation signal now, not its chrome.
  bestPickCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  bestPickTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  bestPickReasons: { marginBottom: spacing.sm },
  bestPickReason: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  bestPickAction: { color: colors.primary, fontWeight: '700', fontSize: 13 },
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