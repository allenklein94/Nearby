import { useLanguage } from '../context/LanguageContext';
import useCategoryNames from '../hooks/useCategoryNames';
import { surpriseView, surpriseText } from '../i18n/surpriseView';
import { translate } from '../i18n/translate';
import { peopleTonightBanner, countTonightSupply } from '../utils/meetTonight';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { isFamilyView, gatheringDeclaresFamily, partnerDeclaresFamily } from '../utils/familyDeclared';
import { contextHasCuisines, offerInContext, applyCuisine, cuisineChips, cuisineConstraintFromText, cuisineLabel } from '../utils/cuisineFilter';
import { getNearbyMatches } from '../services/proximity';
import { getFriendDiscoveryCandidates } from '../services/friendDiscovery';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { TRENDING_ATTENDANCE_MIN } from '../constants/trending';
import ExperienceComponentList from '../components/ExperienceComponentList';
import SponsoredSpotlightSlot from '../components/SponsoredSpotlightSlot';
import PerkTierLine from '../components/PerkTierLine';
import usePersonalization from '../hooks/usePersonalization';
import usePlacesToGo from '../hooks/usePlacesToGo';
import PlacesToGoSection from '../components/PlacesToGoSection';
import { askBusinessesFits } from '../utils/placesToGo';
import { learnedProximityFor } from '../utils/learnedProximity';
import { behaviorNudge, broadGroupNudge, relatedHobbyNudge } from '../constants/blendedRanking';
import { relatedHobbyFor, relatedInterestReason } from '../constants/hobbyRelations';
import { getFriendsInterestedIn } from '../services/friendInterests';
import { friendsInterestReason } from '../utils/friendInterests';
import ReturnTrailChip from '../components/ReturnTrailChip';
import BusinessPreviewSheet from '../components/BusinessPreviewSheet';
import PerkRedemptionPanel from '../components/PerkRedemptionPanel';
import { listWithSelectedPerk } from '../utils/perkSelection';
import { getTrail, subscribeTrail } from '../navigation/returnTrail';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, SafeAreaView, Modal, FlatList, TextInput, ActivityIndicator, Alert, BackHandler } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Video } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSignedStoryUrl, getGatheringStoriesGrouped, getBusinessMomentsGrouped, captureStoryMedia, uploadStory } from '../services/stories';
import { getSignedPhotoUrl } from '../services/photos';
import { getNearbyGatherings, searchGatherings, getSignedGatheringPhotoUrl, getGatheringFitReasons } from '../services/gatherings';
import { getPublicCommunities, getMyCommunities, searchPublicCommunities } from '../services/communities';
import { getActiveOffers, getNearbyBusinesses, searchOffers, getMyRedemptions } from '../services/brandOffers';
import { searchNearbyPlaces, getPlacePhotoUrl, priceLevelLabel, getGoogleMapsRequestHeaders } from '../services/places';
import { resultRowView, recommendationContext, contextItem } from '../utils/recommendationContext';
import { gatheringCardModel } from '../utils/recommendationCard';
import { openDestination } from '../services/openDestination';
import { getSocialForecast } from '../services/homeDashboard';
// Phase 8 section G (CLAUDE.md) -- accepted friends UNION real matches,
// the one shared client-side definition of this app's connected set.
import { filterToMyConnections } from '../services/connections';
import { classifyCreateRequest, routeClassifiedIntentToCreation } from '../services/createAssistant';
import { askBusinessFromAsk } from '../services/askToBusiness';
import { runIntentSearch, navigateToIntentResultItem } from '../services/intentResolver';
import { recordTypedAsk } from '../services/typedAskAudit';
import { refineTypedAsk, narrowTypedAsk, restoreDiscoverAsk } from '../services/askRefine';
import { narrowGroupLabel } from '../utils/categoryNarrow';
import { discoverSession } from '../services/discoverSession';
import { syncDiscoverSession, pushSession, pushClear, sameSession } from '../services/discoverSessionSync';
import { randomUUID } from 'expo-crypto';
import AskRefinementChips from '../components/AskRefinementChips';
import { displayedPosition } from '../utils/typedAskAudit';
import { submitSurprise, shuffleSurprise, navigateToSurprisePick, surpriseTypesForTab } from '../services/surpriseMe';
import { discoverQuery } from '../utils/discoverQuery';
import { recordIntentSelection, getMyTopSearchedCategory } from '../services/intentOutcomes';
import { recordPeopleSubModeUse, getMyPeopleSubModeUsage } from '../services/peopleSubModeUsage';
import { resolveDefaultPeopleSubMode } from '../utils/peopleSubModePreference';
import { isIndoorCategory, isOutdoorCategory, filterGatheringsByEnvironment } from '../constants/gatheringIndoorOutdoor';
import { filterByEnvironment } from '../constants/environmentMatch';
import {
  SCORE_HAPPENING_NOW as WEATHER_BONUS,
  INTENT_SEARCH_TYPE_EMOJI, intentSearchDateLabel, intentSearchFallbackTitle, intentPhaseCaption,
} from '../services/intentResolverScoring';
import { isWeatherIndoorBiased, isWeatherOutdoorBiased, rankOffersByBusinessWeather, weatherMention } from '../utils/weatherBias';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { PLACE_CATEGORIES } from '../constants/placeCategories';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { railGroups } from '../constants/discoverCategoryRail';
import { friendGoingReason, communityReason } from '../utils/recommendationFacts';
import { getMyFriends } from '../services/friends';
import { becauseYouLikeReason, reasonText } from '../constants/recommendationReasonVocabulary';
import { localizeReason } from '../utils/reasonLocalization';
import { localizeAskNote } from '../i18n/askNoteView';
import { gatheringTimeBadge } from '../utils/gatheringTimeLabel';
import { splitTonight } from '../utils/categoryTonight';
import { buildDiscoverSections, buildDiscoverDateView, compareDiscover, sectionLeadReason, TIME_CHIPS } from '../utils/discoverSections';
import { SIGNAL_TIERS, tierVector } from '../constants/signalPriority';
import { recordSearchBehavior } from '../services/behaviorSignals';
import { searchTopic, matchBusinesses, friendsLineForTopic } from '../utils/unifiedSearch';
import { searchResultTabs, topResultKinds, effectiveResultTab, resultKindView } from '../utils/searchResultTabs';
import { foundBlockShownIds, withoutFoundBlock } from '../utils/searchTopDedupe';
import { matchesDateFilter } from '../utils/gatheringDateFilter';
import { lightenHex } from '../utils/colorUtils';
import GatheringsMapView from '../components/GatheringsMapView';
import PlaceCard from '../components/PlaceCard';
import TabHeaderActions from '../components/TabHeaderActions';
import DiscoveryScreen from './DiscoveryScreen';
import FriendDiscoveryScreen from './FriendDiscoveryScreen';
import { ModeTransition, FilterTransition, TapActiveChip, NearbyPickBadge, NLoader, FoundLine, modalAnimation, animateLayout } from '../motion';
import StaggeredReveal from '../components/StaggeredReveal';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { attendeeTotal, gatheringFullnessLabel } from '../utils/gatheringFullness';
import { gatheringSignalLine, PARTY_TYPE_LABELS } from '../constants/gatheringDisplaySignals';
// P2 remediation item 8 (CLAUDE.md, "Discover information parity") --
// the business/perk half of the same fix.
import { businessSignalLine } from '../constants/businessDisplaySignals';
import { getUserLocation } from '../services/userLocation';
import { filterOpenNow, gatheringEntity, placeEntity, perkEntity, businessEntity } from '../utils/operatingStatus';

// Phase 8 (CLAUDE.md, Discover visual hierarchy) -- real, disclosed
// thresholds against getGatheringFitReasons()'s real 0-22 score range
// (attendance capped at +10, interest match +5, distance +3, today +2,
// beginner-friendly +1, first-timer +1). Replaces the old flat ">= 5,
// always exactly 2 hero slots" rule: any gathering scoring at or above
// HERO_SCORE splits into a full-bleed hero card, STANDARD_SCORE into a
// lighter standard card -- however many genuinely qualify each day, never
// artificially capped at a fixed count. NOTABLE_DISPLAY_CAP is a real
// display-sanity limit (so a day with 20 qualifying gatherings doesn't
// turn the whole screen into hero cards), not a per-tier cap.
const HERO_SCORE = 12;
const STANDARD_SCORE = 5;
const NOTABLE_DISPLAY_CAP = 6;
// A real, disclosed judgment call for "trending enough to headline" (the
// approved-attendee count is 100% real data; only the cutoff itself is a
// UI decision) -- half of the fit-score formula's own attendance cap, so
// it's grounded in an existing number rather than invented from nothing.

// P1 UX critique reply item 14 (CLAUDE.md, "Things To Do needs a UX pass"):
// real caps for the new Happening Now / Today / This Weekend hierarchy that
// replaces the old single quick-date-chip-driven flat list below -- see
// this file's own header note at DISCOVER_MODES for the fuller rationale.
// Happening Now is deliberately small ("a small horizontal set" per the
// critique's own mock); Today/This Weekend get a slightly deeper vertical
// cap with a real "see more" link to the dedicated Gatherings screen
// (reusing its existing initialDateFilter param) once there's genuinely
// more than the cap.
const TIME_SECTION_CAP = 4;

// A lightened variant of a category's own real PALETTE color
// (gatheringCategoryStyles.js), for the hero card's gradient fallback --
// simple additive lightening, not real HSL math, since this only ever
// feeds a decorative gradient endpoint. Text legibility over it is handled
// separately by the hero card's own dark scrim (styles.heroScrim below),
// not by this function -- this never needs to hit a real contrast ratio
// on its own.
// Labels: ui.discover.typeFilter.<key> (the person's language).
const TYPE_FILTERS = [{ key: 'all' }, { key: 'gatherings' }, { key: 'communities' }, { key: 'places' }, { key: 'perks' }];

const PREVIEW_COUNT = 3;

// Item 74 (CLAUDE.md): INTENT_SEARCH_TYPE_EMOJI/intentSearchDateLabel/
// intentSearchFallbackTitle (Discover-local emoji equivalents of
// HomeScreen's own Ionicons-based result vocabulary, Item 39) moved to
// intentResolverScoring.js -- CelebrateSomethingScreen's own "Custom
// Occasion" step needed the identical shape, imported above instead of
// duplicated here.

// Aug 24 2026 (CLAUDE.md): Discover is now the real 🔎 bottom tab (it
// used to be a pushed screen reachable only via a single buried
// hyperlink, while People had a full tab for comparatively little
// content) — People merged in as a real mode, not a flattened dump.
// Dating and Friends stay two genuinely separate matching systems under
// the hood (separate opt-in flags, separate swipe tables, separate
// exclusion/safety rules); this is a navigation-only grouping, not a
// combined candidate pool. "Everyone" is still deliberately absent —
// there's no real merged pool to show under that label.
// Item 44 (CLAUDE.md, "give each screen ONE visual hero"): Things mode's
// subtitle is now a real lead-in question for the search bar directly
// beneath it ("What are you looking for?"), not a disconnected status
// line -- title+subtitle+search now read as one hero block instead of
// three separate elements each pulling their own weight.
// Labels: ui.discover.mode.<key> and ui.discover.mode.<key>Subtitle.
const DISCOVER_MODES = [
  { key: 'things', icon: '🔎' },
  { key: 'people', icon: '👥' },
];
// Aug 24 2026 (CLAUDE.md, direct follow-up): People mode itself now gets the
// identical segmented-toggle treatment as the outer Things-to-Do|People
// switch, one level down -- Dating and Friends were previously two rows that
// each navigated away to a full separate screen; now they're a real
// Discover-style toggle (same modeToggleRow/modeToggleButton chrome, no new
// visual language) that swaps embedded content in place, no navigation.
// DiscoveryScreen/FriendDiscoveryScreen are both mounted directly (their own
// `embedded` prop suppresses each screen's own redundant title, since this
// toggle already names the surface) -- still two genuinely separate matching
// systems underneath, this is a navigation-layer merge only.
// Labels: ui.discover.submode.<key>.
const PEOPLE_SUBMODES = [
  { key: 'dating', icon: '💗' },
  { key: 'friends', icon: '🤝' },
];
const LAST_MODE_KEY = 'discover_last_mode';
const LAST_PEOPLE_SUBMODE_KEY = 'discover_last_people_submode';

// A real unified search + filter + map/list surface across the four
// browsable, listable content types (gatherings, communities, places,
// perks) in Things-to-Do mode, plus a People mode (Stories + the
// Dating/Friends launcher, ported from the retired PeopleScreen). People
// are deliberately kept out of Things-to-Do's own unified text search —
// this is a proximity dating app, and search-by-name over nearby people
// is a stalking vector this codebase has never built anywhere else;
// Browse/Crossed Paths on the dedicated Nearby screen remains the only
// way to find people. "Card" view (the doc's third view style) was also
// left out: DiscoveryScreen already owns a dedicated swipe-card
// interaction for people, and a generic "everything" card view would
// need a bespoke action per content type with no single natural
// gesture — not built here. "AI recommendations" is a real, signal-based
// "Recommended for you" section (getGatheringFitReasons, the same pure
// scorer already used by Home's bestPick and GatheringDetailScreen)
// rather than a new LLM call, matching this codebase's existing
// no-new-API-cost convention.
export default function DiscoverHubScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const names = useCategoryNames(); // category / group names on chips and headings, in the person's language (display only)
  const { t, language } = useLanguage(); // recommendation reasons are shown in the person's language (utils/reasonLocalization.js)
  const styles = getStyles(colors, shadow);
  const { session } = useAuth();
  const myUserId = session?.user?.id ?? null;
  // Accepted friends only (never matches or strangers): powers the "Sam is going" reason on gathering cards.
  const [myFriendIds, setMyFriendIds] = useState(() => new Set());
  useEffect(() => {
    if (!myUserId) return undefined;
    let cancelled = false;
    getMyFriends().then((list) => { if (!cancelled) setMyFriendIds(new Set((list ?? []).map((f) => f.id))); }).catch(() => {});
    return () => { cancelled = true; };
  }, [myUserId]);

  // A no-uploaded-photo card falls back to the real curated category photo
  // first (same map/precedent as GatheringDetailScreen's and
  // GatheringsScreen's own cover-photo fallback -- a "Coffee" row shows
  // real coffee, not just a tinted swatch), and only drops to a plain
  // tinted icon block for the handful of categories with no sourced photo
  // or no real category at all (a moment/story group) -- reuses each
  // gathering/community's own real interest_tag color via
  // categoryStyleFor() (never a fabricated color), same convention
  // CommunityDetailScreen's iconBadge already established.
  function renderCardIcon(icon, interestTag) {
    const photoUrl = interestTag ? curatedCoverPhotoFor(interestTag) : null;
    if (photoUrl) {
      return <Image source={{ uri: photoUrl }} style={styles.cardImage} accessibilityLabel={`${interestTag} photo`} />;
    }
    const tint = interestTag ? `${categoryStyleFor(interestTag).color}20` : colors.surfaceElevated;
    return (
      <View style={[styles.cardIconWrap, { backgroundColor: tint }]}>
        <Text style={styles.cardIcon}>{icon}</Text>
      </View>
    );
  }

  // Item 41 ("make People about people, not dating"): a caller can now
  // deep-link straight into a specific mode/sub-mode (initialMode/
  // initialPeopleSubMode route params) instead of the remembered
  // last-used one -- closes the real gap where Home's own "N people
  // nearby" Quick Stats card used to route straight to the standalone,
  // dating-only DiscoveryScreen (`navigate('Nearby')`), a walled-off
  // single-purpose destination with no visible Friends option at all,
  // even though the count itself is a real dating-filtered signal
  // (getNearbyMatches()). It now lands here instead, on the same real
  // People > Dating|Friends toggle every other People entry point already
  // uses, pre-selected to Dating (still the same real destination content)
  // but with Friends one tap away -- see HomeScreen.js's own call site.
  const personalization = usePersonalization();
  const [mode, setMode] = useState(() => route.params?.initialMode ?? 'things');
  const [peopleSubMode, setPeopleSubMode] = useState(() => route.params?.initialPeopleSubMode ?? 'dating');

  useEffect(() => {
    // An explicit navigation intent (a route param) wins over the
    // remembered last-used mode for this one visit -- only fall back to
    // AsyncStorage's own memory when the caller didn't ask for something
    // specific, same as every other quickStart-style prefill in this
    // codebase leaves the remembered/default state alone once a real
    // param is present.
    if (!route.params?.initialMode) {
      AsyncStorage.getItem(LAST_MODE_KEY)
        .then((saved) => {
          if (saved === 'things' || saved === 'people') setMode(saved);
        })
        .catch(() => {});
    }
    if (!route.params?.initialPeopleSubMode) {
      // Item 46 follow-up ("mainly uses Friends should have Friends
      // content prioritized"): the remembered last-used value used to be
      // the whole story -- a single anomalous visit to the other mode
      // could flip the default immediately. Now a real, durable usage-
      // frequency signal (profiles.people_submode_dating_uses/
      // friends_uses) gets a say too, via the same pure decision
      // function (resolveDefaultPeopleSubMode) this codebase's other
      // scoring logic already follows -- it only overrides the
      // remembered value once usage is clearly, durably skewed; below
      // that it defers to the exact same last-used/default behavior as
      // before.
      Promise.all([
        AsyncStorage.getItem(LAST_PEOPLE_SUBMODE_KEY).catch(() => null),
        getMyPeopleSubModeUsage(),
      ]).then(([lastUsedSubMode, { datingUses, friendsUses, motivations }]) => {
        setPeopleSubMode(resolveDefaultPeopleSubMode({ datingUses, friendsUses, lastUsedSubMode, motivations }));
      });
    }
  }, []);

  // Item 76: opened from Home's "meet someone new tonight" claim -> lead with what it promised, counted from the pool
  // this screen is showing (Dating deck or friend-discovery), never a generic list.
  const meetTonightContext = route.params?.context === 'meet_tonight';
  const [meetTonightCount, setMeetTonightCount] = useState(null);
  useEffect(() => {
    if (!meetTonightContext || mode !== 'people') return undefined;
    let cancelled = false;
    setMeetTonightCount(null);
    (peopleSubMode === 'friends' ? getFriendDiscoveryCandidates(20) : getNearbyMatches())
      .then((list) => { if (!cancelled) setMeetTonightCount(countTonightSupply({ subMode: peopleSubMode, list })); })
      .catch(() => { if (!cancelled) setMeetTonightCount(null); });
    return () => { cancelled = true; };
  }, [meetTonightContext, mode, peopleSubMode]);
  const meetBanner = meetTonightContext && mode === 'people' ? peopleTonightBanner({ subMode: peopleSubMode, count: meetTonightCount }) : null;

  function selectMode(key) {
    setMode(key);
    // Switching to People is a genuine surface change -- an expanded
    // Things-to-Do context must not survive it and reappear later.
    closeContext();
    AsyncStorage.setItem(LAST_MODE_KEY, key).catch(() => {});
  }

  function selectPeopleSubMode(key) {
    setPeopleSubMode(key);
    AsyncStorage.setItem(LAST_PEOPLE_SUBMODE_KEY, key).catch(() => {});
    // Item 46 follow-up: a real, durable server-side usage count, not
    // just the local "last used" value above -- see
    // peopleSubModePreference.js for how this feeds back into the
    // default next time.
    recordPeopleSubModeUse(key);
  }

  // Item 46 (CLAUDE.md, "personalization should determine what appears
  // first"): null until a real, qualifying (3+ occurrences) recurring
  // search category is found in the caller's own intent_submissions
  // history -- stays null forever for a cold-start user, which is exactly
  // what lets the "{Category} Near You" section below render only when
  // it's genuinely earned (item 47).
  const [topSearchedCategory, setTopSearchedCategory] = useState(null);
  const [gatheringStories, setGatheringStories] = useState([]);
  // Real business-authored moments (CLAUDE.md items 11/13) -- the honest,
  // buildable version of "going live to promote a business": a real
  // photo/video post, real 24h expiry, reusing the exact same `stories`
  // infrastructure gathering memories already use, not real live video
  // streaming (no paid CDN/ingest vendor exists for this app). Merged
  // with gatheringStories below into one "Happening Nearby" row -- both
  // answer the identical job ("what's actually happening near me right
  // now"), so they read as one section, not two.
  const [businessMoments, setBusinessMoments] = useState([]);
  const [gatheringStoryViewer, setGatheringStoryViewer] = useState(null);
  // Discover UX cleanup item 8 (CLAUDE.md, 2026-09-10): the People tab's
  // Stories row is gone (its signal now lives on each candidate's own
  // avatar in DiscoveryScreen/SwipeableDiscoveryCards/
  // FriendDiscoverySwipeCards) -- this is its replacement "post a story"
  // entry point, moved to a small header icon per the user's own explicit
  // pick ("very small... don't make it another prominent card or CTA").
  // Item 42 (CLAUDE.md, 2026-09-11): the parallel "Public Stories Near
  // You" row that used to live here in Things-To-Do is gone too, for the
  // same reason -- a story is a signal on a person, not its own separate
  // list. Public-story posters who are also real Dating/Friends candidates
  // still surface via that same avatar-ring mechanism; this screen no
  // longer has its own second Stories surface.
  const [postingStory, setPostingStory] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  // Item 93: which result tab an All-view search is showing (Top Results until the person picks another).
  const [searchTab, setSearchTab] = useState('top');
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const rail = useMemo(() => railGroups(CATEGORY_GROUPS), []);
  // Item 39 (CLAUDE.md, "search should understand the same language as the
  // intent box"): a real, natural-language understanding of the same typed
  // search -- explicit-submit only (onSubmitEditing), not debounced on
  // every keystroke like the literal search below, since it costs a real
  // LLM round trip (runIntentSearch -> classifyCreateRequest) each time,
  // same reasoning HomeScreen's own ask box already follows ("Find it" is
  // a button press, never a live-typing call). intentSearchRequestId
  // guards against a stale response landing after the query text has
  // already moved on, same pattern searchRequestId/placesRequestId below
  // already use for the exact same race.
  const [intentSearch, setIntentSearch] = useState(null);
  // Item 189: only a submitted typed ask (never Surprise Me / pick-for-me, never typing) can trigger the Places search.
  const placesToGo = usePlacesToGo(intentSearch && intentSearch.outcome !== 'pick_for_me' ? (intentSearch.typedText ?? null) : null, language);
  const [intentRefining, setIntentRefining] = useState(false); // item 107 refinement chips
  const [intentSearching, setIntentSearching] = useState(false);
  const [intentPhase, setIntentPhase] = useState(null); // Item 135: real pipeline phase

  const intentSearchRequestId = useRef(0);
  // The active typed-ask session (item 108 follow-up, services/discoverSession.js): saved on the device for this user whenever the
  // ask or its refinements change, restored (fresh results, no AI call) when Discover opens with no ask, ended only by clearing
  // or changing the search. restoreFailed keeps the saved session and offers Try again.
  const [restoreFailed, setRestoreFailed] = useState(null);
  const sessionCheckedFor = useRef(null);
  async function restoreSession(saved) {
    const thisRequestId = ++intentSearchRequestId.current;
    setRestoreFailed(null);
    setIntentSearching(true);
    try {
      const next = await restoreDiscoverAsk(saved);
      if (thisRequestId !== intentSearchRequestId.current) return;
      if (next.openNowOnly) setOpenNowOnly(true);
      setIntentSearch(next);
    } catch (e) {
      console.error('Discover session restore failed', e);
      if (thisRequestId === intentSearchRequestId.current) setRestoreFailed(saved);
    }
    if (thisRequestId === intentSearchRequestId.current) setIntentSearching(false);
  }
  // Cross-device (services/discoverSessionSync.js): the account's session is the source of truth, the device store its cache.
  // localEdit counts the person's own changes, so an account answer that arrives after they changed something never overrides it.
  const localEdit = useRef(0);
  const lastSynced = useRef(null); // {sessionId, updatedAt} last known to match the account
  const clearedSession = useRef(null);
  const accountApplied = useRef(false);
  function applyAccountSession(session, editAtStart) {
    if (localEdit.current !== editAtStart) return;
    accountApplied.current = true;
    if (sameSession(session, lastSynced.current)) return;
    lastSynced.current = session ? { sessionId: session.sessionId, updatedAt: session.updatedAt } : null;
    if (!session) {
      // cleared on another device (or expired): end it here too
      ++intentSearchRequestId.current;
      setRestoreFailed(null);
      setIntentSearch((cur) => (cur && cur.outcome !== 'pick_for_me' ? null : cur));
      setSearchQuery(''); // safe: the guard above means the person has not typed since
      return;
    }
    setSearchQuery(session.typedText);
    restoreSession(session);
  }
  function syncFromAccount() {
    if (!myUserId) return;
    const editAtStart = localEdit.current;
    syncDiscoverSession(myUserId)
      .then((session) => applyAccountSession(session, editAtStart))
      .catch((e) => console.warn('Discover session sync unavailable; using this device', e?.message));
  }
  function endSearchSession() {
    ++localEdit.current;
    setRestoreFailed(null);
    discoverSession.clear(myUserId);
    const sid = intentSearch?.sessionId ?? restoreFailed?.sessionId ?? null;
    if (sid && clearedSession.current !== sid) {
      clearedSession.current = sid;
      lastSynced.current = null;
      pushClear(sid).catch((e) => console.warn('Discover session clear not synced', e?.message));
    }
  }
  // Surprise Me typed into this search box (owner, 2026-09-26): the SAME engine as Home (services/surpriseMe.js), shown inline
  // here; never a keyword search for the phrase, never logged as a search.
  const [discoverSurprise, setDiscoverSurprise] = useState(null);
  const discoverSurpriseShown = surpriseView(discoverSurprise, language); // the same decisions, worded in the person's language
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const surpriseRequestId = useRef(0);
  const [typeFilter, setTypeFilter] = useState(() => route.params?.initialTypeTab ?? 'all');
  function setTypeTab(key) {
    setTypeFilter(key);
  }
  const isAll = typeFilter === 'all';
  // Open now (owner item 71): one toggle over every tab and category view; typed "what's open" asks turn it on too. The rule
  // is utils/operatingStatus.js only -- this screen never decides open/closed itself.
  const [openNowOnly, setOpenNowOnly] = useState(false);
  // Item 137: a destination keeps the context it was opened with. Arriving from a weather card's "outdoor"/"indoor" pick
  // narrows gatherings to that side (the same category rule as the Gatherings feed's environment filter); it shows as a
  // removable chip and is never set any other way (no new filter control).
  const [environmentFilter, setEnvironmentFilter] = useState(() => {
    const env = route.params?.initialEnvironment;
    return env === 'outdoor' || env === 'indoor' ? env : null;
  });
  // Discover is a tab and stays mounted, so a later tap from Home with new context (a mode, a type tab, an environment)
  // must apply when it arrives, not only on first mount. Each navigation carries its own context; one without an
  // environment clears a previous one. The tab bar re-opens Discover with the SAME params object, so nothing re-applies.
  const appliedParamsRef = useRef(route.params);
  useEffect(() => {
    const p = route.params;
    if (!p || p === appliedParamsRef.current) return;
    appliedParamsRef.current = p;
    if (p.initialMode === 'things' || p.initialMode === 'people') setMode(p.initialMode);
    if (p.initialPeopleSubMode === 'dating' || p.initialPeopleSubMode === 'friends') setPeopleSubMode(p.initialPeopleSubMode);
    if (p.initialTypeTab) setTypeFilter(p.initialTypeTab);
    setEnvironmentFilter(p.initialEnvironment === 'outdoor' || p.initialEnvironment === 'indoor' ? p.initialEnvironment : null);
    setDateView(null); // a new navigation into Discover carries its own context; it never lands inside a date view
    // A link to one perk opens Perks with that perk selected and scrolled into view; any other arrival starts unselected.
    if (p.selectPerkId) {
      closeContext();
      setViewStyle('list');
      selectPerk(p.selectPerkId, { fromLink: true });
      setScrollToPerk(p.selectPerkId);
    } else {
      clearPerkSelection();
    }
  }, [route.params]);
  // Item 76: the exact declared-cuisine filter inside the Restaurants view (null = broad). Lives only while a context is open.
  const [cuisineFilter, setCuisineFilter] = useState(null);
  const [viewStyle, setViewStyle] = useState('list');
  const [placesCategory, setPlacesCategory] = useState('food_drink');
  const [userLocation, setUserLocation] = useState(null);

  const [gatherings, setGatherings] = useState([]);
  // Accepted friends who declared each tag on screen (server-enforced): powers "Sam is into Coffee" on a card.
  const [friendInterestByTag, setFriendInterestByTag] = useState({});
  const gatheringTagKey = [...new Set(gatherings.map((g) => g.interest_tag).filter(Boolean))].sort().join('|');
  useEffect(() => {
    if (!gatheringTagKey) return undefined;
    let cancelled = false;
    getFriendsInterestedIn(gatheringTagKey.split('|')).then((m) => { if (!cancelled) setFriendInterestByTag(m); });
    return () => { cancelled = true; };
  }, [gatheringTagKey]);
  // Item 92: accepted friends into the searched topic (the same server-enforced lookup; names only as it returns them).
  const [searchTopicFriendMap, setSearchTopicFriendMap] = useState({});
  const searchTopicTagKey = (searchTopic(discoverQuery(searchQuery).literalTerm)?.tags ?? []).slice(0, 20).join('|');
  useEffect(() => {
    if (!searchTopicTagKey) { setSearchTopicFriendMap({}); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      getFriendsInterestedIn(searchTopicTagKey.split('|')).then((m) => { if (!cancelled) setSearchTopicFriendMap(m ?? {}); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchTopicTagKey]);
  const [communities, setCommunities] = useState([]);
  const [offers, setOffers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [places, setPlaces] = useState([]);
  const [coverPhotoUrls, setCoverPhotoUrls] = useState({});
  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- real per-offer
  // redemption state (BrandOffersScreen's own getMyRedemptions(), not a new
  // signal) so a Perks row can honestly show "Redeemed ✓" instead of always
  // "Redeem" regardless of whether the user already has.
  const [redeemedOfferIds, setRedeemedOfferIds] = useState(new Set());
  // Perk Selection State (owner, 2026-10-04): Discover -> Perks is the ONE perk surface. Tapping a perk (or arriving from a
  // link to one: selectPerkId) selects it IN PLACE: its card expands to show the redemption context and Redeem, nothing
  // navigates, no second list. It is temporary focus on one object, not a filter and not saved: Close / tapping the card
  // again / Android Back returns to the normal list, and switching tabs, mode, type tab or search ends it.
  const [selectedPerkId, setSelectedPerkId] = useState(() => route.params?.selectPerkId ?? null);
  const [selectedPerkFromLink, setSelectedPerkFromLink] = useState(() => !!route.params?.selectPerkId);
  const [scrollToPerk, setScrollToPerk] = useState(() => route.params?.selectPerkId ?? null);
  const perkCardRefs = useRef({});
  function selectPerk(id, { fromLink = false } = {}) {
    setSelectedPerkId(id);
    setSelectedPerkFromLink(fromLink);
  }
  function clearPerkSelection() {
    setSelectedPerkId(null);
    setSelectedPerkFromLink(false);
    setScrollToPerk(null);
  }

  // Phase 8 section F (CLAUDE.md, Discover visual hierarchy) -- "expand in
  // place". Tapping a notable card reconfigures THIS screen around that
  // result's own real context (its interest tag + its time bucket + the
  // nearby scope Discover already loads under) instead of navigating away.
  // Deliberately local component state and not a nav param: the whole
  // point of the Progressive Depth doctrine ("don't navigate for
  // information, navigate for tasks") is that answering "what else is like
  // this?" is not a task change and must not push a screen. Committing to
  // an action still navigates for real -- the card's own Join/Request CTA
  // opens GatheringDetailScreen exactly as before, since that's where the
  // real join mutation and all its edge cases live.
  const [expandedContext, setExpandedContext] = useState(null);
  // Item 17 (owner, 2026-10-04): a business tapped on a browsing surface (result row, map pin) opens the shared preview sheet
  // over Discover; nothing underneath changes. Perks and gatherings keep their own in-place expansion.
  const [previewBusiness, setPreviewBusiness] = useState(null);
  // A screen opened on top (a push tap, an action from the sheet) never keeps the sheet floating over it.
  useFocusEffect(useCallback(() => () => setPreviewBusiness(null), []));
  // Owner item 206: "See all" on Tonight/Today or This Weekend turns Discover into the full date view IN PLACE ('today' |
  // 'weekend' | null). Everything else (mode, type tab, Open now, Outdoor, search) is untouched, and leaving restores the
  // sections at the scroll position they were left at.
  const [dateView, setDateView] = useState(null);
  const mainScrollRef = useRef(null);
  const mainScrollY = useRef(0);
  const restoreScrollY = useRef(null);
  const [contextPlaces, setContextPlaces] = useState([]);
  const [loadingContextPlaces, setLoadingContextPlaces] = useState(false);
  // Section G -- real connections only (accepted friends + real matches),
  // and only ones independently relevant to this context (they actually
  // RSVP'd to one of the gatherings shown). Never a proximity/interest
  // scan over strangers -- see CLAUDE.md's standing hard privacy rule.
  const [contextConnections, setContextConnections] = useState([]);
  const [contextConnectionPhotos, setContextConnectionPhotos] = useState({});
  const contextPlacesRequestId = useRef(0);
  const contextConnectionsRequestId = useRef(0);

  function openContextFor(g) {
    // A gathering with no real interest_tag has no real context to expand
    // into -- honest fallback to the real detail screen rather than an
    // empty "· Tonight · Nearby" breadcrumb over a one-item list.
    if (!g.interest_tag) {
      openDestination(navigation, discoverCard(g).destination);
      return;
    }
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
    setCuisineFilter(null);
    setExpandedContext({
      interestTag: g.interest_tag,
      // gatheringTimeBadge's own vocabulary (RIGHT NOW / TODAY / TONIGHT /
      // THIS WEEKEND / UPCOMING), not a second time system invented here.
      timeBucket: gatheringTimeBadge(g.scheduled_at),
      sourceGatheringId: g.id,
    });
  }

  // P1 UX critique reply item 14: the new "Categories" browse row's own
  // entry point into the exact same expand-in-place mechanism Section F
  // already built -- generalized to scope by a whole CATEGORY_GROUPS
  // group's real tags instead of one gathering's own single interest_tag,
  // and deliberately with no timeBucket constraint (Categories answers
  // "what," not "when" -- Happening Now/Today/This Weekend already own
  // the time axis). contextGatherings/contextOffers/the places-search
  // effect below all branch on categoryTags being present.
  function openCategoryContext(group) {
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
    setCuisineFilter(null);
    setExpandedContext({
      categoryTags: group.tags,
      categoryLabel: group.label,
      categoryIcon: group.icon,
      categoryKey: group.key,
    });
  }

  // Item 92: the searched topic opens the same in-place category view (a group, one tag, or a declared cuisine).
  function openSearchTopic(topic) {
    if (!topic) return;
    if (topic.kind === 'group') { openCategoryContext(topic.group); return; }
    if (topic.kind === 'cuisine') { openCuisineContext(topic.cuisine); return; }
    openCategoryContext({ tags: topic.tags, label: topic.label, icon: topic.icon, key: null });
  }

  // A typed cuisine ("Italian dinner tonight") opens the SAME Restaurants view with the same exact constraint the chip sets.
  function openCuisineContext(cuisine) {
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
    setCuisineFilter(cuisine);
    setExpandedContext({ interestTag: 'Restaurants' });
  }

  // Item 46's "{Category} Near You" section's own "See all" -- the exact
  // same single-interestTag expand-in-place shape openContextFor() above
  // already uses for one gathering's own tag, just entered directly by
  // the personalized category itself rather than via a specific tile.
  function openTopCategoryContext() {
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
    setCuisineFilter(null);
    setExpandedContext({ interestTag: topSearchedCategory.category });
  }

  function openDateView(dateFilter) {
    restoreScrollY.current = mainScrollY.current;
    setDateView(dateFilter);
  }

  function closeDateView() {
    setDateView(null);
  }

  // Item 34: the time chips open the same in-place date view as "See all". One at a time; the active chip closes it; another
  // chip switches without losing where the sections were left.
  function selectTimeChip(f) {
    if (dateView === f) closeDateView();
    else if (dateView) setDateView(f);
    else openDateView(f);
  }

  function renderTimeChips() {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ flex: 1 }}>
        {TIME_CHIPS.map((f) => {
          const active = !!dateViewData && dateViewData.dateFilter === f;
          const label = active ? sectionTitle(dateViewData) : t(`ui.discover.section.${f}`);
          return (
            <TapActiveChip
              key={f}
              active={active}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => selectTimeChip(f)}
              accessibilityLabel={active ? t('ui.discover.selectedTapClear', { label }) : label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{active ? `${label} ✕` : label}</Text>
            </TapActiveChip>
          );
        })}
      </ScrollView>
    );
  }

  // The default list remounts when the date view closes; put it back where the person left it once its content is laid out.
  function restoreMainScroll(_w, h) {
    const y = restoreScrollY.current;
    if (y == null || dateView) return;
    if (h >= y) {
      restoreScrollY.current = null;
      mainScrollRef.current?.scrollTo({ y, animated: false });
    }
  }

  function closeContext() {
    setExpandedContext(null);
    setCuisineFilter(null);
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
  }

  // Thursday plan item 25 ("empty states should become invitations"):
  // "Enable location" used to be plain text with nothing to tap --
  // loadCore() above only ever checked the existing permission
  // (getForegroundPermissionsAsync), never prompted for it, so a user who'd
  // said no once had no path back in from here. A real prompt, using the
  // same expo-location already imported for that check.
  async function enableLocation() {
    const position = await getUserLocation({ fresh: true, force: true });
    if (position) {
      setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      loadCore(); // Happening Now/Today/This Weekend were empty without a position
    }
  }

  // Every Discover gathering list orders by the one ranking ladder (compareDiscover in utils/discoverSections.js): friends,
  // room, today, interests, then weather and attendance; nearest breaks the remaining ties.

  // Android hardware back clears the expanded context instead of leaving
  // the whole Discover tab -- without this, "back" from an expanded view
  // would feel like it skipped a level, since going in never pushed one.
  useEffect(() => {
    if (!expandedContext) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeContext();
      return true;
    });
    return () => sub.remove();
  }, [expandedContext]);
  // Item 206: Android back leaves the date view first (one level), the same way it leaves a category view.
  useEffect(() => {
    if (!dateView) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeDateView();
      return true;
    });
    return () => sub.remove();
  }, [dateView]);

  const [loadingCore, setLoadingCore] = useState(true);
  // Item 138: Discover refreshes every time it regains focus (e.g. Back from a result). Only the FIRST load shows the
  // loader; later refreshes update the lists in place, so Back returns to the same category, filters, search and scroll
  // position instead of a loader pushing everything down.
  const [coreLoadedOnce, setCoreLoadedOnce] = useState(false);
  const showCoreLoader = loadingCore && !coreLoadedOnce;
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const placesRequestId = useRef(0);

  // Real weather signal (same async submit-then-poll RPC Home's own weather
  // card already uses), fetched non-blocking after the main load resolves --
  // never awaited as part of loadCore's own Promise.all, since the RPC has
  // an inherent ~2s round trip and this is purely supplementary ranking
  // context, not core content. See CLAUDE.md, 14-item UX review item 9.
  const [weatherSignal, setWeatherSignal] = useState(null);

  // Real search results for gatherings/communities, fetched server-side via
  // searchGatherings()/searchPublicCommunities() (indexed ILIKE queries)
  // instead of filtering the already-fetched `gatherings`/`communities`
  // arrays client-side. Only populated once a real search is active — see
  // the debounced effect below.
  const [searchedGatherings, setSearchedGatherings] = useState([]);
  const [searchedCommunities, setSearchedCommunities] = useState([]);
  const [searchedOffers, setSearchedOffers] = useState([]);

  // Perk Selection State: Android Back returns to the normal Perks list first. A perk opened from another screen (a link,
  // with a return trail back to that screen) goes straight back there instead, so Perks never traps the person. Re-registered
  // when the trail changes so this handler stays ahead of ReturnTrailChip's.
  const [trailVersion, setTrailVersion] = useState(0);
  useEffect(() => subscribeTrail(() => setTrailVersion((v) => v + 1)), []);
  useEffect(() => {
    if (!selectedPerkId) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const backToOrigin = selectedPerkFromLink && getTrail()?.tab === 'Discover';
      clearPerkSelection();
      return !backToOrigin; // false lets the return trail reopen the screen the person came from
    });
    return () => sub.remove();
  }, [selectedPerkId, selectedPerkFromLink, trailVersion]);
  // Selection is not saved Discover state: switching to another tab ends it. A screen opened on top (the business profile)
  // keeps it, so Back from there lands on the same selected perk.
  useEffect(() => navigation.addListener('blur', () => {
    const tabs = navigation.getState?.();
    const focusedTab = tabs?.routes?.[tabs.index ?? 0]?.name;
    if (focusedTab && focusedTab !== route.name) clearPerkSelection();
  }), [navigation, route.name]);
  // Leaving Perks (People mode, or a type tab without perks) ends the selection.
  const perksTabShown = mode === 'things' && (typeFilter === 'all' || typeFilter === 'perks');
  useEffect(() => {
    if (selectedPerkId && !perksTabShown) clearPerkSelection();
  }, [perksTabShown, selectedPerkId]);
  // A link to a perk that is no longer active (expired, fully claimed and removed) selects nothing once perks have loaded.
  useEffect(() => {
    if (!selectedPerkId || !coreLoadedOnce) return;
    if (!offers.some((o) => o.id === selectedPerkId) && !searchedOffers.some((o) => o.id === selectedPerkId)) clearPerkSelection();
  }, [selectedPerkId, coreLoadedOnce, offers, searchedOffers]);
  // Bring a linked (or map-picked) perk into view once its card is laid out.
  useEffect(() => {
    if (!scrollToPerk) return undefined;
    const timer = setTimeout(() => {
      const card = perkCardRefs.current[scrollToPerk];
      const scroller = mainScrollRef.current;
      if (!card || !scroller) return;
      try {
        card.measureLayout(scroller.getInnerViewNode?.() ?? scroller, (_x, y) => {
          scroller.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
        }, () => {});
      } catch (e) { /* measuring is best-effort: the card is still shown first when the list did not hold it */ }
      setScrollToPerk(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToPerk, offers, searchedOffers, typeFilter]);

  const [loadingSearchRaw, setLoadingSearch] = useState(false);
  // Item 93: the exact term the searched lists / Places list belong to, so a previous query's results are never shown
  // under a new one (they count as still loading until the new term's results land).
  const [searchedTerm, setSearchedTerm] = useState(null);
  const [placesTerm, setPlacesTerm] = useState(undefined);
  // Decision 5 (CLAUDE.md, Aug 27 2026): the "create it" completion CTA's
  // own in-flight state, while classifyCreateRequest() runs.
  const [creatingFromSearch, setCreatingFromSearch] = useState(false);
  const searchRequestId = useRef(0);
  const joinedCommunityIdsRef = useRef(new Set());

  useFocusEffect(
    useCallback(() => {
      loadGatheringStories();
      loadBusinessMoments();
      loadCore();
      getMyTopSearchedCategory().then(setTopSearchedCategory);
    }, [])
  );

  async function loadCore() {
    setLoadingCore(true);
    try {
      // These three don't need location at all -- start them immediately
      // rather than waiting on the location permission check + GPS fix
      // below (which can itself take a couple of seconds) before even
      // kicking them off.
      const gatheringsPromise = getNearbyGatherings('wide');
      const publicCommunitiesPromise = getPublicCommunities();
      const myCommunitiesPromise = getMyCommunities();

      let loc = null;
      // Default ask (deduped with getNearbyGatherings' own): a check-only read here raced that prompt and
      // left userLocation null on a first-run Allow.
      const position = await getUserLocation();
      if (position) {
        loc = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setUserLocation(loc);
      }

      const [gatheringsData, publicCommunities, myCommunities, offersData, businessesData, redeemedIds] = await Promise.all([
        gatheringsPromise,
        publicCommunitiesPromise,
        myCommunitiesPromise,
        getActiveOffers(loc?.latitude ?? null, loc?.longitude ?? null),
        getNearbyBusinesses(loc?.latitude ?? null, loc?.longitude ?? null),
        getMyRedemptions(),
      ]);

      const joinedCommunityIds = new Set(myCommunities.map((c) => c.id));
      joinedCommunityIdsRef.current = joinedCommunityIds;
      setGatherings(gatheringsData);
      setCommunities(publicCommunities.filter((c) => !joinedCommunityIds.has(c.id)));
      setOffers(offersData);
      setBusinesses(businessesData);
      setRedeemedOfferIds(new Set(redeemedIds));

      const coverEntries = await Promise.all(
        gatheringsData.map(async (g) => {
          if (!g.cover_photo_path) return null;
          const url = await getSignedGatheringPhotoUrl(g.cover_photo_path);
          return [g.id, url];
        })
      );
      setCoverPhotoUrls(Object.fromEntries(coverEntries.filter(Boolean)));
      setCoreLoadedOnce(true);

      // Fire-and-forget, never awaited -- a real forecast signal is
      // supplementary ranking context (see the `recommended` computation
      // below), never something the rest of the screen should wait on.
      if (loc) {
        getSocialForecast(loc.latitude, loc.longitude).then(setWeatherSignal).catch(() => {});
      }
    } catch (e) {
      console.error('Discover loadCore failed', e);
    }
    setLoadingCore(false);
  }

  // Places is a metered external API (Google Places), so unlike the
  // three sources above it's fetched on-demand only: when someone
  // actually looks at Places, or types a real search with location
  // available — never on every keystroke across every section.
  useEffect(() => {
    const { literalTerm } = discoverQuery(searchQuery); // null for Surprise Me / undecided asks (never a keyword search)
    const wantsPlaces = typeFilter === 'places' || (typeFilter === 'all' && !!literalTerm);
    if (!wantsPlaces || !userLocation) return;
    const thisRequestId = ++placesRequestId.current;
    const timer = setTimeout(async () => {
      setLoadingPlaces(true);
      try {
        const category = typeFilter === 'places' ? placesCategory : null;
        const keyword = literalTerm;
        const results = await searchNearbyPlaces(userLocation.latitude, userLocation.longitude, category, keyword);
        if (thisRequestId === placesRequestId.current) { setPlaces(results); setPlacesTerm(keyword ?? null); }
      } catch (e) {
        console.error('Discover places search failed', e);
        if (thisRequestId === placesRequestId.current) { setPlaces([]); setPlacesTerm(literalTerm ?? null); }
      }
      if (thisRequestId === placesRequestId.current) setLoadingPlaces(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [typeFilter, placesCategory, searchQuery, userLocation]);

  // Real gathering/community search, server-side and indexed (trigram GIN
  // indexes, 20260809_indexed_text_search.sql) rather than downloading every
  // future gathering / public community and filtering it client-side.
  // Same 2-character minimum and 350ms debounce as the Places search above,
  // for the same reason — no query fired on every keystroke.
  useEffect(() => {
    const term = discoverQuery(searchQuery).literalTerm; // null for Surprise Me / undecided asks and too-short text
    if (!term) {
      setSearchedGatherings([]);
      setSearchedCommunities([]);
      setSearchedOffers([]);
      setSearchedTerm(null);
      return;
    }
    const thisRequestId = ++searchRequestId.current;
    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const [gatheringResults, communityResults, offerResults] = await Promise.all([
          searchGatherings(term, 'wide'),
          searchPublicCommunities(term),
          searchOffers(term, userLocation?.latitude ?? null, userLocation?.longitude ?? null),
        ]);
        if (thisRequestId === searchRequestId.current) {
          setSearchedGatherings(gatheringResults);
          setSearchedCommunities(communityResults.filter((c) => !joinedCommunityIdsRef.current.has(c.id)));
          setSearchedOffers(offerResults);
          setSearchedTerm(term);
          recordSearchBehavior(term); // item 95: private ranking signal (category only), never a profile edit
        }
      } catch (e) {
        console.error('Discover search failed', e);
        if (thisRequestId === searchRequestId.current) {
          setSearchedGatherings([]);
          setSearchedCommunities([]);
          setSearchedOffers([]);
          setSearchedTerm(term);
        }
      }
      if (thisRequestId === searchRequestId.current) setLoadingSearch(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, userLocation]);

  async function loadGatheringStories() {
    try {
      const grouped = await getGatheringStoriesGrouped();
      setGatheringStories(grouped);
    } catch (e) {
      console.error('loadGatheringStories failed', e);
    }
  }
  async function loadBusinessMoments() {
    try {
      const grouped = await getBusinessMomentsGrouped();
      setBusinessMoments(grouped);
    } catch (e) {
      console.error('loadBusinessMoments failed', e);
    }
  }

  // One merged "Happening Nearby" list -- gathering memories and real
  // business moments genuinely answer the same question, so they render
  // as one section, sorted by real recency, not two competing ones.
  const happeningNearby = [
    ...gatheringStories.map((group) => ({
      kind: 'gathering',
      key: `gathering-${group.gatheringId}`,
      icon: '🎉',
      title: group.gatheringTitle,
      posterLabelFallback: group.gatheringTitle,
      stories: group.stories,
    })),
    ...businessMoments.map((group) => ({
      kind: 'business',
      key: `business-${group.partnerId}`,
      icon: '🔴',
      title: group.partnerName ?? t('ui.discover.aLocalBusiness'),
      posterLabelFallback: group.partnerName ?? t('ui.discover.aLocalBusiness'),
      stories: group.stories,
    })),
  ].sort((a, b) => new Date(b.stories[0]?.created_at ?? 0) - new Date(a.stories[0]?.created_at ?? 0));

  const q = searchQuery.trim().toLowerCase();
  // 2-character minimum, matching the Places search's own established
  // threshold (and the debounced effect above, which only fires a real
  // gatherings/communities query at this same length) — a single keystroke
  // doesn't count as "searching" anywhere else on this screen either.
  // One classification of the search box (utils/discoverQuery.js): a Surprise Me / undecided ask is its own intent, never a search.
  const query = discoverQuery(searchQuery);
  const surpriseTyped = query.kind === 'pick_for_me';
  const isSearching = query.kind === 'search';
  // Results are fresh only when they were fetched for exactly this term; otherwise they are loading, never shown.
  const searchResultsFresh = !isSearching || searchedTerm === query.literalTerm;
  const loadingSearch = loadingSearchRaw || !searchResultsFresh;
  const placesFresh = !(isAll && isSearching) || !userLocation || placesTerm === query.literalTerm;
  const placesPending = loadingPlaces || !placesFresh;

  // Gatherings/communities: real server-side, indexed search results
  // (searchedGatherings/searchedCommunities, populated by the debounced
  // effect above) once actively searching, instead of client-side
  // .filter().includes() over the full already-fetched browse lists.
  // Communities have no hours, so the Open-now chip is not offered on that tab; everywhere else it keeps only confirmed-open
  // results (unknown hours are left out on purpose) and hides communities from the blended view.
  const openNowActive = openNowOnly && (!!expandedContext || typeFilter !== 'communities');
  const openNowAt = new Date();
  const applyOpenNow = (list, toEntity) => (openNowActive ? filterOpenNow(list, toEntity, openNowAt) : list);
  // Outdoor / Indoor (carried in from a Home weather card): one declared-data rule for every kind (constants/environmentMatch.js).
  // Unknown is left out; a business's side is only what it declared, never its type; Google places declare nothing.
  const applyEnv = (list, kind) => filterByEnvironment(list, kind, environmentFilter);
  const filteredGatherings = filterGatheringsByEnvironment(
    applyOpenNow(isSearching ? (searchResultsFresh ? searchedGatherings : []) : gatherings, gatheringEntity),
    environmentFilter,
  );
  const filteredCommunities = openNowActive ? [] : applyEnv(isSearching ? (searchResultsFresh ? searchedCommunities : []) : communities, 'community');
  // Offers: real server-side, indexed search results (searchedOffers,
  // populated by the debounced effect above — a genuine cross-table search
  // over brand_offers.title/description and brand_partners.name via the new
  // search_offer_ids() RPC) once actively searching, instead of the
  // client-side .filter().includes() this used before.
  // A business's own weather setting re-ranks perks (item 63): ranks, never hides; unchanged order without a weather signal.
  const filteredOffers = rankOffersByBusinessWeather(applyEnv(applyOpenNow(isSearching ? (searchResultsFresh ? searchedOffers : []) : offers, (o) => perkEntity(o)), 'perk'), weatherSignal);

  // Weather-aware re-ranking (CLAUDE.md, 14-item UX review item 9) --
  // reuses isIndoorCategory/isOutdoorCategory (Home's own weather card
  // map) applied here as a real scoring bonus (not just a caption) using
  // WEATHER_BONUS (SCORE_HAPPENING_NOW's own weight, not a new invented
  // number). Only ever applied once a real signal exists -- weatherSignal
  // stays null until the background fetch resolves, and getSocialForecast()
  // already returns null for the ambiguous 'Good' case, so no bonus/banner
  // fires on a weak signal.
  //
  // P2 item 7 (Universal Signal Remediation Pass, CLAUDE.md, Aug 28 2026):
  // the bias check itself is now the one shared isWeatherIndoorBiased/
  // isWeatherOutdoorBiased (utils/weatherBias.js) instead of this
  // screen's own forecast_label-only definition -- a real, disclosed
  // widening: this now also picks up a genuine forecast-derived risk
  // (rain_risk/heat_risk/cold_risk) or a genuinely favorable forecast
  // (outdoor_favorable), not just the current-conditions label, closing
  // the exact inconsistency the audit found against Home's own weather
  // card. weatherSignal already carries every field these checks read --
  // no new fetch.
  const weatherIndoorBias = isWeatherIndoorBiased(weatherSignal);
  const weatherOutdoorBias = isWeatherOutdoorBiased(weatherSignal);
  // Item 193: the banner and the card reasons name the weather only when it materially changes the picks (weatherMention);
  // ordinary good weather still nudges outdoor gatherings up through the bias above, silently.
  const weatherSaid = weatherMention(weatherSignal);
  const weatherBanner = weatherSaid === 'indoor'
    ? t('ui.discover.weatherIndoor')
    : weatherSaid === 'outdoor'
      ? t('ui.discover.weatherOutdoor')
      : null;

  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- one real scored list,
  // replacing the old two-independent-passes design (a separate
  // "Recommended" pass filtering on fit.score, and a separate "Trending"
  // pass sorting on attendance, each blind to what the other had already
  // picked). getGatheringFitReasons()'s score formula already folds
  // attendance, interest match, distance, and today-ness into one number,
  // so a single sort by that score surfaces both "personalized" and
  // "genuinely popular" gatherings without two selection passes that could
  // otherwise pick the same gathering for two different reasons. Each
  // qualifying gathering's tile tier (hero vs. standard) is decided
  // per-item against HERO_SCORE below, in the render itself -- never a
  // fixed "first N are hero" rule.
  // Shared by notableGatherings (below, the dedicated Gatherings tab's own
  // unchanged behavior) and the new Happening Now/Today/This Weekend
  // sections (P1 UX critique reply item 14) -- one real scoring function
  // instead of three copies of the same weather-bonus branch.
  function scoreGathering(g) {
    const fit = getGatheringFitReasons(g);
    if (weatherIndoorBias && isIndoorCategory(g.interest_tag)) {
      fit.score += WEATHER_BONUS;
      if (weatherSaid === 'indoor') fit.reasons = [...fit.reasons, reasonText('goodForWeather')];
    } else if (weatherOutdoorBias && isOutdoorCategory(g.interest_tag)) {
      fit.score += WEATHER_BONUS;
      if (weatherSaid === 'outdoor') fit.reasons = [...fit.reasons, reasonText('greatWeatherForIt')];
    }
    // Behavior (what this user actually opens/creates/joins) nudges the score as the account matures; declared interests are
    // already inside fit.score, so only the behavioral part is added here.
    const nudge = behaviorNudge(g.interest_tag, personalization);
    if (nudge > 0) {
      fit.score += nudge;
      fit.reasons = [...fit.reasons, reasonText('likeWhatYouJoined')];
    }
    const relatedHobby = relatedHobbyFor(g.interest_tag, personalization.declared);
    const related = relatedHobbyNudge(g.interest_tag, personalization);
    if (related > 0) {
      fit.score += related;
      fit.reasons = [...fit.reasons, relatedInterestReason(relatedHobby)];
    }
    const broad = broadGroupNudge(g.interest_tag, personalization);
    if (broad > 0) {
      fit.score += broad;
      fit.reasons = [...fit.reasons, reasonText('inCategoryYouLike')];
    }
    // The one ranking ladder (constants/signalPriority.js): the fit parts carry their tiers; the extras above join theirs
    // (weather 8, own activity 6, related / broad 7), and an accepted friend going counts as friends (3). The friend part is
    // rank-only: the card already names the friend (friendGoingReason) and fit.score keeps driving the hero/standard tiles.
    const friendGoing = (g.approvedAttendees ?? []).some((a) => a?.user_id && a.user_id !== myUserId && myFriendIds.has(a.user_id));
    const weatherFit = (weatherIndoorBias && isIndoorCategory(g.interest_tag)) || (weatherOutdoorBias && isOutdoorCategory(g.interest_tag));
    fit.rankVector = tierVector([
      ...(fit.parts ?? []),
      { tier: SIGNAL_TIERS.planFriend, delta: friendGoing ? 4 : 0 },
      { tier: SIGNAL_TIERS.weather, delta: weatherFit ? WEATHER_BONUS : 0 },
      { tier: SIGNAL_TIERS.interest, delta: nudge },
      { tier: SIGNAL_TIERS.business, delta: related + broad },
      // item 137: this person's usual trip for the gathering's category (rank-only, weakest tier; no reason line)
      { tier: SIGNAL_TIERS.discovery, delta: learnedProximityFor(personalization.learnedProximity, g.interest_tag, g.distanceMiles) },
    ]);
    return { ...g, fit };
  }

  // Item 46 (CLAUDE.md, "personalization should determine what appears
  // first"): a real, earned personalized section -- only renders when
  // topSearchedCategory is non-null (3+ real past searches for this
  // exact category, per getMyTopSearchedCategory()) AND real matching
  // supply genuinely exists nearby right now. No date-window constraint
  // (unlike Happening Now/Today/This Weekend below): this section
  // answers "what," specifically for this one person, not "when." Goes
  // first in render order, ahead of every other section -- literally
  // "personalization determines what appears first" -- so its ids are
  // excluded from every section below it, the same "don't repeat what a
  // more prominent section already showed" chain those sections already
  // apply to each other.
  const topCategoryGatherings = isAll && !isSearching && topSearchedCategory
    ? filteredGatherings
        .filter((g) => g.interest_tag === topSearchedCategory.category)
        .map(scoreGathering)
        .sort(compareDiscover)
        .slice(0, TIME_SECTION_CAP)
    : [];
  const topCategoryIds = new Set(topCategoryGatherings.map((g) => g.id));

  // P1 UX critique reply item 14 (CLAUDE.md, "Things To Do needs a UX
  // pass"): the default "All" landing view no longer has its own flat
  // "Recommended For You" pass -- it's replaced below by the real
  // Happening Now/Today/This Weekend hierarchy. The dedicated Gatherings
  // tab's own experience (a real scored/tiered list) is untouched.
  const notableGatherings = !isSearching && typeFilter === 'gatherings'
    ? filteredGatherings
        .map(scoreGathering)
        .filter((g) => g.fit.score >= STANDARD_SCORE)
        .sort(compareDiscover)
        .slice(0, NOTABLE_DISPLAY_CAP)
    : [];
  const notableGatheringIds = new Set(notableGatherings.map((g) => g.id));

  // P1 UX critique reply item 14: "Where do I want to go / what do I want
  // to do / when do I want to do it?" -- three real, always-visible
  // time-scoped sections (never a toggle whose effect is invisible until
  // you look at the list beneath it) replace the old single quick-date-
  // chip-driven flat list, for the default "All" landing view only. Each
  // uses the exact same real date-bucket logic
  // (utils/gatheringDateFilter.js's matchesDateFilter) the dedicated
  // Gatherings screen's own "When" filter already uses -- not a second,
  // independently-invented definition of "today"/"this weekend."
  // Deliberately NOT filtered by STANDARD_SCORE the way notableGatherings
  // is: being genuinely happening now/today/this weekend is itself the
  // section's own real qualifying criterion, not a bonus signal to filter
  // further on top of -- fit.score here only decides sort order and
  // hero/standard tile tier, never inclusion. Each tier excludes whatever
  // a more-urgent tier already displayed, so a gathering never appears
  // twice (same "don't repeat what a more prominent section already
  // showed" principle dedupedGatherings below already established for
  // notable-vs-flat).
  // Owner item 91: one dedupe chain for every contextual section on the All view (utils/discoverSections.js).
  const discoverSections = isAll && !isSearching
    ? buildDiscoverSections({
        gatherings: filteredGatherings,
        score: scoreGathering,
        declared: personalization.declared,
        friendInterestByTag,
        excludeIds: topCategoryIds,
      })
    : [];

  // Item 206: the full date view, from the same filtered list the sections read (so Open now / Outdoor still apply). Only on
  // the plain All view: a search, another type tab or a category view replaces it.
  const dateViewData = dateView && isAll && !isSearching && !expandedContext
    ? buildDiscoverDateView({ gatherings: filteredGatherings, dateFilter: dateView, score: scoreGathering })
    : null;
  // A search, another type tab or a category view ends the date view (it never reappears later on its own).
  useEffect(() => {
    if (dateView && (!isAll || isSearching || expandedContext)) setDateView(null);
  }, [dateView, isAll, isSearching, expandedContext]);

  // Phase 8 section F -- the expanded context's own real content, filtered
  // out of what this screen already fetched. No new gatherings/offers query
  // is fired to enter a context.
  //
  // "Nearby" in the breadcrumb is not a third filter applied here: every
  // row in `gatherings` already came from getNearbyGatherings('wide') and
  // every row in `offers` from getActiveOffers(lat, lng), so the scope is
  // real and already applied -- the label names the constraint that's
  // genuinely in force rather than claiming one that isn't.
  const contextGatheringsAll = expandedContext
    ? filterGatheringsByEnvironment(applyOpenNow(gatherings, gatheringEntity), environmentFilter).filter((g) => (expandedContext.categoryTags
        ? (expandedContext.categoryTags.includes(g.interest_tag) || (isFamilyView(expandedContext) && gatheringDeclaresFamily(g)))
        : g.interest_tag === expandedContext.interestTag && gatheringTimeBadge(g.scheduled_at) === expandedContext.timeBucket))
    : [];
  const contextGatheringIds = new Set(contextGatheringsAll.map((g) => g.id));
  // Same interest, genuinely different time. Shown as its own clearly
  // labelled group rather than silently folded into the exact-context list
  // above -- a "Tonight" context must never quietly list next Saturday
  // under the same heading. Category mode has no time constraint to begin
  // with (contextGatherings above already includes every time), so this
  // is always empty there -- not a second, redundant listing of the exact
  // same rows.
  const contextOtherTimeAll = expandedContext && !expandedContext.categoryTags
    ? filterGatheringsByEnvironment(applyOpenNow(gatherings, gatheringEntity), environmentFilter).filter((g) => g.interest_tag === expandedContext.interestTag && !contextGatheringIds.has(g.id))
    : [];
  // "Happening tonight": a slice of the two lists above (same rows, same time badge); a gathering shown there is removed from
  // the list it came from, so it never appears twice. Empty (and not rendered) when nothing is on tonight.
  // Ordered by the same ladder as every other Discover gathering list (the rows themselves are unchanged).
  const byLadder = (list) => list.map((g) => ({ g, k: scoreGathering(g) })).sort((a, b) => compareDiscover(a.k, b.k)).map((x) => x.g);
  const { tonight: contextTonight, main: contextGatherings, other: contextOtherTimeGatherings } = splitTonight(
    byLadder(contextGatheringsAll), byLadder(contextOtherTimeAll), expandedContext?.timeBucket ?? null,
  );
  // target_interest_tag is the offer row's own real targeting field (the
  // same one the Perks section above already reads) -- not a keyword guess
  // against the offer's title.
  // Item 76: a perk also belongs to the context through its business's OWN declared type (subcategory / major).
  const contextScope = expandedContext
    ? { tags: (expandedContext.categoryTags ?? [expandedContext.interestTag]).filter(Boolean), groupKey: expandedContext.categoryKey ?? null }
    : { tags: [], groupKey: null };
  const contextOffersAnyTime = expandedContext ? applyEnv(offers.filter((o) => offerInContext(o, contextScope) || (isFamilyView(expandedContext) && partnerDeclaresFamily(o.brand_partners))), 'perk') : [];
  const contextOffersBroad = openNowActive ? applyOpenNow(contextOffersAnyTime, (o) => perkEntity(o)) : contextOffersAnyTime;
  // The cuisine row exists only in a context that holds the restaurant branch; a cuisine is an EXACT declared match that
  // combines with Open now (both filters apply) and never widens. Clearing it restores contextOffersBroad unchanged.
  const cuisineRowVisible = !!expandedContext && contextHasCuisines(contextScope.tags);
  const activeCuisine = cuisineRowVisible ? cuisineFilter : null;
  const activeCuisineLabel = activeCuisine ? cuisineLabel(activeCuisine) : null;
  const contextCuisineChips = cuisineRowVisible ? cuisineChips(contextOffersBroad, activeCuisine) : [];
  const contextOffers = applyCuisine(contextOffersBroad, activeCuisine);
  const cuisineMatchesAnyTime = activeCuisine ? applyCuisine(contextOffersAnyTime, activeCuisine) : [];
  // The one real topic label this context is about, regardless of which
  // mode opened it -- every empty-state string and the Places search
  // keyword below read this instead of assuming expandedContext.interestTag
  // exists.
  const contextTopicLabel = expandedContext?.categoryLabel ?? expandedContext?.interestTag ?? '';
  // A stable dep for the connections effect below -- contextGatherings is
  // rebuilt every render, so its identity can't be a dependency.
  // The connections effect reads every gathering this view shows, including the tonight slice.
  const contextShownGatherings = [...contextTonight, ...contextGatherings];
  const contextGatheringKey = contextShownGatherings.map((g) => g.id).join(',');

  // A category is a gateway, not a directory: friends into it (accepted friends only, server-enforced), public communities
  // for it, and one tap to ask businesses for an offer. Each shows only when real.
  const contextTags = expandedContext ? (expandedContext.categoryTags ?? [expandedContext.interestTag]).filter(Boolean) : [];
  const contextTagKey = contextTags.slice(0, 20).join('|');
  const [contextFriendMap, setContextFriendMap] = useState({});
  useEffect(() => {
    if (!contextTagKey) { setContextFriendMap({}); return undefined; }
    let cancelled = false;
    getFriendsInterestedIn(contextTagKey.split('|')).then((m) => { if (!cancelled) setContextFriendMap(m ?? {}); });
    return () => { cancelled = true; };
  }, [contextTagKey]);
  const contextFriendLine = (() => {
    const tag = contextTags.find((t) => friendsInterestReason(t, contextFriendMap?.[t]));
    return tag ? friendsInterestReason(tag, contextFriendMap[tag]) : null;
  })();
  const contextPlacesShown = applyEnv(applyOpenNow(contextPlaces, placeEntity), 'place');
  const contextCommunities = expandedContext && !openNowActive ? applyEnv(communities.filter((c) => contextTags.includes(c.interest_tag)), 'community') : [];

  // Real Google Places keyword search on the context's own interest tag
  // ("Coffee", "Yoga"), fired only once a context is actually open --
  // Places is a metered external API, same on-demand-only discipline the
  // main Places effect above already follows. Deliberately NOT a
  // hand-written interest -> place-category mapping table: searchNearbyPlaces
  // only knows four real categories (cafe/restaurant/park/community_center),
  // which don't cover the interest vocabulary, so mapping "Yoga" onto one of
  // them would be an invented association. Searching the real word is the
  // honest version.
  useEffect(() => {
    if (!expandedContext || !userLocation) return;
    const thisRequestId = ++contextPlacesRequestId.current;
    setLoadingContextPlaces(true);
    searchNearbyPlaces(userLocation.latitude, userLocation.longitude, null, contextTopicLabel)
      .then((results) => {
        if (thisRequestId === contextPlacesRequestId.current) setContextPlaces(results);
      })
      .catch((e) => console.error('Discover context places failed', e))
      .finally(() => {
        if (thisRequestId === contextPlacesRequestId.current) setLoadingContextPlaces(false);
      });
  }, [expandedContext, userLocation]);

  // Section G -- "People You Know". The candidate IDs are people who
  // genuinely RSVP'd (approved) to one of the gatherings already listed in
  // this context; filterToMyConnections then keeps only the ones the user
  // is already connected to. Nobody is ever surfaced for merely sharing an
  // interest, a location, or a time.
  //
  // Approved only, and that's not a display choice: gathering_interest's
  // RLS only exposes other people's *approved* rows to a non-host viewer
  // (see services/gatherings.js), so "Going" is the only status that's
  // real here -- nothing is inferred about anyone who merely looked.
  //
  // contextGatherings is read inside but keyed on contextGatheringKey
  // above rather than listed as a dependency, for the identity reason
  // noted there.
  useEffect(() => {
    if (!expandedContext || !contextGatheringKey) {
      setContextConnections([]);
      return;
    }
    const attendeeIds = [...new Set(
      contextShownGatherings.flatMap((g) => (g.approvedAttendees ?? []).map((a) => a.user_id))
    )].filter((id) => id && id !== myUserId);
    if (attendeeIds.length === 0) {
      setContextConnections([]);
      return;
    }
    const thisRequestId = ++contextConnectionsRequestId.current;
    filterToMyConnections(attendeeIds)
      .then(async (people) => {
        if (thisRequestId !== contextConnectionsRequestId.current) return;
        const withWhere = people.map((person) => ({
          ...person,
          gatheringTitle: contextShownGatherings.find((g) =>
            (g.approvedAttendees ?? []).some((a) => a.user_id === person.id))?.title ?? null,
        }));
        setContextConnections(withWhere);
        const entries = await Promise.all(withWhere.map(async (person) => [
          person.id,
          person.photo_url ? await getSignedPhotoUrl(person.photo_url) : null,
        ]));
        if (thisRequestId === contextConnectionsRequestId.current) {
          setContextConnectionPhotos(Object.fromEntries(entries));
        }
      })
      .catch((e) => console.error('Discover context connections failed', e));
  }, [expandedContext, contextGatheringKey, myUserId]);

  const typeShowsGatherings = typeFilter === 'all' || typeFilter === 'gatherings';
  // P1 UX critique reply item 14: the old flat "Gatherings" preview
  // section (below) is now redundant with the new Happening Now/Today/
  // This Weekend hierarchy for the default "All" browse case -- it stays
  // exactly as before for the dedicated Gatherings tab, and for search
  // results (which the new hierarchy deliberately doesn't cover either).
  const typeShowsCommunities = typeFilter === 'all' || typeFilter === 'communities';
  const typeShowsPlaces = typeFilter === 'all' || typeFilter === 'places';
  const typeShowsPerks = typeFilter === 'all' || typeFilter === 'perks';
  const showViewToggle = typeFilter === 'all' || typeFilter === 'gatherings' || typeFilter === 'perks';

  // Whatever already surfaced above doesn't repeat in the plain catch-all
  // list right below it. A no-op when `notableGatherings` is empty
  // (Communities/Places/Perks views, or while actively searching).
  const dedupedGatherings = filteredGatherings.filter((g) => !notableGatheringIds.has(g.id));
  const visiblePlaces = applyEnv(applyOpenNow(placesFresh ? places : [], placeEntity), 'place');

  // Decision 5 (CLAUDE.md, Aug 27 2026): a real "nothing anywhere matched"
  // state, checked against all three real searchable sections regardless of
  // the active type filter -- a user filtered to just Communities but who
  // would have gotten a real Gatherings match never sees a "create it"
  // prompt implying total failure. Places is deliberately excluded (a
  // Google-Places-backed browse, not a create-it candidate).
  // Item 92: one search across everything. The topic (activity/category), matching Nearby businesses and friends into
  // it join the gatherings / communities / perks / places the search already returned (utils/unifiedSearch.js).
  const searchedTopic = isSearching ? searchTopic(query.literalTerm) : null;
  const searchedBusinesses = isSearching && (isAll || typeFilter === 'places')
    ? applyEnv(applyOpenNow(matchBusinesses(businesses, query.literalTerm, searchedTopic), (b) => businessEntity(b)), 'business')
    : [];
  const searchFriendsLine = isAll ? friendsLineForTopic(searchedTopic, searchTopicFriendMap) : null;
  // Item 93: the search covers everything, the UI shows it in tabs. Only tabs with results (or still loading) exist;
  // Top Results previews at most three kinds, two items each (utils/searchResultTabs.js).
  const resultTabsActive = isAll && isSearching;
  const resultCounts = {
    plans: dedupedGatherings.length,
    places: searchedBusinesses.length + (userLocation ? visiblePlaces.length : 0),
    offers: filteredOffers.length,
    activities: filteredCommunities.length + (searchedTopic ? 1 : 0),
  };
  // Nothing is laid out until every source has answered for THIS term, so sections never appear one by one or reorder.
  const resultsSettled = !loadingSearch && !(userLocation && placesPending);
  const resultTabs = resultTabsActive ? searchResultTabs(resultCounts, { settled: resultsSettled }) : [];
  const resultTab = resultTabsActive ? effectiveResultTab(searchTab, resultTabs) : null;
  const topKinds = resultTabsActive ? topResultKinds(resultCounts, { settled: resultsSettled }) : [];
  const resultTabKey = resultTabs.map((t) => t.key).join('|');
  // A chosen tab that ends up with no results goes back to Top Results (the selection itself resets, not just the view).
  useEffect(() => {
    if (resultTabsActive && resultsSettled && searchTab !== 'top' && !resultTabKey.split('|').includes(searchTab)) setSearchTab('top');
  }, [resultTabsActive, resultsSettled, searchTab, resultTabKey]);
  const kindView = (kind) => (resultTabsActive ? resultKindView(kind, resultTab, topKinds) : { show: true, cap: isAll ? PREVIEW_COUNT : null });
  const capList = (list, kind) => { const { cap } = kindView(kind); return cap == null ? list : list.slice(0, cap); };
  const showGatherings = typeShowsGatherings && kindView('plans').show;
  const showFlatGatheringsSection = showGatherings && !(isAll && !isSearching);
  const showCommunities = typeShowsCommunities && kindView('activities').show;
  const showPlaces = typeShowsPlaces && kindView('places').show;
  const showPerks = typeShowsPerks && kindView('offers').show;
  const showSearchTopic = resultTabsActive && !!searchedTopic && (resultTab === 'top' || resultTab === 'activities');
  // Item 134: on Top Results, whatever the found block already shows is left out of the Plans / Offers / Places
  // previews (the found block wins; tabs and their counts are unchanged). utils/searchTopDedupe.js.
  const foundBlockShowing = isSearching && !intentSearching && (intentSearch?.outcome === 'results' || !!intentSearch?.refined);
  const topShown = resultTabsActive && resultTab === 'top' && foundBlockShowing ? foundBlockShownIds(intentSearch) : null;
  const businessesToShow = kindView('places').show ? capList(withoutFoundBlock(searchedBusinesses, 'places', topShown), 'places') : [];
  const gatheringsToShow = capList(withoutFoundBlock(dedupedGatherings, 'plans', topShown), 'plans');
  const communitiesToShow = capList(filteredCommunities, 'activities');
  const offersToShow = capList(withoutFoundBlock(filteredOffers, 'offers', topShown), 'offers');
  const placesToShow = capList(visiblePlaces, 'places');
  const onTopOrNotTabbed = !resultTabsActive || resultTab === 'top';
  // "See all" inside a preview: switches to that result tab during a search, else to the type tab as before.
  const seeAllVisible = (kind) => (resultTabsActive ? resultTab === 'top' : isAll);
  function openKind(kind, typeKey) {
    if (resultTabsActive) { animateLayout(); setSearchTab(kind); } else setTypeTab(typeKey);
  }
  const nothingMatchedAnywhere = isSearching && !loadingSearch
    && filteredGatherings.length === 0 && filteredCommunities.length === 0 && filteredOffers.length === 0
    && searchedBusinesses.length === 0;

  function renderEnvironmentChip() {
    if (!environmentFilter) return null;
    const label = t(environmentFilter === 'outdoor' ? 'ui.gatherings.envOutdoorChip' : 'ui.gatherings.envIndoorChip');
    return (
      <TapActiveChip
        active
        style={[styles.filterChip, styles.filterChipActive]}
        onPress={() => { animateLayout(); setEnvironmentFilter(null); }}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: true }}
      >
        <Text style={[styles.filterChipText, styles.filterChipTextActive]}>{`${label} ✕`}</Text>
      </TapActiveChip>
    );
  }

  function renderOpenNowChip() {
    return (
      <TapActiveChip
        active={openNowOnly}
        style={[styles.filterChip, openNowOnly && styles.filterChipActive]}
        onPress={() => setOpenNowOnly((v) => !v)}
        accessibilityLabel={t('ui.discover.openNow')}
        accessibilityRole="switch"
        accessibilityState={{ checked: openNowOnly }}
      >
        <Text style={[styles.filterChipText, openNowOnly && styles.filterChipTextActive]}>{t('ui.discover.openNowChip')}</Text>
      </TapActiveChip>
    );
  }

  function renderOpenNowEmpty() {
    return (
      <>
        <EmptyCopy id="open_now_none" />
        <TouchableOpacity onPress={() => setOpenNowOnly(false)} accessibilityLabel={t('ui.discover.showEverythingA11y')} accessibilityRole="button">
          <Text style={styles.emptyActionText}>{t('ui.discover.showEverything')}</Text>
        </TouchableOpacity>
      </>
    );
  }

  // Item 39: explicit-submit (Enter/Search key), not the live debounce the
  // literal keyword search above uses -- see intentSearchRequestId's own
  // comment for why. A "business_partner" classification has no results
  // concept (matches HomeScreen's own proceedToCreation for that intent)
  // so it routes straight to creation instead of ever setting intentSearch.
  async function handleUnderstandSearch() {
    const submitted = discoverQuery(searchQuery);
    const typedText = submitted.text;
    // First-class intent: detect Surprise Me -> the canonical engine -> inline results. Never an ordinary search.
    if (submitted.kind === 'pick_for_me') {
      await handleDiscoverSurprise(typedText);
      return;
    }
    if (submitted.kind !== 'search') return;
    ++localEdit.current;
    const thisRequestId = ++intentSearchRequestId.current;
    setIntentSearching(true);
    try {
      const result = await runIntentSearch(typedText, {
        onPhase: (p) => { if (thisRequestId === intentSearchRequestId.current) setIntentPhase(p); },
      });
      if (thisRequestId !== intentSearchRequestId.current) return;
      // "what's open" / "still open" turns on the same Open-now chip (one definition, utils/operatingStatus.js).
      if (result.openNowOnly) setOpenNowOnly(true);
      if (result.outcome === 'business_partner') {
        setIntentSearch(null);
        routeClassifiedIntentToCreation(navigation, result.classifyResult, typedText);
      } else {
        // Typed-ask audit (item 105): records what this search understood and the rows rendered below, in their order.
        // Fire-and-forget; the result is set unchanged.
        const shown = result.outcome === 'pick_for_me' ? null : recordTypedAsk('discover', result);
        const now = Date.now();
        setIntentSearch({ ...result, shown, askedAt: now, updatedAt: now, sessionId: randomUUID() });
      }
    } catch (e) {
      console.error('Discover intent search failed', e);
    }
    if (thisRequestId === intentSearchRequestId.current) setIntentSearching(false);
  }

  // Surprise Me from the search box: the one shared flow (submitSurprise / shuffleSurprise / navigateToSurprisePick), shown inline.
  // Discover's own explicit choices only narrow it: the type tab and the Open-now chip. Nothing here is written to the search log.
  // Refine the typed ask in place (item 107, shared with Home): same words, one chip changed, results replaced inline.
  async function handleIntentRefine(key) {
    const prev = intentSearch;
    if (!prev || intentRefining) return;
    const thisRequestId = intentSearchRequestId.current;
    ++localEdit.current;
    setIntentRefining(true);
    try {
      const next = await refineTypedAsk('discover', prev, key);
      if (thisRequestId === intentSearchRequestId.current) setIntentSearch(next);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'update these ideas', error: e, onRetry: () => handleIntentRefine(key) });
    }
    setIntentRefining(false);
  }

  // Restore once per signed-in user when Discover has no ask of its own; a different account never sees this one's session.
  useEffect(() => {
    if (!myUserId || sessionCheckedFor.current === myUserId) return;
    sessionCheckedFor.current = myUserId;
    if (searchQuery || intentSearch) return;
    // the device cache first (instant), then the account (the source of truth) replaces it if another device changed it
    discoverSession.load(myUserId).then((saved) => {
      if (!saved || sessionCheckedFor.current !== myUserId || accountApplied.current) return;
      lastSynced.current = { sessionId: saved.sessionId, updatedAt: saved.updatedAt };
      setSearchQuery(saved.typedText);
      restoreSession(saved);
    });
  }, [myUserId]);
  // Each time Discover comes into view, pick up a change made on another device.
  useFocusEffect(useCallback(() => { syncFromAccount(); }, [myUserId]));
  // Save every change of the ask (first search, a chip, a category, a restore) to the device cache; the person's own changes
  // (newer than what the account last had) also go to the account. The one place the session is written.
  useEffect(() => {
    if (!intentSearch || intentSearch.outcome === 'pick_for_me' || !intentSearch.sessionId) return;
    discoverSession.save(myUserId, intentSearch);
    if (!myUserId || sameSession(intentSearch, lastSynced.current)) return;
    const snap = { ...intentSearch, typedText: intentSearch.typedText ?? searchQuery };
    lastSynced.current = { sessionId: snap.sessionId, updatedAt: snap.updatedAt };
    clearedSession.current = null;
    const editAtStart = localEdit.current;
    pushSession(myUserId, snap)
      .then((account) => {
        // behind another device: show the account's newer session (or its clear)
        if (account && !account.cleared && sameSession(account, snap)) return;
        applyAccountSession(account?.cleared ? null : account, editAtStart);
      })
      .catch((e) => console.warn('Discover session not synced; kept on this device', e?.message));
  }, [intentSearch, myUserId]);

  // Item 108: a Browse category narrows the typed ask on screen (same words, same constraints, category added), inline.
  async function handleIntentNarrow(group) {
    const prev = intentSearch;
    if (!prev || intentRefining) return;
    const thisRequestId = intentSearchRequestId.current;
    ++localEdit.current;
    setIntentRefining(true);
    try {
      const next = await narrowTypedAsk('discover', prev, group.key);
      if (thisRequestId === intentSearchRequestId.current) setIntentSearch(next);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'update these ideas', error: e, onRetry: () => handleIntentNarrow(group) });
    }
    setIntentRefining(false);
  }

  // The Browse rail (item 34/91), one rendering for both uses: while browsing a tap opens the category view; with a typed ask on
  // screen (item 108) a tap narrows that ask instead, the selected category shows ✕ and tapping it again clears it.
  function renderBrowseRail(onPress, { selectedKey = null, disabled = false } = {}) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.md }}>
        {[...rail.primary, ...(showMoreCategories ? rail.more : [])].map(({ group, label: englishLabel }) => {
          const selected = selectedKey === group.key;
          const label = names.rail(group.key, englishLabel);
          return (
            <TouchableOpacity
              key={group.key}
              style={[styles.categoryChip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => onPress(group)}
              disabled={disabled}
              activeOpacity={0.85}
              accessibilityLabel={selected ? t('ui.discover.selectedTapClear', { label }) : label}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
            >
              <Text style={styles.categoryChipIcon}>{group.icon}</Text>
              <Text style={[styles.categoryChipText, selected && { color: '#fff' }]}>{selected ? `${label} ✕` : label}</Text>
            </TouchableOpacity>
          );
        })}
        {rail.more.length > 0 ? (
          <TouchableOpacity
            style={styles.categoryChip}
            onPress={() => { animateLayout(); setShowMoreCategories((v) => !v); }}
            activeOpacity={0.85}
            accessibilityLabel={t(showMoreCategories ? 'ui.discover.fewerCategories' : 'ui.discover.moreCategories')}
            accessibilityRole="button"
            accessibilityState={{ expanded: showMoreCategories }}
          >
            <Text style={styles.categoryChipText}>{showMoreCategories ? names.label('less') : names.label('more')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }

  async function handleDiscoverSurprise(typedText) {
    intentSearchRequestId.current += 1;
    setIntentSearch(null);
    setIntentSearching(false);
    const thisRequestId = ++surpriseRequestId.current;
    setDiscoverSurprise(null);
    setSurpriseLoading(true);
    const next = await submitSurprise({ text: typedText, types: surpriseTypesForTab(typeFilter), openNow: openNowActive });
    if (thisRequestId !== surpriseRequestId.current) return;
    setDiscoverSurprise(next);
    setSurpriseLoading(false);
  }

  async function handleDiscoverSurpriseShuffle() {
    if (!discoverSurprise) return;
    const thisRequestId = ++surpriseRequestId.current;
    setSurpriseLoading(true);
    const next = await shuffleSurprise(discoverSurprise);
    if (thisRequestId !== surpriseRequestId.current) return;
    setDiscoverSurprise(next);
    setSurpriseLoading(false);
  }

  function clearDiscoverSurprise() {
    surpriseRequestId.current += 1;
    setDiscoverSurprise(null);
    setSurpriseLoading(false);
  }

  function handleIntentSearchResultTap(item) {
    const { classifyResult, typedText, submissionId, shown } = intentSearch ?? {};
    recordIntentSelection({
      rawText: typedText,
      category: classifyResult?.category ?? null,
      dateWindow: classifyResult?.dateWindow ?? null,
      resultType: item.type,
      resultId: item.id ?? null,
      resultTitle: item.title,
      submissionId,
      snapshotId: shown?.snapshotId ?? null,
      resultPosition: displayedPosition(shown?.displayed, item),
    });
    // Deliberately doesn't clear intentSearch, unlike HomeScreen's own
    // handleIntentResultTap -- this is a search results screen, not a
    // one-shot ask box, so returning here after viewing a result should
    // still show the same understood block, same as the literal keyword
    // search results right below it never disappear on their own either.
    navigateToIntentResultItem(navigation, item, { typedText, classifyResult, submissionId });
  }

  function renderIntentSearchResultRow(item, index, { onPress = handleIntentSearchResultTap, pickBadge = true } = {}) {
    // Item 125 ("Make 'Nearby found this for you' visually recognizable"): the single real
    // top-scored item of an already relevance-sorted list (resolveIntent() sorts by real score
    // before this ever renders) gets the "✨ Nearby Pick" badge -- index === 0 only, so it never
    // shows on a bundle row (called with no index) or anywhere past the genuine #1 real match.
    // friend_discovery is a synthetic fallback item appended after the real ranked candidates,
    // never itself a scored "pick" -- excluded even in the edge case where it's the only item.
    const isTopPick = pickBadge && index === 0 && item.type !== 'friend_discovery';
    const row = resultRowView(item, { language, myUserId }); // typed-ask AND Surprise Me rows: the one context object's reason / context / action
    return (
      <StaggeredReveal key={`${item.type}-${item.id}`} index={index}>
      <TouchableOpacity
        style={styles.intentSearchResultRow}
        onPress={() => onPress(item)}
        activeOpacity={0.85}
        accessibilityLabel={[row.title, isTopPick ? translate(language, 'vocab.labels.nearbyPick') : null, row.reason, row.meta, row.action?.label].filter(Boolean).join(', ')}
        accessibilityRole="button"
      >
        <Text style={styles.intentSearchResultEmoji}>{INTENT_SEARCH_TYPE_EMOJI[item.type] ?? '📌'}</Text>
        <View style={{ flex: 1 }}>
          {isTopPick && <NearbyPickBadge />}
          <Text style={styles.intentSearchResultTitle} numberOfLines={1}>{row.title}</Text>
          {row.reason ? <Text style={styles.intentSearchResultSubtitle} numberOfLines={1}>{row.reason}</Text> : null}
          {row.meta ? <Text style={[styles.intentSearchResultSubtitle, row.warn && { color: colors.danger }]} numberOfLines={1}>{row.meta}</Text> : null}
        </View>
        {/* Item 72/135/196: a business or gathering result names the action its tap takes (a status is neutral, never coral). */}
        {row.action ? (
          <Text style={[styles.intentSearchResultChevron, { color: row.action.kind === 'status' ? colors.textSecondary : colors.primary, fontWeight: '700' }]}>{row.action.label} ›</Text>
        ) : (
          <Text style={styles.intentSearchResultChevron}>›</Text>
        )}
      </TouchableOpacity>
      </StaggeredReveal>
    );
  }

  // Item 109: Create from the typed ask Discover already understood (with its chips), never a second AI read of the words.
  function createFromAsk() {
    if (!intentSearch?.classifyResult) return;
    routeClassifiedIntentToCreation(navigation, intentSearch.classifyResult, intentSearch.typedText ?? searchQuery.trim(), { explicitCreate: true, submissionId: intentSearch.submissionId ?? null });
  }
  async function handleCreateItFromSearch() {
    const typedText = searchQuery.trim();
    if (!typedText) return;
    if (intentSearch?.classifyResult && (intentSearch.typedText ?? '').trim() === typedText) {
      createFromAsk();
      return;
    }
    setCreatingFromSearch(true);
    try {
      const result = await classifyCreateRequest(typedText);
      routeClassifiedIntentToCreation(navigation, result, typedText, { explicitCreate: true });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCreateItFromSearch() });
    }
    setCreatingFromSearch(false);
  }

  // Discover UX cleanup item 8: the People tab's removed StoriesRow's own
  // "Your Story" flow, moved verbatim (same camera capture + audience
  // choice) rather than rewritten -- StoriesRow.js's handlePost() is the
  // source of truth this was copied from.
  async function handlePostStory() {
    setPostingStory(true);
    try {
      const captured = await captureStoryMedia();
      if (!captured) {
        setPostingStory(false);
        return;
      }

      Alert.alert(
        t('ui.discover.storyWho'),
        '',
        [
          { text: t('ui.common.cancel'), style: 'cancel', onPress: () => setPostingStory(false) },
          {
            text: t('ui.discover.storyConnections'),
            onPress: async () => {
              await uploadStory(myUserId, captured.uri, captured.type, false);
              setPostingStory(false);
            },
          },
          {
            text: t('ui.discover.storyPublic'),
            onPress: async () => {
              await uploadStory(myUserId, captured.uri, captured.type, true);
              setPostingStory(false);
            },
          },
        ]
      );
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handlePostStory() });
      setPostingStory(false);
    }
  }

  const mapDeals = showPerks ? filteredOffers.filter((o) => o.latitude != null && o.longitude != null) : [];
  const mapBusinesses = showPerks ? applyOpenNow(businesses, (b) => businessEntity(b)) : [];

  const activeModeInfo = DISCOVER_MODES.find((m) => m.key === mode);

  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- the specific "why"
  // line every notable card shows, in priority order: a real matched
  // interest (names the actual tag, never the generic shared "Matches your
  // interests" string), then a real high attendance count, then whatever
  // getGatheringFitReasons() itself ranked first for anything else that
  // still cleared STANDARD_SCORE (e.g. "Very close" / "0.3 mi away" /
  // "Happening today").
  // Shared context layer (2026-09-28): the card's reason, when/where line, action and CTA destination come from the ONE context
  // object (gatheringCardModel -> utils/recommendationContext.js). Discover only supplies its real candidate reasons, strongest
  // first; the context picks the first valid one (distance/time restatements are the context line, never the reason).
  function discoverReasons(g) {
    const attendeeCount = attendeeTotal(g);
    return [
      friendGoingReason(g, myFriendIds, myUserId),
      g.matchesYourInterests && g.interest_tag ? becauseYouLikeReason(g.interest_tag) : null,
      friendsInterestReason(g.interest_tag, friendInterestByTag[g.interest_tag]),
      attendeeCount >= TRENDING_ATTENDANCE_MIN ? reasonText('attendingCount', { count: attendeeCount }) : null,
      ...(g.fit?.reasons ?? []),
    ].filter(Boolean);
  }

  // sectionKey: the Discover section the card sits in; its own reason leads the two shown (sectionLeadReason).
  function discoverCard(g, sectionKey = null) {
    const leadReason = sectionKey ? sectionLeadReason(sectionKey, g, { friendInterestByTag }) : null;
    return gatheringCardModel(g, { signals: discoverReasons(g).map((text) => ({ kind: 'reason', text })), myUserId, language, leadReason });
  }

  function communityContext(c) {
    return recommendationContext(contextItem('community', c, { reasons: [communityReason(c, personalization.declared)] }), { language });
  }

  // One perk card for every Perks list (the Perks section and the category view). Compact for browsing; the selected one
  // expands in place with its redemption panel (Perk Selection State above).
  function renderPerkCard(o) {
    const pc = perkContext(o);
    const card = (
      <PlaceCard
        key={o.id}
        icon="🎁"
        photoUrl={o.target_interest_tag ? curatedCoverPhotoFor(o.target_interest_tag) : null}
        tintColor={o.target_interest_tag ? categoryStyleFor(o.target_interest_tag).color : null}
        title={o.title}
        // reason + distance + action from the one context object (the perk's own named tag, never a generic "Matches your interests")
        reason={[o.brand_partners?.name, pc.context, businessSignalLine(o.brand_partners), pc.reason].filter(Boolean).join(' · ')}
        onPress={() => (selectedPerkId === o.id ? clearPerkSelection() : selectPerk(o.id))}
        accessibilityLabel={[o.title, o.brand_partners?.name, pc.action?.label].filter(Boolean).join(', ')}
        accessibilityState={{ expanded: selectedPerkId === o.id }}
        actionLabel={selectedPerkId === o.id ? null : pc.action?.label}
        actionIsState={pc.action?.kind === 'status'}
        style={selectedPerkId === o.id ? styles.selectedPerkCardTop : undefined}
      />
    );
    if (selectedPerkId !== o.id) return card;
    return (
      <View key={o.id} ref={(r) => { perkCardRefs.current[o.id] = r; }} style={styles.selectedPerk}>
        {card}
        <PerkRedemptionPanel
          offer={o}
          redeemed={redeemedOfferIds.has(o.id)}
          onRedeemed={(id) => setRedeemedOfferIds((prev) => new Set([...prev, id]))}
          onClose={clearPerkSelection}
          onOpenBusiness={() => openDestination(navigation, businessContext({ id: o.partner_id, name: o.brand_partners?.name }).destination)}
        />
      </View>
    );
  }

  // The selected perk is always on screen (utils/perkSelection.js).
  function withSelectedPerk(list) {
    return listWithSelectedPerk(list, selectedPerkId, offers, searchedOffers);
  }

  function perkContext(o) {
    return recommendationContext(contextItem('perk', o, {
      reasons: [o.target_interest_tag ? becauseYouLikeReason(o.target_interest_tag) : null],
      redeemed: redeemedOfferIds.has(o.id),
    }), { language });
  }

  function businessContext(b) {
    return recommendationContext(contextItem('business', b, { reasons: [b.searchReason] }), { language });
  }

  function primaryReasonLine(g) {
    return discoverCard(g).reasons[0] ?? null;
  }

  // The hero card's small eyebrow label -- same three real signals as
  // primaryReasonLine above, just as a short badge word instead of a full
  // sentence, falling back to the real time badge (gatheringTimeBadge)
  // when neither a matched interest nor real popularity is what earned
  // this gathering its spot (e.g. it qualified purely on distance/today).
  // Discover section headings (utils/discoverSections.js builds English titles) in the person's language: fixed sections by key,
  // "Because you like X" with the category's translated name, the friends heading through the shared reason localizer.
  function sectionTitle(section) {
    switch (section.key) {
      case 'now': return t('ui.discover.section.now');
      case 'tonight': return t(String(section.title).startsWith('🌙') ? 'ui.discover.section.tonight' : 'ui.discover.section.today');
      case 'because': return t('ui.discover.section.because', { tag: names.tag(section.tag) });
      case 'friends': return `🤝 ${localizeReason(String(section.title).replace(/^🤝 /, ''), language)}`;
      case 'trending': return t('ui.discover.section.trending');
      case 'weekend': return t('ui.discover.section.weekend');
      default: return section.title;
    }
  }

  function heroEyebrow(g) {
    // Codes are fixed English; shown as ui.discover.badge.<code> in the person's language.
    const code = g.matchesYourInterests ? 'PERSONALIZED' : attendeeTotal(g) >= TRENDING_ATTENDANCE_MIN ? 'TRENDING' : (gatheringTimeBadge(g.scheduled_at) ?? 'RECOMMENDED');
    return t(`ui.discover.badge.${code.replace(/ /g, '_')}`);
  }

  // Real action vocabulary, reused verbatim from GatheringDetailScreen.js
  // (its own accessibilityLabel / countdown-stat labels) rather than an
  // invented "View"/"Explore" catch-all: someone already RSVP'd sees their
  // real state as a badge, never a fresh CTA button; everyone else sees
  // the real next action, including the real Join-Waitlist/Request-to-Join
  // distinction (gathering.isFull / gathering.is_public), computed the same
  // way GatheringDetailScreen itself computes `isFull` off approvedAttendees
  // vs. capacity. Tapping either kind still opens GatheringDetailScreen to
  // actually perform the join -- a real task change, not just more info.
  function gatheringActionInfo(g, card = discoverCard(g)) {
    // Item 73: generated from the gathering's state for this viewer (the context object's action, from utils/primaryAction.js),
    // the same source Home and the Gatherings feed use: a join shows as the CTA; going / hosting / requested / waitlisted / past /
    // expired show as a status badge; anything unknown is a plain View. Tapping either opens the context's destination.
    const a = card.action ?? { kind: 'view', label: t('ui.actions.view') };
    if (a.kind === 'join') return { kind: 'cta', label: a.label };
    if (a.status) return { kind: 'state', label: a.status };
    return { kind: 'cta', label: a.label };
  }


  // "TONIGHT" -> "Tonight". gatheringTimeBadge's own words, cased for a
  // breadcrumb line instead of an all-caps eyebrow badge -- same single
  // time vocabulary (CLAUDE.md section D), not a second one.
  function titleCaseBadge(badge) {
    if (!badge) return null;
    return badge.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }

  const contextLabel = expandedContext
    ? (expandedContext.categoryTags
        ? [expandedContext.categoryIcon, names.tag(expandedContext.categoryLabel), 'Nearby'].filter(Boolean).join(' ')
        : [names.tag(expandedContext.interestTag), titleCaseBadge(expandedContext.timeBucket), 'Nearby'].filter(Boolean).join(' · '))
    : null;

  // The one real "why this place, right now" line, shared verbatim by the
  // main Places section and the expanded context's own Places list rather
  // than written out twice. Every part of it is a real Google Places
  // Basic-Data field or this app's own real gathering count -- falls back
  // to the address when none of them came back.
  // Shared context layer: a Google place gets its distance and directions destination from the one context object; it has no
  // recommendation reason and no booking mode (neither is invented). Rating / price / open now are the provider's own facts.
  function placeContext(p) {
    return recommendationContext(contextItem('place', p), { language });
  }

  function placeReasonLine(p) {
    return [
      p.rating !== null ? `⭐ ${p.rating}${p.reviewCount !== null ? ` (${p.reviewCount})` : ''}` : null,
      p.priceLevel === 0 ? t('ui.places.free') : priceLevelLabel(p.priceLevel),
      p.openNow !== null ? t(p.openNow ? 'ui.places.openNowPlain' : 'ui.places.closedPlain') : null,
      placeContext(p).context,
      p.gatheringCount > 0 ? t('ui.places.gatheringsHere', { count: p.gatheringCount }) : null,
    ].filter(Boolean).join('  ·  ') || p.address;
  }

  function openPlaceInMaps(p) {
    openDestination(navigation, placeContext(p).destination); // no coordinates or address = no link, never a broken URL
  }

  // The standard gathering row inside an expanded context. Tapping it does
  // navigate for real: from inside the context there is no further
  // in-place depth to reveal, so opening the gathering itself is a genuine
  // task change (join, message, see the roster) -- exactly the line
  // CLAUDE.md's Progressive Depth doctrine draws.
  //
  // Item 126 ("Don't animate every card"): this list has no cap -- a broad
  // category context can genuinely hold 20+ real gatherings -- so this row
  // no longer wraps itself in its own per-card StaggeredReveal. Each real
  // call site wraps the WHOLE mapped list in one outer StaggeredReveal
  // instead, so the group settles into place as one coordinated block.
  function renderContextGatheringRow(g) {
    const card = discoverCard(g);
    const action = gatheringActionInfo(g, card);
    const isSource = g.id === expandedContext?.sourceGatheringId;
    return (
      <TouchableOpacity
        key={g.id}
        style={[styles.card, isSource && styles.cardSourceHighlight]}
        onPress={() => openDestination(navigation, card.destination)}
        activeOpacity={0.85}
        accessibilityLabel={[g.title, card.meta].filter(Boolean).join(', ')}
        accessibilityRole="button"
      >
        {coverPhotoUrls[g.id] ? (
          <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
        ) : (
          renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{g.title}</Text>
          {card.meta && (
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {card.meta}
            </Text>
          )}
          {(gatheringSignalLine(g) || gatheringFullnessLabel(g)) && (
            <Text
              style={[styles.cardSubtitle, gatheringFullnessLabel(g)?.startsWith('🔒') && { color: colors.danger }]}
              numberOfLines={1}
            >
              {[gatheringSignalLine(g), gatheringFullnessLabel(g)].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        {action.kind === 'cta' ? (
          <Text style={styles.cardActionLabel} numberOfLines={1}>{action.label}</Text>
        ) : (
          <Text style={styles.cardStateLabel} numberOfLines={1}>{action.label}</Text>
        )}
      </TouchableOpacity>
    );
  }

  // P1 UX critique reply item 14: extracted verbatim from the old inline
  // notableGatherings.map() render callback so the exact same hero/standard
  // tile treatment (Phase 8, CLAUDE.md, Discover visual hierarchy) is
  // shared by the dedicated Gatherings tab's notableGatherings AND the new
  // Today/This Weekend sections below, instead of three copies of this
  // block drifting apart.
  function renderGatheringTile(g, index, sectionKey = null) {
    const card = discoverCard(g, sectionKey);
    const action = gatheringActionInfo(g, card);
    const reasonLine = card.reasons[0] ?? null;

    if (g.fit.score >= HERO_SCORE) {
      const categoryStyle = categoryStyleFor(g.interest_tag);
      return (
        <StaggeredReveal key={g.id} index={index}>
        <TouchableOpacity
          style={styles.heroCard}
          /* Phase 8 section F -- the card body no longer navigates:
             tapping it expands this screen around the gathering's own
             context. The CTA below is its own nested touchable and
             still navigates, because joining is a real task change. */
          onPress={() => openContextFor(g)}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.discover.showsMoreA11y', { text: `${g.title}, ${heroEyebrow(g)}${reasonLine ? `, ${reasonLine}` : ''}` })}
          accessibilityRole="button"
        >
          {coverPhotoUrls[g.id] ? (
            <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.heroImage} />
          ) : curatedCoverPhotoFor(g.interest_tag) ? (
            // Real curated category photo (same map/precedent as
            // GatheringDetailScreen's own cover-photo fallback) --
            // a host's own uploaded photo always wins when one
            // exists, this is the next-best real picture, not a
            // fabricated one.
            <Image source={{ uri: curatedCoverPhotoFor(g.interest_tag) }} style={styles.heroImage} accessibilityLabel={t('ui.discover.coverPhotoA11y', { name: names.tag(g.interest_tag) })} />
          ) : (
            // Real, disclosed fallback: this app's own existing
            // categoryStyleFor() color/icon (never a fabricated
            // stock photo) filling the full card instead of sitting
            // inside a 32px glyph -- only reached for the handful of
            // categories with no sourced curated photo.
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
          <Text style={styles.heroEyebrow}>{heroEyebrow(g)}</Text>
          <View style={styles.heroBody}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={styles.heroTitle} numberOfLines={1}>{g.title}</Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                {[reasonLine, card.meta].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {action.kind === 'cta' ? (
              <TouchableOpacity
                style={styles.heroCta}
                onPress={() => openDestination(navigation, card.destination)}
                accessibilityLabel={`${action.label}: ${g.title}`}
                accessibilityRole="button"
              >
                <Text style={styles.heroCtaText}>{action.label}</Text>
              </TouchableOpacity>
            ) : (
              /* An already-RSVP'd state ("Going"/"Waitlisted") is a
                 badge, not a button -- deliberately not touchable,
                 per CLAUDE.md's "informational must not visually
                 impersonate a button" rule. */
              <View style={styles.heroStatePill}>
                <Text style={styles.heroStatePillText}>{action.label}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        </StaggeredReveal>
      );
    }

    return (
      <StaggeredReveal key={g.id} index={index}>
      <TouchableOpacity
        style={styles.card}
        onPress={() => openContextFor(g)}
        activeOpacity={0.85}
        accessibilityLabel={t('ui.discover.showsMoreA11y', { text: `${g.title}${reasonLine ? `, ${reasonLine}` : ''}` })}
        accessibilityRole="button"
      >
        {coverPhotoUrls[g.id] ? (
          <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
        ) : (
          renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{g.title}</Text>
          {(reasonLine || card.meta) && (
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {[reasonLine, card.meta].filter(Boolean).join(' · ')}
            </Text>
          )}
          {(gatheringSignalLine(g) || gatheringFullnessLabel(g)) && (
            <Text
              style={[styles.cardSubtitle, gatheringFullnessLabel(g)?.startsWith('🔒') && { color: colors.danger }]}
              numberOfLines={1}
            >
              {[gatheringSignalLine(g), gatheringFullnessLabel(g)].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        {action.kind === 'cta' ? (
          <TouchableOpacity
            onPress={() => openDestination(navigation, card.destination)}
            accessibilityLabel={`${action.label}: ${g.title}`}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.cardActionLabel} numberOfLines={1}>{action.label}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.cardStateLabel} numberOfLines={1}>{action.label}</Text>
        )}
      </TouchableOpacity>
      </StaggeredReveal>
    );
  }

  // P1 UX critique reply item 14: a compact horizontal "Happening Now"
  // tile -- deliberately smaller/plainer than renderGatheringTile's own
  // hero/standard tiers (the critique's own mock calls this "a small
  // horizontal set," not a peer of Today/This Weekend's fuller cards).
  // Still taps into the same real expand-in-place context as every other
  // gathering tile on this screen.
  function renderHappeningNowTile(g, index) {
    const card = discoverCard(g);
    return (
      <StaggeredReveal key={g.id} index={index}>
      <TouchableOpacity
        style={styles.nowCard}
        onPress={() => openContextFor(g)}
        activeOpacity={0.85}
        accessibilityLabel={t('ui.discover.showsMoreA11y', { text: [g.title, card.meta].filter(Boolean).join(', ') })}
        accessibilityRole="button"
      >
        {coverPhotoUrls[g.id] ? (
          <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.nowCardImage} />
        ) : (
          <View style={[styles.nowCardImage, styles.nowCardIconWrap, { backgroundColor: `${categoryStyleFor(g.interest_tag).color}20` }]}>
            <Text style={styles.cardIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
          </View>
        )}
        <Text style={styles.nowCardTitle} numberOfLines={1}>{g.title}</Text>
        {card.meta && (
          <Text style={styles.nowCardSubtitle} numberOfLines={1}>
            {card.meta}
          </Text>
        )}
      </TouchableOpacity>
      </StaggeredReveal>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ReturnTrailChip tab="Discover" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('ui.discover.title')}</Text>
            <Text style={styles.subtitle}>{t(`ui.discover.mode.${activeModeInfo.key}Subtitle`)}</Text>
          </View>
          <TabHeaderActions navigation={navigation} />
        </View>

        <View style={styles.modeToggleRow}>
          {DISCOVER_MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TapActiveChip
                key={m.key}
                active={active}
                style={[styles.modeToggleButton, active && styles.modeToggleButtonActive]}
                onPress={() => selectMode(m.key)}
                accessibilityLabel={t(`ui.discover.mode.${m.key}`)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.modeToggleIcon}>{m.icon}</Text>
                <Text style={[styles.modeToggleText, active && styles.modeToggleTextActive]}>{t(`ui.discover.mode.${m.key}`)}</Text>
              </TapActiveChip>
            );
          })}
        </View>

        {/* Phase 8 section F -- while a context is open, its breadcrumb
            replaces the search bar and type-filter chips: those controls
            describe the normal browse list, not this filtered view, and
            leaving them live would let someone silently contradict the
            breadcrumb they're looking at. Back just clears the state --
            there was never a screen pushed to pop. */}
        {mode === 'things' && (expandedContext || dateViewData) && (
          <View style={styles.breadcrumbRow}>
            <TouchableOpacity
              style={styles.breadcrumbBackButton}
              onPress={expandedContext ? closeContext : closeDateView}
              accessibilityLabel={t('ui.discover.backA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.breadcrumbBack}>←</Text>
            </TouchableOpacity>
            {expandedContext ? (
              <Text style={styles.breadcrumbText} numberOfLines={1}>{contextLabel}</Text>
            ) : (
              /* Items 206/34: the time chips stay visible; the active one (✕) leaves the view exactly like the back arrow. */
              <View style={{ flex: 1, flexDirection: 'row' }}>{renderTimeChips()}</View>
            )}
            {renderOpenNowChip()}
            {renderEnvironmentChip()}
          </View>
        )}
        {mode === 'things' && expandedContext && contextCuisineChips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ marginBottom: spacing.sm }}>
            {contextCuisineChips.map((c) => (
              <TapActiveChip
                key={c.key}
                active={c.active}
                style={[styles.filterChip, c.active && styles.filterChipActive]}
                onPress={() => setCuisineFilter(c.active ? null : c.key)}
                accessibilityLabel={c.active ? t('ui.discover.selectedTapClear', { label: names.cuisine(c.key, c.label) }) : names.cuisine(c.key, c.label)}
                accessibilityRole="button"
                accessibilityState={{ selected: c.active }}
              >
                <Text style={[styles.filterChipText, c.active && styles.filterChipTextActive]}>{c.active ? `${names.cuisine(c.key, c.label)} ✕` : names.cuisine(c.key, c.label)}</Text>
              </TapActiveChip>
            ))}
          </ScrollView>
        )}
        {mode === 'things' && openNowActive && (
          <Text style={styles.openNowNote}>{t('ui.discover.openNowNote')}</Text>
        )}
        {mode === 'things' && !!environmentFilter && (
          <Text style={styles.openNowNote}>{t(environmentFilter === 'outdoor' ? 'ui.discover.envNoteOutdoor' : 'ui.discover.envNoteIndoor')}</Text>
        )}

        {mode === 'things' && !expandedContext && !dateViewData && (
          <>
            <Text style={styles.searchPrompt} accessibilityRole="header">{t('ui.discover.lookingFor')}</Text>
            <View style={styles.searchBarWrap}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder={t('ui.discover.searchPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                value={searchQuery}
                onChangeText={(t) => {
                  setSearchQuery(t);
                  setSearchTab('top');
                  // Item 39: the previous "understood as" block described
                  // the old text -- invalidate it (and any in-flight
                  // request for it) the moment the text changes, same
                  // discipline searchRequestId/placesRequestId already use.
                  intentSearchRequestId.current += 1;
                  setIntentSearch(null);
                  endSearchSession(); // a changed search is a new ask; the saved one ends
                  clearDiscoverSurprise();
                }}
                onSubmitEditing={handleUnderstandSearch}
                returnKeyType="search"
                accessibilityLabel={t('ui.discover.searchA11y')}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery('');
                    setSearchTab('top');
                    intentSearchRequestId.current += 1;
                    setIntentSearch(null);
                    endSearchSession();
                    clearDiscoverSurprise();
                  }}
                  accessibilityLabel={t('ui.discover.clearSearchA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {(resultTabsActive ? resultTabs : TYPE_FILTERS).map((f) => {
                  const active = resultTabsActive ? resultTab === f.key : typeFilter === f.key;
                  return (
                    <TapActiveChip
                      key={f.key}
                      active={active}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => (resultTabsActive ? (animateLayout(), setSearchTab(f.key)) : setTypeTab(f.key))}
                      accessibilityLabel={t(`ui.discover.${resultTabsActive ? 'resultTab' : 'typeFilter'}.${f.key}`)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{t(`ui.discover.${resultTabsActive ? 'resultTab' : 'typeFilter'}.${f.key}`)}</Text>
                    </TapActiveChip>
                  );
                })}
                {typeFilter !== 'communities' && renderOpenNowChip()}
                {renderEnvironmentChip()}
              </ScrollView>
              {showViewToggle && (
                <TouchableOpacity
                  style={styles.viewToggleButton}
                  onPress={() => setViewStyle(viewStyle === 'list' ? 'map' : 'list')}
                  accessibilityLabel={t(viewStyle === 'list' ? 'ui.discover.toMap' : 'ui.discover.toList')}
                  accessibilityRole="button"
                >
                  <Text style={styles.viewToggleIcon}>{viewStyle === 'list' ? '🗺️' : '📋'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {isAll && !isSearching && (
              <View style={[styles.filterRow, { flexDirection: 'row' }]}>{renderTimeChips()}</View>
            )}

            {typeFilter === 'places' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
                {PLACE_CATEGORIES.map((c) => {
                  const active = placesCategory === c.key;
                  return (
                    <TapActiveChip
                      key={c.key}
                      active={active}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setPlacesCategory(c.key)}
                      accessibilityLabel={names.group(c.key, c.label)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={styles.filterChipIcon}>{c.icon}</Text>
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{names.group(c.key, c.label)}</Text>
                    </TapActiveChip>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>

      {/* ModeTransition (the Nearby Motion System, CLAUDE.md Item 113): a brief
          state-change cue on the Things-to-Do<->People switch above, same
          mechanic MessagesScreen's own Matches<->Friends toggle already uses.
          Deliberately deferred when Item 113 first shipped this component --
          this ternary is structurally asymmetric (People is a plain View;
          Things is itself a further expandedContext/map/default split) -- so
          it's wrapped as one single outer transition around the whole
          already-existing ternary rather than restructuring any branch. */}
      <ModeTransition activeKey={mode} style={{ flex: 1 }}>
      {mode === 'people' ? (
        // Real screens embedded in place, no navigation -- the exact same
        // "segmented toggle swaps content in place" pattern the outer
        // Things-to-Do|People toggle above already uses, and the same real-
        // component-embedded-with-a-toggle pattern MessagesScreen already
        // established for its own Matches|Friends switch. Dating and
        // Friends stay two genuinely separate matching systems underneath
        // (own opt-in, own swipe table, own exclusion rules) -- this is a
        // navigation-only merge, never a combined candidate pool. Not a
        // ScrollView: each embedded screen manages its own scroll (a real
        // FlatList for Dating's list view, a PanResponder deck for both) --
        // nesting either inside this screen's own ScrollView would break
        // scrolling, the same reason MessagesScreen renders its own
        // embedded screens in a flex sibling, not inside a ScrollView.
        <View style={{ flex: 1 }}>
          <View style={styles.peopleFixedArea}>
            {meetBanner && (
              <View style={{ marginBottom: spacing.sm }} accessibilityRole="header">
                <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{meetBanner.title}</Text>
                {meetBanner.line ? <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{meetBanner.line}</Text> : null}
              </View>
            )}
            {/* Aug 30 2026 (CLAUDE.md, external UX critique response): this
                inner Dating/Friends choice used to reuse the outer
                Things-to-Do/People toggle's own full-width equal-weight
                pill chrome (modeToggleRow/modeToggleButton) -- two
                co-equal-looking controls stacked directly on top of each
                other read as one undifferentiated block. Given its own
                lighter, auto-width chip treatment instead, so the visual
                hierarchy matches the real one: outer mode first, inner
                sub-mode clearly secondary. Same PEOPLE_SUBMODES data, same
                selectPeopleSubMode() handler -- style-only change.
                Discover UX cleanup item 8 (2026-09-10): the separate
                Stories row that used to sit above this is gone -- its
                signal now lives on each candidate's own avatar in the
                embedded Dating/Friends screens below. This small camera
                icon is its replacement "post a story" entry point, per the
                user's own explicit pick: small, not another prominent
                card or CTA. */}
            <View style={[styles.peopleSubToggleRow, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {PEOPLE_SUBMODES.map((pm) => {
                  const active = peopleSubMode === pm.key;
                  return (
                    <TapActiveChip
                      key={pm.key}
                      active={active}
                      style={[styles.peopleSubToggleButton, active && styles.peopleSubToggleButtonActive]}
                      onPress={() => selectPeopleSubMode(pm.key)}
                      accessibilityLabel={t(`ui.discover.submode.${pm.key}`)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={styles.peopleSubToggleIcon}>{pm.icon}</Text>
                      <Text style={[styles.peopleSubToggleText, active && styles.peopleSubToggleTextActive]}>{t(`ui.discover.submode.${pm.key}`)}</Text>
                    </TapActiveChip>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.postStoryButton}
                onPress={handlePostStory}
                disabled={postingStory}
                accessibilityLabel={t('ui.discover.postStory')}
                accessibilityRole="button"
              >
                {postingStory ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.postStoryButtonIcon}>📷</Text>}
              </TouchableOpacity>
            </View>
          </View>
          {/* ModeTransition (the Nearby Motion System, CLAUDE.md Item 113/115):
              the same dip-and-recover cue as the outer Things-to-Do<->People
              toggle above, now also on this inner Dating<->Friends switch, so
              the two read as siblings under one Discover rather than one
              abruptly replacing the other with unrelated content. Keyed on
              peopleSubMode specifically (not the outer mode, which already has
              its own ModeTransition above) so switching Dating<->Friends fires
              its own cue independent of the outer one. */}
          <ModeTransition activeKey={peopleSubMode} style={{ flex: 1 }}>
            {peopleSubMode === 'dating' ? (
              <DiscoveryScreen navigation={navigation} embedded tonight={meetTonightContext} />
            ) : (
              <FriendDiscoveryScreen navigation={navigation} embedded tonight={meetTonightContext} />
            )}
          </ModeTransition>
        </View>
      ) : (
        // FilterTransition (the Nearby Motion System, CLAUDE.md Item 113): a
        // brief cue that these are new results whenever the active category
        // changes -- covers both directions of the Categories row's chips
        // (browse -> a category, one category -> another via the breadcrumb
        // back button, and back to browse), keyed on contextLabel, which is
        // already null while browsing and a distinct string per selected
        // category/context. Wraps the whole expandedContext/map/default
        // sub-switch (unlike PlacesScreen's single in-place FlatList, this
        // one swaps entire branches) so the cue survives the branch swap the
        // same way the outer ModeTransition above survives the People<->
        // Things swap.
        <FilterTransition activeKey={contextLabel ?? (dateViewData ? `date:${dateViewData.dateFilter}` : null)} style={{ flex: 1 }}>
        {expandedContext ? (
        /* Phase 8 section F -- the same screen, reconfigured. Gatherings /
           Places / Perks are the primary content, all three scoped to this
           context's own real interest tag; People You Know is a strictly
           secondary section underneath, never a peer tab. */
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeCuisine ? (
            <Text style={styles.contextGroupNote}>{t('ui.discover.cuisineNote', { cuisine: activeCuisineLabel })}</Text>
          ) : null}
          {!activeCuisine && (<>
          {contextFriendLine ? <Text style={styles.contextGroupNote}>{contextFriendLine}</Text> : null}
          {contextTonight.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.happeningTonight')}</Text>
              <StaggeredReveal index={0}>
                <View>{contextTonight.map(renderContextGatheringRow)}</View>
              </StaggeredReveal>
            </>
          )}
          {contextTonight.length > 0 && contextGatherings.length === 0 ? null : <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.gatherings')}</Text>}
          {contextGatherings.length === 0 && contextTonight.length > 0 ? null : contextGatherings.length === 0 ? (
            <>
              <EmptyCopy id="context_gatherings" vars={{ topic: contextTopicLabel.toLowerCase() }} />
              <TouchableOpacity
                onPress={() => navigation.navigate('CreateGathering', {
                  quickStartTitle: contextTopicLabel,
                  quickStartCategory: expandedContext.interestTag ?? expandedContext.categoryTags?.[0] ?? null,
                })}
                accessibilityLabel={t('ui.discover.createTopicA11y', { topic: contextTopicLabel })}
                accessibilityRole="button"
              >
                <Text style={styles.emptyActionText}>{t('ui.discover.createTopic', { topic: contextTopicLabel })}</Text>
              </TouchableOpacity>
            </>
          ) : (
            // Item 126 ("Don't animate every card"): an unbounded list -- one
            // coordinated container settle, not N independent per-card slides.
            <StaggeredReveal index={0}>
              <View>{contextGatherings.map(renderContextGatheringRow)}</View>
            </StaggeredReveal>
          )}

          {contextOtherTimeGatherings.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.moreNearby', { topic: names.tag(expandedContext.interestTag) })}</Text>
              <Text style={styles.contextGroupNote}>{t('ui.discover.sameInterest')}</Text>
              <StaggeredReveal index={0}>
                <View>{contextOtherTimeGatherings.map(renderContextGatheringRow)}</View>
              </StaggeredReveal>
            </>
          )}

          {contextCommunities.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.communities')}</Text>
              {contextCommunities.slice(0, 3).map((c) => { const cc = communityContext(c); return (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => openDestination(navigation, cc.destination)}
                  activeOpacity={0.85}
                  accessibilityLabel={[c.name, cc.reason, cc.context].filter(Boolean).join(', ')}
                  accessibilityRole="button"
                >
                  {renderCardIcon('🏘️', c.interest_tag)}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {cc.reason ? <Text style={styles.cardSubtitle} numberOfLines={1}>{cc.reason}</Text> : null}
                    {cc.context ? <Text style={styles.cardSubtitle} numberOfLines={1}>{cc.context}</Text> : null}
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ); })}
            </>
          )}

          <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.places')}</Text>
          {!userLocation ? (
            <>
              <Text style={styles.emptyTextTight}>{t('ui.discover.enableLocationPlaces')}</Text>
              <TouchableOpacity onPress={enableLocation} accessibilityLabel={t('ui.discover.enableLocationA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.enableLocation')}</Text>
              </TouchableOpacity>
            </>
          ) : loadingContextPlaces ? (
            <View style={{ marginVertical: spacing.md }}>
              <NLoader fullScreen={false} size="compact" kind="places" />
            </View>
          ) : openNowActive && contextPlaces.length > 0 && contextPlacesShown.length === 0 ? (
            renderOpenNowEmpty()
          ) : contextPlacesShown.length === 0 ? (
            <>
              <EmptyCopy id="context_places" vars={{ topic: contextTopicLabel.toLowerCase() }} />
              <TouchableOpacity onPress={closeContext} accessibilityLabel={t('ui.discover.browseOtherA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.browseOther')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            contextPlacesShown.slice(0, PREVIEW_COUNT).map((p, i) => (
              <StaggeredReveal key={p.placeId} index={i}>
                <PlaceCard
                  photoUrl={p.photoRef ? getPlacePhotoUrl(p.photoRef) : null}
                  photoHeaders={p.photoRef ? getGoogleMapsRequestHeaders() : undefined}
                  icon="📍"
                  title={p.name}
                  reason={placeReasonLine(p)}
                  onPress={() => openPlaceInMaps(p)}
                  accessibilityLabel={p.name}
                />
              </StaggeredReveal>
            ))
          )}

          </>)}

          <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.perks')}</Text>
          {activeCuisine && contextOffers.length === 0 && !(openNowActive && cuisineMatchesAnyTime.length > 0) ? (
            <>
              <EmptyCopy id="cuisine_none" vars={{ cuisine: activeCuisineLabel }} />
              <TouchableOpacity onPress={() => setCuisineFilter(null)} accessibilityLabel={t('ui.discover.clearCuisineA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.showAllRestaurants')}</Text>
              </TouchableOpacity>
            </>
          ) : openNowActive && contextOffers.length === 0 ? (
            renderOpenNowEmpty()
          ) : contextOffers.length === 0 ? (
            <>
              <EmptyCopy id="context_perks" vars={{ topic: contextTopicLabel.toLowerCase() }} />
              <TouchableOpacity onPress={closeContext} accessibilityLabel={t('ui.discover.browseOtherA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.browseOther')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            // Item 126 ("Don't animate every card"): an unbounded list -- one
            // coordinated container settle, not N independent per-card slides.
            <StaggeredReveal index={0}>
              <View>
                {contextOffers.map((o) => renderPerkCard(o))}
              </View>
            </StaggeredReveal>
          )}

          <TouchableOpacity
            onPress={() => navigation.navigate('AskBusiness', expandedContext.interestTag
              ? { prefillCategory: expandedContext.interestTag }
              : { prefillText: `Looking for ${contextTopicLabel} nearby` })}
            accessibilityLabel={t('ui.discover.getOfferA11y', { topic: contextTopicLabel })}
            accessibilityRole="button"
          >
            <Text style={styles.emptyActionText}>{t('ui.discover.getOffer')}</Text>
          </TouchableOpacity>

          {/* Phase 8 section G -- secondary by construction: it renders
              below the real supply above, and only when there is genuinely
              someone to show. No "N people nearby" count, no zero-state
              placeholder, and nobody who isn't already a real connection. */}
          {contextConnections.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.peopleYouKnow')}</Text>
              <Text style={styles.contextGroupNote}>{t('ui.discover.peopleYouKnowNote')}</Text>
              {contextConnections.map((person) => (
                <TouchableOpacity
                  key={person.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={[person.display_name, t(person.connection === 'friend' ? 'ui.discover.friend' : 'ui.discover.match'), person.gatheringTitle ? t('ui.discover.goingTo', { title: person.gatheringTitle }) : null].filter(Boolean).join(', ')}
                  accessibilityRole="button"
                >
                  {contextConnectionPhotos[person.id] ? (
                    <Image source={{ uri: contextConnectionPhotos[person.id] }} style={styles.connectionAvatar} />
                  ) : (
                    <View style={[styles.connectionAvatar, styles.connectionAvatarPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{person.display_name}</Text>
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {[
                        t(person.connection === 'friend' ? 'ui.discover.connection.friend' : 'ui.discover.connection.match'),
                        person.gatheringTitle ? t('ui.discover.goingTo', { title: person.gatheringTitle }) : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      ) : dateViewData ? (
        /* Item 206: the full Tonight/Today or This Weekend list, in place of the capped sections (so nothing shows twice).
           The breadcrumb's back arrow (or Android back) returns to the sections where they were left. */
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {dateViewData.items.length > 0
            ? dateViewData.items.map((g, i) => renderGatheringTile(g, i))
            : (
              <>
                <EmptyCopy id={openNowActive || environmentFilter ? 'discover_date_none' : 'discover_date_empty'} />
                <TouchableOpacity onPress={closeDateView} accessibilityLabel={t('ui.discover.showEverythingA11y')} accessibilityRole="button">
                  <Text style={styles.emptyActionText}>{t('ui.discover.showEverything')}</Text>
                </TouchableOpacity>
              </>
            )}
        </ScrollView>
      ) : viewStyle === 'map' && showViewToggle ? (
        <View style={{ flex: 1 }}>
          <GatheringsMapView
            gatherings={showGatherings ? filteredGatherings : []}
            deals={mapDeals}
            businesses={mapBusinesses}
            userLocation={userLocation}
            onSelectGathering={(g) => openDestination(navigation, discoverCard(g).destination)}
            onSelectDeal={(d) => { setViewStyle('list'); selectPerk(d.id); setScrollToPerk(d.id); }}
            onSelectBusiness={(b) => setPreviewBusiness(b)}
          />
        </View>
      ) : (
        <ScrollView
          ref={mainScrollRef}
          contentContainerStyle={styles.scrollContent}
          onScroll={(e) => { mainScrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={64}
          onContentSizeChange={restoreMainScroll}
        >
          {weatherBanner && (
            <View style={styles.weatherBanner}>
              <Text style={styles.weatherBannerText}>{weatherBanner}</Text>
            </View>
          )}

          {showCoreLoader && (
            <View style={{ marginVertical: spacing.lg }}>
              <NLoader fullScreen={false} size="compact" kind="activities" />
            </View>
          )}

          {/* Owner item 91: search -> Browse -> contextual sections. */}
          {/* Categories answers "what," not "when" -- a real browse
              entry point over this codebase's own single canonical 19-
              group taxonomy (constants/gatheringCategories.js), the same
              one gatherings/communities/business categorization already
              share, not a second invented list. Tapping a group reuses
              the exact same expand-in-place mechanism (Phase 8 section F)
              a notable gathering tile already opens, just scoped to the
              whole group's tags instead of one gathering's own tag. */}
          {isAll && !isSearching && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.browse')}</Text>
              {renderBrowseRail(openCategoryContext)}
            </>
          )}

          {/* Item 46 (CLAUDE.md, "personalization should determine what
              appears first"): goes first, ahead of Happening Now/Today/
              This Weekend, and only when it's genuinely earned -- a real
              3+-occurrence recurring search category (getMyTopSearchedCategory())
              AND real matching supply nearby. A cold-start user (item 47,
              "don't over-personalize too early") sees nothing here at all
              and falls straight through to the same honest Happening Now/
              Today/This Weekend/Categories hierarchy every user already
              gets -- never a fabricated "we know what you like." */}
          {topCategoryGatherings.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.common.nearYou', { topic: names.tag(topSearchedCategory.category) })}</Text>
                <TouchableOpacity onPress={openTopCategoryContext} accessibilityLabel={t('ui.discover.seeAllTopicA11y', { topic: names.tag(topSearchedCategory.category) })} accessibilityRole="button">
                  <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                </TouchableOpacity>
              </View>
              {topCategoryGatherings.map((g, i) => renderGatheringTile(g, i))}
            </>
          )}

          {/* P1 UX critique reply item 14 ("Things To Do needs a UX pass",
              CLAUDE.md): the default All landing view's real hierarchy --
              "Where do I want to go / what do I want to do / when do I
              want to do it?" answered by four always-visible, consistently
              positioned sections, instead of one quick-date-chip toggle
              silently reshaping a single flat "Recommended For You" list
              beneath it. Each of the three time sections is real
              (utils/gatheringDateFilter.js's matchesDateFilter, the exact
              logic the dedicated Gatherings screen's own "When" filter
              uses) and hides itself when genuinely empty, same as every
              other section on this screen -- no fabricated placeholder. */}
          {!loadingCore && !userLocation && isAll && !isSearching && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.emptyTextTight}>{t('ui.discover.locationBody')}</Text>
              <TouchableOpacity onPress={enableLocation} accessibilityLabel={t('ui.home.locationA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.home.locationCta')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {discoverSections.map((section) => (
            <React.Fragment key={section.key}>
              {section.key === 'now' ? (
                <>
                  <Text style={styles.sectionHeader}>{sectionTitle(section)}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.md }}>
                    {section.items.map(renderHappeningNowTile)}
                  </ScrollView>
                </>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeaderRowLabel} numberOfLines={1}>{sectionTitle(section)}</Text>
                    {section.hasMore && section.dateFilter ? (
                      <TouchableOpacity onPress={() => openDateView(section.dateFilter)} accessibilityLabel={t('ui.discover.seeAllA11y', { title: sectionTitle(section) })} accessibilityRole="button">
                        <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {section.items.map((g, i) => renderGatheringTile(g, i, section.key))}
                </>
              )}
            </React.Fragment>
          ))}

          {/* Item 39 ("search should understand the same language as the
              intent box"): a real natural-language understanding of the
              submitted search, not just the literal ILIKE substring match
              every section below still separately does. "something fun
              with my girlfriend Saturday" has no title/tag it could ever
              literally match, so it used to fall straight through to
              "nothing matched anywhere" -- runIntentSearch() (the same
              classify+resolve pipeline Home's own ask box uses) now checks
              real existing supply first. Purely additive: the literal
              per-section results below are untouched and still render
              alongside this, so a genuine title match still shows up
              there too. */}
          {/* Surprise Me typed into the search box: inline, in the results area, same engine as Home (no new screen or tab). */}
          {surpriseTyped && surpriseLoading && (
            <View style={styles.intentSearchLoadingRow}>
              <NLoader fullScreen={false} size="inline" caption={surpriseText(language, 'picking')} />
            </View>
          )}
          {surpriseTyped && !surpriseLoading && discoverSurprise && (
            <View style={styles.intentSearchBlock}>
              <Text style={styles.intentSearchTitle}>{discoverSurpriseShown.header}</Text>
              {!!discoverSurpriseShown.basis && (
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>{discoverSurpriseShown.basis}</Text>
              )}
              {!discoverSurprise.suggestion ? (
                <EmptyCopy id="surprise_none" />
              ) : discoverSurprise.suggestion.kind === 'lanes' ? (
                // Item 90: labeled rows, each only when a real result backs its label (same engine as Home).
                discoverSurpriseShown.lanes.map((lane) => (
                  <View key={lane.key} style={{ marginBottom: spacing.sm }}>
                    <Text style={styles.intentSearchGroupLabel}>{lane.heading}</Text>
                    {lane.items.map((item, index) => renderIntentSearchResultRow(item, index, { onPress: (it) => navigateToSurprisePick(navigation, it, discoverSurprise), pickBadge: false }))}
                  </View>
                ))
              ) : null}
              {!!discoverSurpriseShown.connectedLine && (
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6 }}>{discoverSurpriseShown.connectedLine}</Text>
              )}
              {discoverSurprise.exhausted && (
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6 }}>{surpriseText(language, 'exhausted')}</Text>
              )}
              {!!discoverSurprise.suggestion && (
                <TouchableOpacity onPress={handleDiscoverSurpriseShuffle} accessibilityLabel={surpriseText(language, 'shuffleLabel')} accessibilityRole="button">
                  <Text style={styles.emptyActionText}>{surpriseText(language, 'shuffle')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {surpriseTyped && !surpriseLoading && !discoverSurprise && (
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>{surpriseText(language, 'pressSearch')}</Text>
          )}

          {isSearching && onTopOrNotTabbed && intentSearching && (
            <View style={styles.intentSearchLoadingRow}>
              <NLoader fullScreen={false} size="inline" caption={intentPhaseCaption(intentPhase?.phase ?? 'understanding', intentPhase?.classifyResult)} />
            </View>
          )}
          {isSearching && onTopOrNotTabbed && !intentSearching && !!restoreFailed && !intentSearch && (
            <View style={styles.intentSearchBlock}>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>{t('ui.discover.restoreFailed')}</Text>
              <TouchableOpacity onPress={() => restoreSession(restoreFailed)} accessibilityLabel={t('ui.common.tryAgain')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.common.tryAgainArrow')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {isSearching && onTopOrNotTabbed && !intentSearching && (intentSearch?.outcome === 'results' || intentSearch?.refined) && (
            <View style={styles.intentSearchBlock}>
              {intentSearch.items?.length > 0 && <FoundLine />}
              <AskRefinementChips
                classifyResult={intentSearch.classifyResult}
                onRefine={handleIntentRefine}
                refining={intentRefining}
                empty={!(intentSearch.items?.length > 0) && !intentSearch.classifyResult?.narrowGroup}
              />
              {/* Item 108: the same Browse rail narrows this ask (it never replaces it). */}
              {renderBrowseRail(handleIntentNarrow, { selectedKey: intentSearch.classifyResult?.narrowGroup ?? null, disabled: intentRefining })}
              {!intentRefining && !(intentSearch.items?.length > 0) && !!intentSearch.classifyResult?.narrowGroup && (
                <>
                  <EmptyCopy id="category_narrow_none" vars={{ topic: names.group(intentSearch.classifyResult.narrowGroup, narrowGroupLabel(intentSearch.classifyResult.narrowGroup)) }} />
                  <TouchableOpacity
                    onPress={() => handleIntentNarrow({ key: intentSearch.classifyResult.narrowGroup })}
                    accessibilityLabel={t('ui.discover.showAllIdeasA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyActionText}>{t('ui.discover.showAllIdeas')}</Text>
                  </TouchableOpacity>
                </>
              )}
              {!!intentSearch.openEndedNote && (
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>{localizeAskNote(intentSearch.openEndedNote, language)}</Text>
              )}
              <Text style={styles.intentSearchTitle}>
                {intentSearch.experience?.title ?? intentSearchFallbackTitle(intentSearch.classifyResult)}
              </Text>
              <View style={styles.intentSearchTagsRow}>
                <Text style={styles.intentSearchTag}>{t('ui.discover.tagNearby')}</Text>
                {!!intentSearch.classifyResult?.narrowGroup && (
                  <Text style={styles.intentSearchTag}>{names.group(intentSearch.classifyResult.narrowGroup, narrowGroupLabel(intentSearch.classifyResult.narrowGroup))}</Text>
                )}
                {intentSearchDateLabel(intentSearch.classifyResult?.dateWindow) && (
                  <Text style={styles.intentSearchTag}>📅 {intentSearchDateLabel(intentSearch.classifyResult.dateWindow)}</Text>
                )}
                {intentSearch.classifyResult?.partyType === 'date' && <Text style={styles.intentSearchTag}>{t('ui.discover.tagForTwo')}</Text>}
                {intentSearch.classifyResult?.partyType === 'groups' && <Text style={styles.intentSearchTag}>{t('ui.discover.tagBigGroup')}</Text>}
                {intentSearch.classifyResult?.partyType === 'friends' && <Text style={styles.intentSearchTag}>{t('ui.discover.tagFriends')}</Text>}
                {intentSearch.classifyResult?.partyType === 'solo' && <Text style={styles.intentSearchTag}>{t('ui.discover.tagSolo')}</Text>}
                {['family', 'coworkers', 'new_people'].includes(intentSearch.classifyResult?.partyType) && (
                  <Text style={styles.intentSearchTag}>{PARTY_TYPE_LABELS[intentSearch.classifyResult.partyType]}</Text>
                )}
              </View>
              {/* Item 76: an explicit typed cuisine keeps its constraint in the Restaurants view (same resolver as the chip). */}
              {!!cuisineConstraintFromText(intentSearch.typedText) && (
                <TouchableOpacity
                  onPress={() => openCuisineContext(cuisineConstraintFromText(intentSearch.typedText))}
                  accessibilityLabel={t('ui.discover.seeCuisineA11y', { cuisine: names.cuisine(cuisineConstraintFromText(intentSearch.typedText), cuisineLabel(cuisineConstraintFromText(intentSearch.typedText))) })}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionText}>{t('ui.discover.seeCuisine', { cuisine: names.cuisine(cuisineConstraintFromText(intentSearch.typedText), cuisineLabel(cuisineConstraintFromText(intentSearch.typedText))) })}</Text>
                </TouchableOpacity>
              )}
              {intentSearch.experience ? (
                <>
                  {(intentSearch.experience.bundles ?? []).map((bundle) => (
                    <View key={bundle.id} style={{ marginBottom: spacing.sm }}>
                      <Text style={styles.intentSearchGroupLabel}>
                        {t('ui.home.onePlace', { parts: bundle.componentLabels.join(' + ') })}
                      </Text>
                      {renderIntentSearchResultRow(bundle)}
                    </View>
                  ))}
                  <ExperienceComponentList
                    experience={intentSearch.experience}
                    renderItem={renderIntentSearchResultRow}
                    navigation={navigation}
                    partySize={intentSearch.classifyResult?.partySize ?? null}
                    labelStyle={styles.intentSearchGroupLabel}
                  />
                </>
              ) : (
                intentSearch.items.map(renderIntentSearchResultRow)
              )}
              {/* Item 189: public places for an allowlisted activity, below Nearby's own results, never ranked with them. */}
              <PlacesToGoSection places={placesToGo.places} navigation={navigation} />
              {/* Item 109: nothing here fits -> Create starts from this ask as it stands (what, when, who incl. a chip). */}
              <TouchableOpacity onPress={createFromAsk} accessibilityLabel={t('ui.discover.createYourselfA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.home.noneCreate')}</Text>
              </TouchableOpacity>
              {/* Item 110: ask businesses with what was already said. Item 190: secondary, and absent for a public-place ask. */}
              {askBusinessesFits(intentSearch.typedText ?? searchQuery.trim()) && (
                <TouchableOpacity
                  onPress={() => askBusinessFromAsk(navigation, { classifyResult: intentSearch.classifyResult, typedText: intentSearch.typedText ?? searchQuery.trim(), submissionId: intentSearch.submissionId })}
                  accessibilityLabel={t('ui.discover.askBusinessesA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.emptyActionText}>{t('ui.discover.askBusinesses')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Item 92: one search, every kind of result -- the activity itself, friends into it, and Nearby businesses. */}
          {resultTabsActive && !resultsSettled && (
            <View style={styles.intentSearchLoadingRow}>
              <NLoader fullScreen={false} size="inline" caption={t('ui.discover.searchingEverything')} />
            </View>
          )}
          {showSearchTopic && (
            <TouchableOpacity
              style={styles.searchTopicRow}
              onPress={() => openSearchTopic(searchedTopic)}
              accessibilityLabel={t('ui.discover.exploreA11y', { topic: searchedTopic.label })}
              accessibilityRole="button"
            >
              <Text style={styles.categoryChipIcon}>{searchedTopic.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{searchedTopic.kind === 'cuisine' ? searchedTopic.label : names.tag(searchedTopic.label)}</Text>
                {!!searchedTopic.groupLabel && <Text style={styles.cardSubtitle} numberOfLines={1}>{searchedTopic.groupLabel}</Text>}
                {!!searchFriendsLine && <Text style={styles.cardSubtitle} numberOfLines={1}>🤝 {searchFriendsLine}</Text>}
              </View>
              <Text style={styles.emptyActionText}>{t('ui.discover.explore')}</Text>
            </TouchableOpacity>
          )}
          {businessesToShow.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.discover.businesses')}</Text>
                {resultTabsActive && resultTab === 'top' && searchedBusinesses.length > businessesToShow.length && (
                  <TouchableOpacity onPress={() => openKind('places', 'places')} accessibilityLabel={t('ui.discover.seeAllBusinessesA11y')} accessibilityRole="button">
                    <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {businessesToShow.map((b) => { const bc = businessContext(b); return (
                <TouchableOpacity
                  key={`biz-${b.id}`}
                  style={styles.searchTopicRow}
                  onPress={() => setPreviewBusiness(b)}
                  accessibilityLabel={[b.name, bc.reason, bc.context].filter(Boolean).join(', ')}
                  accessibilityRole="button"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{b.name}</Text>
                    {bc.reason || bc.context ? (
                      <Text style={styles.cardSubtitle} numberOfLines={1}>{[bc.reason, bc.context].filter(Boolean).join(' · ')}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ); })}
            </>
          )}

          {/* The dedicated Gatherings tab's own real scored/tiered list
              (unaffected by the P1 item 14 redesign above, which only
              replaces the default "All" landing view). */}
          {notableGatherings.length > 0 && (
            <Text style={styles.sectionHeader}>{t('ui.discover.recommended')}</Text>
          )}
          {notableGatherings.map((g, i) => renderGatheringTile(g, i))}

          {showFlatGatheringsSection && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.gatherings')}</Text>
              <NLoader fullScreen={false} size="compact" caption={t('ui.discover.searchingGatherings')} />
            </>
          )}

          {showFlatGatheringsSection && isSearching && !loadingSearch && dedupedGatherings.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.gatherings')}</Text>
              <EmptyCopy id="gatherings_search" vars={{ query: searchQuery.trim() }} />
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel={t('ui.discover.clearSearchA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.clearSearch')}</Text>
              </TouchableOpacity>
            </>
          )}

          {showFlatGatheringsSection && !(isSearching && loadingSearch) && gatheringsToShow.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.discover.typeFilter.gatherings')}</Text>
                {seeAllVisible('plans') && (
                  <TouchableOpacity onPress={() => openKind('plans', 'gatherings')} accessibilityLabel={t('ui.discover.seeAllGatheringsA11y')} accessibilityRole="button">
                    <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {/* Item 126 ("Don't animate every card"): uncapped when not on the blended "All"
                  view -- one coordinated container settle, not N independent per-card slides. */}
              <StaggeredReveal index={0}>
              <View>
              {gatheringsToShow.map((g) => { const card = discoverCard(g); return (
                <TouchableOpacity
                  key={g.id}
                  style={styles.card}
                  onPress={() => openDestination(navigation, card.destination)}
                  activeOpacity={0.85}
                  accessibilityLabel={[g.title, card.meta].filter(Boolean).join(', ')}
                  accessibilityRole="button"
                >
                  {coverPhotoUrls[g.id] ? (
                    <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
                  ) : (
                    renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{g.title}</Text>
                    {/* a literal keyword match: when/where from the context object, no recommendation reason claimed */}
                    {card.meta ? <Text style={styles.cardSubtitle}>{card.meta}</Text> : null}
                    {(gatheringSignalLine(g) || gatheringFullnessLabel(g)) && (
                      <Text
                        style={[styles.cardSubtitle, gatheringFullnessLabel(g)?.startsWith('🔒') && { color: colors.danger }]}
                        numberOfLines={1}
                      >
                        {[gatheringSignalLine(g), gatheringFullnessLabel(g)].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ); })}
              </View>
              </StaggeredReveal>
            </>
          )}

          {showCommunities && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.communities')}</Text>
              <NLoader fullScreen={false} size="compact" caption={t('ui.discover.searchingCommunities')} />
            </>
          )}

          {showCommunities && isSearching && !loadingSearch && communitiesToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.communities')}</Text>
              <EmptyCopy id="communities_search" vars={{ query: searchQuery.trim() }} />
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel={t('ui.discover.clearSearchA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.clearSearch')}</Text>
              </TouchableOpacity>
            </>
          )}

          {showCommunities && !(isSearching && loadingSearch) && communitiesToShow.length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.discover.typeFilter.communities')}</Text>
                {seeAllVisible('activities') && (
                  <TouchableOpacity onPress={() => openKind('activities', 'communities')} accessibilityLabel={t('ui.discover.seeAllCommunitiesA11y')} accessibilityRole="button">
                    <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {/* Item 126 ("Don't animate every card"): uncapped when not on the blended "All"
                  view -- one coordinated container settle, not N independent per-card slides. */}
              <StaggeredReveal index={0}>
              <View>
              {communitiesToShow.map((c) => { const cc = communityContext(c); return (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => openDestination(navigation, cc.destination)}
                  activeOpacity={0.85}
                  accessibilityLabel={[c.name, cc.reason, cc.context].filter(Boolean).join(', ')}
                  accessibilityRole="button"
                >
                  {renderCardIcon('🏘️', c.interest_tag)}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {cc.reason ? <Text style={styles.cardSubtitle} numberOfLines={1}>{cc.reason}</Text> : null}
                    {cc.context || c.description ? <Text style={styles.cardSubtitle} numberOfLines={1}>{[cc.context, c.description].filter(Boolean).join(' · ')}</Text> : null}
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ); })}
              </View>
              </StaggeredReveal>
            </>
          )}

          {/* Sponsored slot (item 44): Places tab only, its own card above the organic list; never in the blended All view or a search. */}
          {/* Not shown while Open now or Outdoor/Indoor is on: a paid card must never ride an organic filter. */}
          {typeFilter === 'places' && !isSearching && !openNowActive && !environmentFilter && (
            <SponsoredSpotlightSlot
              userLocation={userLocation}
              categoryGroup={placesCategory}
              categoryLabel={PLACE_CATEGORIES.some((c) => c.key === placesCategory) ? names.group(placesCategory) : undefined}
              navigation={navigation}
            />
          )}
          {showPlaces && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.discover.typeFilter.places')}</Text>
                {seeAllVisible('places') && visiblePlaces.length > 0 && (
                  <TouchableOpacity onPress={() => openKind('places', 'places')} accessibilityLabel={t('ui.discover.seeAllPlacesA11y')} accessibilityRole="button">
                    <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!userLocation ? (
                <>
                  <Text style={styles.emptyTextTight}>{t('ui.discover.enableLocationDiscover')}</Text>
                  <TouchableOpacity onPress={enableLocation} accessibilityLabel={t('ui.discover.enableLocationA11y')} accessibilityRole="button">
                    <Text style={styles.emptyActionText}>{t('ui.discover.enableLocation')}</Text>
                  </TouchableOpacity>
                </>
              ) : placesPending ? (
                <View style={{ marginVertical: spacing.md }}>
                  <NLoader fullScreen={false} size="compact" kind="places" />
                </View>
              ) : openNowActive && places.length > 0 && placesToShow.length === 0 ? (
                renderOpenNowEmpty()
              ) : placesToShow.length === 0 ? (
                <>
                  <EmptyCopy id={isSearching ? 'places_search' : 'places_category'} vars={{ query: (searchQuery ?? '').trim() }} />
                  {isSearching ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel={t('ui.discover.clearSearchA11y')} accessibilityRole="button">
                      <Text style={styles.emptyActionText}>{t('ui.discover.clearSearch')}</Text>
                    </TouchableOpacity>
                  ) : typeFilter === 'places' ? (
                    <TouchableOpacity onPress={() => setTypeFilter('all')} accessibilityLabel={t('ui.discover.browseEverythingA11y')} accessibilityRole="button">
                      <Text style={styles.emptyActionText}>{t('ui.discover.browseEverything')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Item 26 escape hatch: a real place can't be "created"
                      the way a gathering/community can, but a user can ask
                      businesses directly -- same AskBusinessScreen the
                      Create tab's own "With businesses" row (item 20) and
                      Home's ask-box fallback already use. Only ever a free-
                      text prefill (the place category taxonomy and
                      AskBusinessScreen's own leaf-tag category chips are
                      deliberately separate vocabularies -- see
                      placeCategories.js's own header comment -- so this
                      never silently pre-selects a chip that might not
                      actually match). */}
                  <TouchableOpacity
                    onPress={() => navigation.navigate('AskBusiness', {
                      prefillText: isSearching
                        ? t('ui.places.lookingForNearby', { what: `"${searchQuery.trim()}"` })
                        : t('ui.places.lookingForNearby', { what: PLACE_CATEGORIES.some((c) => c.key === placesCategory) ? names.group(placesCategory) : t('ui.places.something') }),
                    })}
                    accessibilityLabel={t('ui.discover.askBusinessesA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyActionText}>{t('ui.discover.askBusinesses')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // Item 126 ("Don't animate every card"): uncapped when not on the blended "All"
                // view -- one coordinated container settle, not N independent per-card slides.
                <StaggeredReveal index={0}>
                <View>
                {placesToShow.map((p) => (
                  <PlaceCard
                    key={p.placeId}
                    photoUrl={p.photoRef ? getPlacePhotoUrl(p.photoRef) : null}
                    photoHeaders={p.photoRef ? getGoogleMapsRequestHeaders() : undefined}
                    icon="📍"
                    title={p.name}
                    reason={placeReasonLine(p)}
                    onPress={() => openPlaceInMaps(p)}
                    accessibilityLabel={p.name}
                  />
                ))}
                </View>
                </StaggeredReveal>
              )}
            </>
          )}

          {showPerks && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.perks')}</Text>
              <NLoader fullScreen={false} size="compact" caption={t('ui.discover.searchingPerks')} />
            </>
          )}

          {showPerks && isSearching && !loadingSearch && withSelectedPerk(filteredOffers).length === 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.typeFilter.perks')}</Text>
              <EmptyCopy id="perks_search" vars={{ query: searchQuery.trim() }} />
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel={t('ui.discover.clearSearchA11y')} accessibilityRole="button">
                <Text style={styles.emptyActionText}>{t('ui.discover.clearSearch')}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Rule 14: the perk tier (formerly the Rewards screen) is one informational line, Perks tab only, never a dashboard. */}
          {typeFilter === 'perks' && !isSearching && <PerkTierLine />}

          {/* Sponsored slot (item 44): Perks tab only (no category filter here, so any allow-listed category in range). */}
          {typeFilter === 'perks' && !isSearching && !openNowActive && !environmentFilter && (
            <SponsoredSpotlightSlot userLocation={userLocation} categoryGroup={null} navigation={navigation} />
          )}

          {showPerks && !(isSearching && loadingSearch) && withSelectedPerk(offersToShow).length > 0 && (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeaderRowLabel}>{t('ui.discover.typeFilter.perks')}</Text>
                {seeAllVisible('offers') && (
                  <TouchableOpacity onPress={() => openKind('offers', 'perks')} accessibilityLabel={t('ui.discover.seeAllPerksA11y')} accessibilityRole="button">
                    <Text style={styles.seeAllInline}>{t('ui.common.seeAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {/* Item 126 ("Don't animate every card"): uncapped when not on the blended "All"
                  view -- one coordinated container settle, not N independent per-card slides. */}
              <StaggeredReveal index={0}>
              <View>
              {withSelectedPerk(offersToShow).map((o) => renderPerkCard(o))}
              </View>
              </StaggeredReveal>
            </>
          )}

          {/* Decision 5 (CLAUDE.md, Aug 27 2026): once every one of the
              three searchable sections above has genuinely come back empty
              for this term, offer the one thing Discover couldn't --
              routes the typed term through the same classifyCreateRequest()
              call Home's own intent box already uses, then lands on
              whichever real creation screen it returns, term carried
              forward as a real, editable prefill. Never auto-submitted. */}
          {nothingMatchedAnywhere && onTopOrNotTabbed && !openNowActive && (
            <View style={styles.createItCard}>
              <Text style={styles.createItTitle}>{t('ui.discover.dontSee')}</Text>
              <Text style={styles.createItSubtitle}>{t('ui.discover.tellNearby')}</Text>
              {/* Item 37 (context-aware primary CTA): "looking at search
                  results" with nothing real to show -- the primary action
                  is creating the thing itself, in the user's own words. */}
              <TouchableOpacity
                style={styles.createItButton}
                onPress={handleCreateItFromSearch}
                disabled={creatingFromSearch}
                accessibilityLabel={t('ui.discover.createLookingA11y')}
                accessibilityRole="button"
              >
                {creatingFromSearch ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.createItButtonText}>{t('ui.discover.createLooking')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {isAll && happeningNearby.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>{t('ui.discover.happeningNearby')}</Text>
              {happeningNearby.map((group) => (
                <TouchableOpacity
                  key={group.key}
                  style={styles.card}
                  onPress={() => setGatheringStoryViewer(group)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${group.title}, ${group.stories.length} ${group.kind === 'business' ? 'moment' : 'stor'}${group.stories.length === 1 ? (group.kind === 'business' ? '' : 'y') : (group.kind === 'business' ? 's' : 'ies')}`}
                  accessibilityRole="button"
                >
                  {renderCardIcon(group.icon, null)}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{group.title}</Text>
                    <Text style={styles.cardSubtitle}>
                      {group.stories.length} {group.kind === 'business' ? `moment${group.stories.length === 1 ? '' : 's'}` : `stor${group.stories.length === 1 ? 'y' : 'ies'}`}
                    </Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
        )}
        </FilterTransition>
      )}
      </ModeTransition>

      <Modal visible={!!gatheringStoryViewer} animationType={modalAnimation('slide')} onRequestClose={() => setGatheringStoryViewer(null)}>
        <SafeAreaView style={styles.container}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.lg }}>
            <Text style={styles.title}>{gatheringStoryViewer?.title}</Text>
            <TouchableOpacity onPress={() => setGatheringStoryViewer(null)} accessibilityLabel={t('ui.common.close')} accessibilityRole="button">
              <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('ui.common.close')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={gatheringStoryViewer?.stories ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <GatheringStoryItem story={item} colors={colors} posterLabelFallback={gatheringStoryViewer?.posterLabelFallback} />}
          />
        </SafeAreaView>
      </Modal>
      <BusinessPreviewSheet partner={previewBusiness} navigation={navigation} onClose={() => setPreviewBusiness(null)} />
    </SafeAreaView>
  );
}

function GatheringStoryItem({ story, colors, posterLabelFallback }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState(null);
  React.useEffect(() => {
    getSignedStoryUrl(story.media_path).then(setUrl);
  }, [story.media_path]);
  const posterLabel = story.profiles?.display_name ?? posterLabelFallback;
  return (
    <View style={{ marginBottom: spacing.lg, paddingHorizontal: spacing.lg }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }}>{posterLabel}</Text>
      {url ? (
        story.media_type === 'video' ? (
          <Video
            source={{ uri: url }}
            style={{ width: '100%', height: 400, borderRadius: radius.lg }}
            resizeMode="cover"
            useNativeControls
            accessibilityLabel={t('ui.discover.videoStoryA11y', { name: posterLabel })}
          />
        ) : (
          <Image source={{ uri: url }} style={{ width: '100%', height: 400, borderRadius: radius.lg }} resizeMode="cover" />
        )
      ) : (
        <View style={{ width: '100%', height: 400, borderRadius: radius.lg, backgroundColor: colors.surfaceElevated }} />
      )}
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.md },
  // The selected perk: its compact card plus the redemption panel, outlined as one object (Perk Selection State).
  selectedPerk: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, marginBottom: spacing.md, ...shadow.card },
  selectedPerkCardTop: { borderWidth: 0, marginBottom: 0, shadowOpacity: 0, elevation: 0, backgroundColor: 'transparent' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  // Item 44 (CLAUDE.md, "give each screen ONE visual hero"): this used to
  // be two full-width, bordered, filled boxes -- the same visual weight
  // class as the search bar and filter chips below it, so the header read
  // as several equally-loud controls instead of one. The search bar is
  // now the screen's one hero; this is a plain, auto-width text-tab
  // treatment (an underline marks the active mode, no box/fill) so it
  // reads as clearly secondary navigation, the way the mock's plain
  // "Things to Do | People" line does.
  modeToggleRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  modeToggleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.xs, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  modeToggleButtonActive: { borderBottomColor: colors.primary },
  modeToggleIcon: { fontSize: 15 },
  modeToggleText: { color: colors.textTertiary, fontWeight: '600', fontSize: 14 },
  modeToggleTextActive: { color: colors.primary, fontWeight: '700' },
  // Aug 30 2026 (CLAUDE.md, external UX critique response): the People
  // mode's own inner Dating/Friends choice -- a real, deliberately lighter
  // treatment than the outer mode toggle above (auto-width pill chips,
  // not two full-width equal-weight buttons), so it reads as clearly
  // secondary to the primary Things-to-Do/People choice, not co-equal.
  peopleSubToggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  peopleSubToggleButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  peopleSubToggleButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  peopleSubToggleIcon: { fontSize: 13 },
  peopleSubToggleText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  peopleSubToggleTextActive: { color: colors.primary },
  // Discover UX cleanup item 8: deliberately small and plain (no fill, no
  // coral) -- a utility icon, not a primary action, per the user's own
  // "don't make it another prominent card or CTA."
  postStoryButton: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  postStoryButtonIcon: { fontSize: 15 },
  // The non-scrolling header area above People mode's embedded Dating/
  // Friends content (the Dating|Friends sub-toggle + post-story icon) --
  // same horizontal padding as the outer `header`/`scrollContent` blocks
  // so it lines up visually.
  peopleFixedArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  searchTopicRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  searchPrompt: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  // Item 44: the screen's one visual hero -- taller, a slightly heavier
  // border, and a subtle card shadow, so it reads as the obvious place for
  // the eye to land instead of one pill among several similar ones.
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.md,
    ...shadow.card,
  },
  searchIcon: { fontSize: 16, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.md, fontSize: 15 },
  searchClear: { color: colors.textTertiary, fontSize: 16, paddingLeft: spacing.sm },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  openNowNote: { color: colors.textTertiary, fontSize: 12, marginBottom: spacing.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  filterChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  filterChipIcon: { fontSize: 13, marginRight: 4 },
  filterChipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  filterChipTextActive: { color: colors.primary },
  viewToggleButton: {
    width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  viewToggleIcon: { fontSize: 15 },
  // P1 UX critique reply item 14 -- the compact horizontal "Happening Now"
  // tile (renderHappeningNowTile), deliberately smaller/plainer than the
  // full hero/standard cards Today/This Weekend use.
  nowCard: {
    width: 128, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },
  nowCardImage: { width: '100%', height: 64, borderRadius: radius.md, marginBottom: spacing.xs },
  nowCardIconWrap: { alignItems: 'center', justifyContent: 'center' },
  nowCardTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  nowCardSubtitle: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  // The new Categories browse row -- plain chips (no active/selected
  // state, since tapping navigates into an expanded context rather than
  // toggling a filter that stays on this same row).
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6,
  },
  categoryChipIcon: { fontSize: 14 },
  categoryChipText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  weatherBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.primary, padding: spacing.md, marginBottom: spacing.md,
  },
  weatherBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  // Decision 5 (CLAUDE.md, Aug 27 2026): reuses the exact weatherBanner
  // color language (primaryMuted bg, primary border) -- a real, honest
  // "primary" hero treatment already established on this screen, not a
  // new color introduced for one card.
  createItCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5,
    borderColor: colors.primary, padding: spacing.lg, marginTop: spacing.lg, alignItems: 'center',
  },
  createItTitle: { ...typography.headline, color: colors.textPrimary, textAlign: 'center' },
  createItSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  createItButton: {
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg, marginTop: spacing.md, minWidth: 120, alignItems: 'center',
  },
  createItButtonText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  cardImage: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md },
  cardIconWrap: {
    width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIcon: { fontSize: 22 },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 24 },
  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- the standard-tier
  // card's real next-action word (coral, an actual action) vs. the
  // current user's own real RSVP state (muted, informational only --
  // "coral = action, not decoration").
  cardActionLabel: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  cardStateLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 12 },
  // Hero tier -- full-bleed image/gradient card for a gathering whose own
  // real score cleared HERO_SCORE. Height fits a title + one meta line +
  // action pill over the image; text sits on styles.heroScrim, not the
  // raw image/gradient, so legibility never depends on the image's tone.
  heroCard: {
    borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md,
    minHeight: 132, justifyContent: 'flex-end', ...shadow.card,
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
  heroStatePill: {
    backgroundColor: 'rgba(255,255,255,0.24)', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  heroStatePillText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  // Phase 8 section F -- the expanded context's own header row, in the
  // slot the search bar and filter chips occupy in normal browse mode.
  // Neutral, not coral: it names where you are, and the only real action
  // on it is the back arrow.
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  breadcrumbBackButton: { paddingVertical: spacing.xs, paddingRight: spacing.xs },
  breadcrumbBack: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  breadcrumbText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  // The gathering the user actually tapped to get here, marked so it
  // doesn't get lost among its own neighbours. A border tint only -- never
  // coral, which is reserved for actions.
  cardSourceHighlight: { borderColor: colors.textTertiary, borderWidth: 1.5 },
  contextGroupNote: { color: colors.textTertiary, fontSize: 12, marginTop: -spacing.xs, marginBottom: spacing.sm },
  connectionAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.md },
  connectionAvatarPlaceholder: { backgroundColor: colors.surfaceElevated },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  // Item 43 (CLAUDE.md, "Things To Do feels busy"): a title + its own
  // "See all" both live on one row instead of title-content-See-all
  // stacking as three separate lines -- one row of visual weight per
  // section instead of two.
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHeaderRowLabel: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Same "one cluster header, several lighter sub-labels underneath"
  // recipe HomeScreen.js's own "✨ Because You Like…" cluster already
  // established -- reused verbatim (Aug 30 2026 second UX critique fix)
  // so Recommended/Trending read as one grouped signal, not two
  // competing top-level sections.
  subLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.xs },
  seeAllInline: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  emptyText: { color: colors.textTertiary, marginBottom: spacing.lg },
  emptyTextTight: { color: colors.textTertiary, marginBottom: spacing.xs },
  loadingCaption: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xs },
  // Item 39: the "understood as" panel -- a real box (not just a section
  // header) so it visually reads as one distinct interpretation of the
  // search, not another flat list section like Gatherings/Communities
  // below it.
  intentSearchLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  intentSearchLoadingText: { ...typography.caption, color: colors.textTertiary },
  intentSearchBlock: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md, marginBottom: spacing.md,
  },
  intentSearchTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  intentSearchTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  intentSearchTag: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  intentSearchGroupLabel: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs },
  intentSearchResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  intentSearchResultEmoji: { fontSize: 18, marginRight: spacing.sm },
  intentSearchResultTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  intentSearchResultSubtitle: { ...typography.caption, color: colors.textTertiary },
  intentSearchResultChevron: { color: colors.textTertiary, fontSize: 18 },
  emptyActionText: { color: colors.primary, fontWeight: '700', marginBottom: spacing.lg },
});
