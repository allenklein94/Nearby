import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, SafeAreaView, Modal, FlatList, TextInput, ActivityIndicator, Linking, Alert, BackHandler } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Video } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSignedStoryUrl, getPublicStoriesGrouped, getGatheringStoriesGrouped, getBusinessMomentsGrouped, captureStoryMedia, uploadStory } from '../services/stories';
import { getSignedPhotoUrl } from '../services/photos';
import { getNearbyGatherings, searchGatherings, getSignedGatheringPhotoUrl, getGatheringFitReasons } from '../services/gatherings';
import { getPublicCommunities, getMyCommunities, searchPublicCommunities } from '../services/communities';
import { getActiveOffers, getNearbyBusinesses, searchOffers, getMyRedemptions } from '../services/brandOffers';
import { searchNearbyPlaces, getPlacePhotoUrl, priceLevelLabel, getGoogleMapsRequestHeaders } from '../services/places';
import { getSocialForecast } from '../services/homeDashboard';
// Phase 8 section G (CLAUDE.md) -- accepted friends UNION real matches,
// the one shared client-side definition of this app's connected set.
import { filterToMyConnections } from '../services/connections';
import { classifyCreateRequest, routeClassifiedIntentToCreation } from '../services/createAssistant';
import { runIntentSearch, navigateToIntentResultItem } from '../services/intentResolver';
import { recordIntentSelection } from '../services/intentOutcomes';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';
import { SCORE_HAPPENING_NOW as WEATHER_BONUS } from '../services/intentResolverScoring';
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { PLACE_CATEGORIES } from '../constants/placeCategories';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { gatheringTimeBadge, gatheringTimeLine } from '../utils/gatheringTimeLabel';
import { matchesDateFilter } from '../utils/gatheringDateFilter';
import { lightenHex } from '../utils/colorUtils';
import StoryViewerModal from '../components/StoryViewerModal';
import GatheringsMapView from '../components/GatheringsMapView';
import PlaceCard from '../components/PlaceCard';
import TabHeaderActions from '../components/TabHeaderActions';
import DiscoveryScreen from './DiscoveryScreen';
import FriendDiscoveryScreen from './FriendDiscoveryScreen';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { gatheringFullnessLabel } from '../utils/gatheringFullness';
import { gatheringSignalLine } from '../constants/gatheringDisplaySignals';
// P2 remediation item 8 (CLAUDE.md, "Discover information parity") --
// the business/perk half of the same fix.
import { businessSignalLine } from '../constants/businessDisplaySignals';

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
const TRENDING_ATTENDANCE_MIN = 5;

// P1 UX critique reply item 14 (CLAUDE.md, "Things To Do needs a UX pass"):
// real caps for the new Happening Now / Today / This Weekend hierarchy that
// replaces the old single quick-date-chip-driven flat list below -- see
// this file's own header note at DISCOVER_MODES for the fuller rationale.
// Happening Now is deliberately small ("a small horizontal set" per the
// critique's own mock); Today/This Weekend get a slightly deeper vertical
// cap with a real "see more" link to the dedicated Gatherings screen
// (reusing its existing initialDateFilter param) once there's genuinely
// more than the cap.
const HAPPENING_NOW_CAP = 6;
const TIME_SECTION_CAP = 4;

// A lightened variant of a category's own real PALETTE color
// (gatheringCategoryStyles.js), for the hero card's gradient fallback --
// simple additive lightening, not real HSL math, since this only ever
// feeds a decorative gradient endpoint. Text legibility over it is handled
// separately by the hero card's own dark scrim (styles.heroScrim below),
// not by this function -- this never needs to hit a real contrast ratio
// on its own.
const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'gatherings', label: 'Gatherings' },
  { key: 'communities', label: 'Communities' },
  { key: 'places', label: 'Places' },
  { key: 'perks', label: 'Perks' },
];

const PREVIEW_COUNT = 3;

// Item 39 (CLAUDE.md): Discover-local emoji equivalents of HomeScreen's own
// INTENT_RESULT_ICONS (Ionicons names) -- this screen's whole visual
// language is already emoji-based (🔍, ✕, etc.), never Ionicons, so this
// mirrors that instead of introducing a new icon system just for this
// block. Same real 🟢/🟡 confirmed-vs-standing-willingness hierarchy as
// Home's own labels, not a different signal.
const INTENT_SEARCH_TYPE_EMOJI = {
  gathering: '🎉',
  community: '🏘️',
  friend_request: '👥',
  perk: '🎁',
  business_availability: '🟢',
  business_policy_match: '🟡',
  friend_discovery: '💗',
};

// Honest labels for the real dateWindow bucket create-assistant returns --
// never a specific date invented from it (a "weekend" bucket genuinely
// means "Saturday or Sunday," so it renders as "This weekend," not a
// fabricated single day). No entry for 'flexible' -- that's the "no real
// timing signal" case, so no tag renders for it at all.
const INTENT_SEARCH_DATE_LABELS = {
  now: 'Right now',
  today: 'Today',
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
};

function intentSearchDateLabel(dateWindow) {
  return INTENT_SEARCH_DATE_LABELS[dateWindow] ?? null;
}

function intentSearchFallbackTitle(classifyResult) {
  return classifyResult?.category ? `${classifyResult.category} Ideas` : 'Ideas For You';
}

// Aug 24 2026 (CLAUDE.md): Discover is now the real 🔎 bottom tab (it
// used to be a pushed screen reachable only via a single buried
// hyperlink, while People had a full tab for comparatively little
// content) — People merged in as a real mode, not a flattened dump.
// Dating and Friends stay two genuinely separate matching systems under
// the hood (separate opt-in flags, separate swipe tables, separate
// exclusion/safety rules); this is a navigation-only grouping, not a
// combined candidate pool. "Everyone" is still deliberately absent —
// there's no real merged pool to show under that label.
const DISCOVER_MODES = [
  { key: 'things', icon: '🔎', label: 'Things to Do', subtitle: "What's happening nearby." },
  { key: 'people', icon: '👥', label: 'People', subtitle: "Who's around you." },
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
const PEOPLE_SUBMODES = [
  { key: 'dating', icon: '💗', label: 'Dating' },
  { key: 'friends', icon: '🤝', label: 'Friends' },
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
export default function DiscoverHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const { session } = useAuth();
  const myUserId = session?.user?.id ?? null;

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

  const [mode, setMode] = useState('things');
  const [peopleSubMode, setPeopleSubMode] = useState('dating');

  useEffect(() => {
    AsyncStorage.getItem(LAST_MODE_KEY)
      .then((saved) => {
        if (saved === 'things' || saved === 'people') setMode(saved);
      })
      .catch(() => {});
    AsyncStorage.getItem(LAST_PEOPLE_SUBMODE_KEY)
      .then((saved) => {
        if (saved === 'dating' || saved === 'friends') setPeopleSubMode(saved);
      })
      .catch(() => {});
  }, []);

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
  }

  const [publicStories, setPublicStories] = useState([]);
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
  const [storyPhotoUrls, setStoryPhotoUrls] = useState({});
  const [viewerTarget, setViewerTarget] = useState(null);
  // Discover UX cleanup item 8 (CLAUDE.md, 2026-09-10): the People tab's
  // Stories row is gone (its signal now lives on each candidate's own
  // avatar in DiscoveryScreen/SwipeableDiscoveryCards/
  // FriendDiscoverySwipeCards) -- this is its replacement "post a story"
  // entry point, moved to a small header icon per the user's own explicit
  // pick ("very small... don't make it another prominent card or CTA").
  const [postingStory, setPostingStory] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
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
  const [intentSearching, setIntentSearching] = useState(false);
  const intentSearchRequestId = useRef(0);
  const [typeFilter, setTypeFilter] = useState('all');
  function setTypeTab(key) {
    setTypeFilter(key);
  }
  const isAll = typeFilter === 'all';
  const [viewStyle, setViewStyle] = useState('list');
  const [placesCategory, setPlacesCategory] = useState('food_drink');
  const [userLocation, setUserLocation] = useState(null);

  const [gatherings, setGatherings] = useState([]);
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
      navigation.navigate('GatheringDetail', { gatheringId: g.id });
      return;
    }
    setContextPlaces([]);
    setContextConnections([]);
    setContextConnectionPhotos({});
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
    setExpandedContext({
      categoryTags: group.tags,
      categoryLabel: group.label,
      categoryIcon: group.icon,
    });
  }

  function closeContext() {
    setExpandedContext(null);
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (position) {
        setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      }
    }
  }

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

  const [loadingCore, setLoadingCore] = useState(true);
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
  const [loadingSearch, setLoadingSearch] = useState(false);
  // Decision 5 (CLAUDE.md, Aug 27 2026): the "create it" completion CTA's
  // own in-flight state, while classifyCreateRequest() runs.
  const [creatingFromSearch, setCreatingFromSearch] = useState(false);
  const searchRequestId = useRef(0);
  const joinedCommunityIdsRef = useRef(new Set());

  useFocusEffect(
    useCallback(() => {
      loadPublicStories();
      loadGatheringStories();
      loadBusinessMoments();
      loadCore();
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

      const { status } = await Location.getForegroundPermissionsAsync();
      let loc = null;
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
        if (position) {
          loc = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setUserLocation(loc);
        }
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
    const wantsPlaces = typeFilter === 'places' || (typeFilter === 'all' && searchQuery.trim().length >= 2);
    if (!wantsPlaces || !userLocation) return;
    const thisRequestId = ++placesRequestId.current;
    const timer = setTimeout(async () => {
      setLoadingPlaces(true);
      try {
        const category = typeFilter === 'places' ? placesCategory : null;
        const keyword = searchQuery.trim().length >= 2 ? searchQuery.trim() : null;
        const results = await searchNearbyPlaces(userLocation.latitude, userLocation.longitude, category, keyword);
        if (thisRequestId === placesRequestId.current) setPlaces(results);
      } catch (e) {
        console.error('Discover places search failed', e);
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
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchedGatherings([]);
      setSearchedCommunities([]);
      setSearchedOffers([]);
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
        }
      } catch (e) {
        console.error('Discover search failed', e);
      }
      if (thisRequestId === searchRequestId.current) setLoadingSearch(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, userLocation]);

  async function loadPublicStories() {
    try {
      const grouped = await getPublicStoriesGrouped();
      setPublicStories(grouped);
      const urlEntries = await Promise.all(
        grouped.map(async (g) => {
          if (!g.photoUrl) return [g.userId, null];
          const url = await getSignedPhotoUrl(g.photoUrl);
          return [g.userId, url];
        })
      );
      setStoryPhotoUrls(Object.fromEntries(urlEntries));
    } catch (e) {
      console.error('loadPublicStories failed', e);
    }
  }
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
      title: group.partnerName ?? 'A local business',
      posterLabelFallback: group.partnerName ?? 'A local business',
      stories: group.stories,
    })),
  ].sort((a, b) => new Date(b.stories[0]?.created_at ?? 0) - new Date(a.stories[0]?.created_at ?? 0));

  const q = searchQuery.trim().toLowerCase();
  // 2-character minimum, matching the Places search's own established
  // threshold (and the debounced effect above, which only fires a real
  // gatherings/communities query at this same length) — a single keystroke
  // doesn't count as "searching" anywhere else on this screen either.
  const isSearching = q.length >= 2;

  // Gatherings/communities: real server-side, indexed search results
  // (searchedGatherings/searchedCommunities, populated by the debounced
  // effect above) once actively searching, instead of client-side
  // .filter().includes() over the full already-fetched browse lists.
  const filteredGatherings = isSearching ? searchedGatherings : gatherings;
  const filteredCommunities = isSearching ? searchedCommunities : communities;
  // Offers: real server-side, indexed search results (searchedOffers,
  // populated by the debounced effect above — a genuine cross-table search
  // over brand_offers.title/description and brand_partners.name via the new
  // search_offer_ids() RPC) once actively searching, instead of the
  // client-side .filter().includes() this used before.
  const filteredOffers = isSearching ? searchedOffers : offers;

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
  const weatherBanner = weatherIndoorBias
    ? '🌧️ Rain expected — showing indoor options first'
    : weatherOutdoorBias
      ? '☀️ Great day out — showing outdoor options first'
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
      fit.reasons = [...fit.reasons, 'Good for the weather'];
    } else if (weatherOutdoorBias && isOutdoorCategory(g.interest_tag)) {
      fit.score += WEATHER_BONUS;
      fit.reasons = [...fit.reasons, 'Great weather for it'];
    }
    return { ...g, fit };
  }

  // P1 UX critique reply item 14 (CLAUDE.md, "Things To Do needs a UX
  // pass"): the default "All" landing view no longer has its own flat
  // "Recommended For You" pass -- it's replaced below by the real
  // Happening Now/Today/This Weekend hierarchy. The dedicated Gatherings
  // tab's own experience (a real scored/tiered list) is untouched.
  const notableGatherings = !isSearching && typeFilter === 'gatherings'
    ? filteredGatherings
        .map(scoreGathering)
        .filter((g) => g.fit.score >= STANDARD_SCORE)
        .sort((a, b) => b.fit.score - a.fit.score)
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
  const happeningNowGatherings = isAll && !isSearching
    ? filteredGatherings
        .filter((g) => matchesDateFilter(g.scheduled_at, 'now'))
        .map(scoreGathering)
        .sort((a, b) => b.fit.score - a.fit.score)
        .slice(0, HAPPENING_NOW_CAP)
    : [];
  const happeningNowIds = new Set(happeningNowGatherings.map((g) => g.id));

  const todayQualifying = isAll && !isSearching
    ? filteredGatherings.filter((g) => matchesDateFilter(g.scheduled_at, 'today') && !happeningNowIds.has(g.id))
    : [];
  const todayGatherings = todayQualifying
    .map(scoreGathering)
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, TIME_SECTION_CAP);
  const todayHasMore = todayQualifying.length > TIME_SECTION_CAP;
  const todayIds = new Set(todayGatherings.map((g) => g.id));

  const weekendQualifying = isAll && !isSearching
    ? filteredGatherings.filter((g) => matchesDateFilter(g.scheduled_at, 'weekend') && !happeningNowIds.has(g.id) && !todayIds.has(g.id))
    : [];
  const weekendGatherings = weekendQualifying
    .map(scoreGathering)
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, TIME_SECTION_CAP);
  const weekendHasMore = weekendQualifying.length > TIME_SECTION_CAP;

  // Phase 8 section F -- the expanded context's own real content, filtered
  // out of what this screen already fetched. No new gatherings/offers query
  // is fired to enter a context.
  //
  // "Nearby" in the breadcrumb is not a third filter applied here: every
  // row in `gatherings` already came from getNearbyGatherings('wide') and
  // every row in `offers` from getActiveOffers(lat, lng), so the scope is
  // real and already applied -- the label names the constraint that's
  // genuinely in force rather than claiming one that isn't.
  const contextGatherings = expandedContext
    ? gatherings.filter((g) => (expandedContext.categoryTags
        ? expandedContext.categoryTags.includes(g.interest_tag)
        : g.interest_tag === expandedContext.interestTag && gatheringTimeBadge(g.scheduled_at) === expandedContext.timeBucket))
    : [];
  const contextGatheringIds = new Set(contextGatherings.map((g) => g.id));
  // Same interest, genuinely different time. Shown as its own clearly
  // labelled group rather than silently folded into the exact-context list
  // above -- a "Tonight" context must never quietly list next Saturday
  // under the same heading. Category mode has no time constraint to begin
  // with (contextGatherings above already includes every time), so this
  // is always empty there -- not a second, redundant listing of the exact
  // same rows.
  const contextOtherTimeGatherings = expandedContext && !expandedContext.categoryTags
    ? gatherings.filter((g) => g.interest_tag === expandedContext.interestTag && !contextGatheringIds.has(g.id))
    : [];
  // target_interest_tag is the offer row's own real targeting field (the
  // same one the Perks section above already reads) -- not a keyword guess
  // against the offer's title.
  const contextOffers = expandedContext
    ? offers.filter((o) => (expandedContext.categoryTags
        ? expandedContext.categoryTags.includes(o.target_interest_tag)
        : o.target_interest_tag === expandedContext.interestTag))
    : [];
  // The one real topic label this context is about, regardless of which
  // mode opened it -- every empty-state string and the Places search
  // keyword below read this instead of assuming expandedContext.interestTag
  // exists.
  const contextTopicLabel = expandedContext?.categoryLabel ?? expandedContext?.interestTag ?? '';
  // A stable dep for the connections effect below -- contextGatherings is
  // rebuilt every render, so its identity can't be a dependency.
  const contextGatheringKey = contextGatherings.map((g) => g.id).join(',');

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
      contextGatherings.flatMap((g) => (g.approvedAttendees ?? []).map((a) => a.user_id))
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
          gatheringTitle: contextGatherings.find((g) =>
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

  const showGatherings = typeFilter === 'all' || typeFilter === 'gatherings';
  // P1 UX critique reply item 14: the old flat "Gatherings" preview
  // section (below) is now redundant with the new Happening Now/Today/
  // This Weekend hierarchy for the default "All" browse case -- it stays
  // exactly as before for the dedicated Gatherings tab, and for search
  // results (which the new hierarchy deliberately doesn't cover either).
  const showFlatGatheringsSection = showGatherings && !(isAll && !isSearching);
  const showCommunities = typeFilter === 'all' || typeFilter === 'communities';
  const showPlaces = typeFilter === 'all' || typeFilter === 'places';
  const showPerks = typeFilter === 'all' || typeFilter === 'perks';
  const showViewToggle = typeFilter === 'all' || typeFilter === 'gatherings' || typeFilter === 'perks';

  // Whatever already surfaced above doesn't repeat in the plain catch-all
  // list right below it. A no-op when `notableGatherings` is empty
  // (Communities/Places/Perks views, or while actively searching).
  const dedupedGatherings = filteredGatherings.filter((g) => !notableGatheringIds.has(g.id));
  const gatheringsToShow = isAll ? dedupedGatherings.slice(0, PREVIEW_COUNT) : dedupedGatherings;
  const communitiesToShow = isAll ? filteredCommunities.slice(0, PREVIEW_COUNT) : filteredCommunities;
  const offersToShow = isAll ? filteredOffers.slice(0, PREVIEW_COUNT) : filteredOffers;
  const placesToShow = isAll ? places.slice(0, PREVIEW_COUNT) : places;

  // Decision 5 (CLAUDE.md, Aug 27 2026): a real "nothing anywhere matched"
  // state, checked against all three real searchable sections regardless of
  // the active type filter -- a user filtered to just Communities but who
  // would have gotten a real Gatherings match never sees a "create it"
  // prompt implying total failure. Places is deliberately excluded (a
  // Google-Places-backed browse, not a create-it candidate).
  const nothingMatchedAnywhere = isSearching && !loadingSearch
    && filteredGatherings.length === 0 && filteredCommunities.length === 0 && filteredOffers.length === 0;

  // Item 39: explicit-submit (Enter/Search key), not the live debounce the
  // literal keyword search above uses -- see intentSearchRequestId's own
  // comment for why. A "business_partner" classification has no results
  // concept (matches HomeScreen's own proceedToCreation for that intent)
  // so it routes straight to creation instead of ever setting intentSearch.
  async function handleUnderstandSearch() {
    const typedText = searchQuery.trim();
    if (typedText.length < 2) return;
    const thisRequestId = ++intentSearchRequestId.current;
    setIntentSearching(true);
    try {
      const result = await runIntentSearch(typedText);
      if (thisRequestId !== intentSearchRequestId.current) return;
      if (result.outcome === 'business_partner') {
        setIntentSearch(null);
        routeClassifiedIntentToCreation(navigation, result.classifyResult, typedText);
      } else {
        setIntentSearch(result);
      }
    } catch (e) {
      console.error('Discover intent search failed', e);
    }
    if (thisRequestId === intentSearchRequestId.current) setIntentSearching(false);
  }

  function handleIntentSearchResultTap(item) {
    const { classifyResult, typedText, submissionId } = intentSearch ?? {};
    recordIntentSelection({
      rawText: typedText,
      category: classifyResult?.category ?? null,
      dateWindow: classifyResult?.dateWindow ?? null,
      resultType: item.type,
      resultId: item.id ?? null,
      resultTitle: item.title,
      submissionId,
    });
    // Deliberately doesn't clear intentSearch, unlike HomeScreen's own
    // handleIntentResultTap -- this is a search results screen, not a
    // one-shot ask box, so returning here after viewing a result should
    // still show the same understood block, same as the literal keyword
    // search results right below it never disappear on their own either.
    navigateToIntentResultItem(navigation, item, { typedText, classifyResult });
  }

  function renderIntentSearchResultRow(item) {
    return (
      <TouchableOpacity
        key={`${item.type}-${item.id}`}
        style={styles.intentSearchResultRow}
        onPress={() => handleIntentSearchResultTap(item)}
        activeOpacity={0.85}
        accessibilityLabel={item.title}
        accessibilityRole="button"
      >
        <Text style={styles.intentSearchResultEmoji}>{INTENT_SEARCH_TYPE_EMOJI[item.type] ?? '📌'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.intentSearchResultTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.intentSearchResultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
        </View>
        <Text style={styles.intentSearchResultChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  async function handleCreateItFromSearch() {
    const typedText = searchQuery.trim();
    if (!typedText) return;
    setCreatingFromSearch(true);
    try {
      const result = await classifyCreateRequest(typedText);
      routeClassifiedIntentToCreation(navigation, result, typedText);
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
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
        'Who can see this?',
        '',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setPostingStory(false) },
          {
            text: 'Matches & Friends Only',
            onPress: async () => {
              await uploadStory(myUserId, captured.uri, captured.type, false);
              setPostingStory(false);
            },
          },
          {
            text: 'Public — Anyone',
            onPress: async () => {
              await uploadStory(myUserId, captured.uri, captured.type, true);
              setPostingStory(false);
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('Error', e.message);
      setPostingStory(false);
    }
  }

  const mapDeals = showPerks ? filteredOffers.filter((o) => o.latitude != null && o.longitude != null) : [];
  const mapBusinesses = showPerks ? businesses : [];

  const activeModeInfo = DISCOVER_MODES.find((m) => m.key === mode);

  // Phase 8 (CLAUDE.md, Discover visual hierarchy) -- the specific "why"
  // line every notable card shows, in priority order: a real matched
  // interest (names the actual tag, never the generic shared "Matches your
  // interests" string), then a real high attendance count, then whatever
  // getGatheringFitReasons() itself ranked first for anything else that
  // still cleared STANDARD_SCORE (e.g. "Very close" / "0.3 mi away" /
  // "Happening today").
  function primaryReasonLine(g) {
    if (g.matchesYourInterests && g.interest_tag) return `Matches your ${g.interest_tag} interest`;
    const attendeeCount = g.approvedAttendees?.length ?? 0;
    if (attendeeCount >= TRENDING_ATTENDANCE_MIN) return `${attendeeCount} attending`;
    return g.fit.reasons[0] ?? null;
  }

  // The hero card's small eyebrow label -- same three real signals as
  // primaryReasonLine above, just as a short badge word instead of a full
  // sentence, falling back to the real time badge (gatheringTimeBadge)
  // when neither a matched interest nor real popularity is what earned
  // this gathering its spot (e.g. it qualified purely on distance/today).
  function heroEyebrow(g) {
    if (g.matchesYourInterests) return 'PERSONALIZED';
    if ((g.approvedAttendees?.length ?? 0) >= TRENDING_ATTENDANCE_MIN) return 'TRENDING';
    return gatheringTimeBadge(g.scheduled_at) ?? 'RECOMMENDED';
  }

  // The current user's own real RSVP status on this gathering, derived
  // from the raw `attendees` array every gathering row already carries
  // (enrichGatheringsWithDistanceAndSort, services/gatherings.js) -- not a
  // new fetch. Mirrors GatheringDetailScreen's own myStatus values exactly.
  function myAttendeeStatus(g) {
    if (!myUserId) return null;
    return (g.attendees ?? []).find((a) => a.user_id === myUserId)?.status ?? null;
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
  function gatheringActionInfo(g) {
    const status = myAttendeeStatus(g);
    if (status === 'approved') return { kind: 'state', label: 'Going' };
    if (status === 'waitlisted') return { kind: 'state', label: 'Waitlisted' };
    if (status === 'pending') return { kind: 'state', label: 'Interested' };
    const isFull = g.capacity != null && (g.approvedAttendees?.length ?? 0) >= g.capacity;
    return { kind: 'cta', label: isFull ? 'Join Waitlist' : (g.is_public ? 'Join Gathering' : 'Request to Join') };
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
        ? [expandedContext.categoryIcon, expandedContext.categoryLabel, 'Nearby'].filter(Boolean).join(' ')
        : [expandedContext.interestTag, titleCaseBadge(expandedContext.timeBucket), 'Nearby'].filter(Boolean).join(' · '))
    : null;

  // The one real "why this place, right now" line, shared verbatim by the
  // main Places section and the expanded context's own Places list rather
  // than written out twice. Every part of it is a real Google Places
  // Basic-Data field or this app's own real gathering count -- falls back
  // to the address when none of them came back.
  function placeReasonLine(p) {
    return [
      p.rating !== null ? `⭐ ${p.rating}${p.reviewCount !== null ? ` (${p.reviewCount})` : ''}` : null,
      priceLevelLabel(p.priceLevel),
      p.openNow !== null ? (p.openNow ? 'Open now' : 'Closed') : null,
      p.gatheringCount > 0 ? `🎉 ${p.gatheringCount} gathering${p.gatheringCount === 1 ? '' : 's'} here` : null,
    ].filter(Boolean).join('  ·  ') || p.address;
  }

  function openPlaceInMaps(p) {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}&query_place_id=${p.placeId}`);
  }

  // The standard gathering row inside an expanded context. Tapping it does
  // navigate for real: from inside the context there is no further
  // in-place depth to reveal, so opening the gathering itself is a genuine
  // task change (join, message, see the roster) -- exactly the line
  // CLAUDE.md's Progressive Depth doctrine draws.
  function renderContextGatheringRow(g) {
    const action = gatheringActionInfo(g);
    const timeLine = gatheringTimeLine(g.scheduled_at);
    const isSource = g.id === expandedContext?.sourceGatheringId;
    return (
      <TouchableOpacity
        key={g.id}
        style={[styles.card, isSource && styles.cardSourceHighlight]}
        onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
        activeOpacity={0.85}
        accessibilityLabel={`${g.title}, ${g.distanceLabel}`}
        accessibilityRole="button"
      >
        {coverPhotoUrls[g.id] ? (
          <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
        ) : (
          renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{g.title}</Text>
          {(timeLine || g.distanceLabel) && (
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {[timeLine, g.distanceLabel].filter(Boolean).join(' · ')}
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
  function renderGatheringTile(g) {
    const action = gatheringActionInfo(g);
    const reasonLine = primaryReasonLine(g);
    const timeLine = gatheringTimeLine(g.scheduled_at);

    if (g.fit.score >= HERO_SCORE) {
      const categoryStyle = categoryStyleFor(g.interest_tag);
      return (
        <TouchableOpacity
          key={g.id}
          style={styles.heroCard}
          /* Phase 8 section F -- the card body no longer navigates:
             tapping it expands this screen around the gathering's own
             context. The CTA below is its own nested touchable and
             still navigates, because joining is a real task change. */
          onPress={() => openContextFor(g)}
          activeOpacity={0.9}
          accessibilityLabel={`${g.title}, ${heroEyebrow(g)}${reasonLine ? `, ${reasonLine}` : ''}. Shows more like this.`}
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
            <Image source={{ uri: curatedCoverPhotoFor(g.interest_tag) }} style={styles.heroImage} accessibilityLabel={`${g.interest_tag} cover photo`} />
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
                {[reasonLine, timeLine, g.distanceLabel].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {action.kind === 'cta' ? (
              <TouchableOpacity
                style={styles.heroCta}
                onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
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
      );
    }

    return (
      <TouchableOpacity
        key={g.id}
        style={styles.card}
        onPress={() => openContextFor(g)}
        activeOpacity={0.85}
        accessibilityLabel={`${g.title}${reasonLine ? `, ${reasonLine}` : ''}. Shows more like this.`}
        accessibilityRole="button"
      >
        {coverPhotoUrls[g.id] ? (
          <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
        ) : (
          renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{g.title}</Text>
          {(reasonLine || timeLine || g.distanceLabel) && (
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {[reasonLine, timeLine, g.distanceLabel].filter(Boolean).join(' · ')}
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
            onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
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
    );
  }

  // P1 UX critique reply item 14: a compact horizontal "Happening Now"
  // tile -- deliberately smaller/plainer than renderGatheringTile's own
  // hero/standard tiers (the critique's own mock calls this "a small
  // horizontal set," not a peer of Today/This Weekend's fuller cards).
  // Still taps into the same real expand-in-place context as every other
  // gathering tile on this screen.
  function renderHappeningNowTile(g) {
    const timeLine = gatheringTimeLine(g.scheduled_at);
    return (
      <TouchableOpacity
        key={g.id}
        style={styles.nowCard}
        onPress={() => openContextFor(g)}
        activeOpacity={0.85}
        accessibilityLabel={`${g.title}, ${[timeLine, g.distanceLabel].filter(Boolean).join(', ')}. Shows more like this.`}
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
        {(timeLine || g.distanceLabel) && (
          <Text style={styles.nowCardSubtitle} numberOfLines={1}>
            {[timeLine, g.distanceLabel].filter(Boolean).join(' · ')}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Discover</Text>
            <Text style={styles.subtitle}>{activeModeInfo.subtitle}</Text>
          </View>
          <TabHeaderActions navigation={navigation} />
        </View>

        <View style={styles.modeToggleRow}>
          {DISCOVER_MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.modeToggleButton, active && styles.modeToggleButtonActive]}
                onPress={() => selectMode(m.key)}
                accessibilityLabel={m.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.modeToggleIcon}>{m.icon}</Text>
                <Text style={[styles.modeToggleText, active && styles.modeToggleTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Phase 8 section F -- while a context is open, its breadcrumb
            replaces the search bar and type-filter chips: those controls
            describe the normal browse list, not this filtered view, and
            leaving them live would let someone silently contradict the
            breadcrumb they're looking at. Back just clears the state --
            there was never a screen pushed to pop. */}
        {mode === 'things' && expandedContext && (
          <View style={styles.breadcrumbRow}>
            <TouchableOpacity
              style={styles.breadcrumbBackButton}
              onPress={closeContext}
              accessibilityLabel="Back to Discover"
              accessibilityRole="button"
            >
              <Text style={styles.breadcrumbBack}>←</Text>
            </TouchableOpacity>
            <Text style={styles.breadcrumbText} numberOfLines={1}>{contextLabel}</Text>
          </View>
        )}

        {mode === 'things' && !expandedContext && (
          <>
            <View style={styles.searchBarWrap}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder='Search, or try "something fun Saturday"'
                placeholderTextColor={colors.textTertiary}
                value={searchQuery}
                onChangeText={(t) => {
                  setSearchQuery(t);
                  // Item 39: the previous "understood as" block described
                  // the old text -- invalidate it (and any in-flight
                  // request for it) the moment the text changes, same
                  // discipline searchRequestId/placesRequestId already use.
                  intentSearchRequestId.current += 1;
                  setIntentSearch(null);
                }}
                onSubmitEditing={handleUnderstandSearch}
                returnKeyType="search"
                accessibilityLabel="Search Discover, or describe what you want in plain English"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchQuery('');
                    intentSearchRequestId.current += 1;
                    setIntentSearch(null);
                  }}
                  accessibilityLabel="Clear search"
                  accessibilityRole="button"
                >
                  <Text style={styles.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {TYPE_FILTERS.map((f) => {
                  const active = typeFilter === f.key;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setTypeTab(f.key)}
                      accessibilityLabel={f.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {showViewToggle && (
                <TouchableOpacity
                  style={styles.viewToggleButton}
                  onPress={() => setViewStyle(viewStyle === 'list' ? 'map' : 'list')}
                  accessibilityLabel={viewStyle === 'list' ? 'Switch to map view' : 'Switch to list view'}
                  accessibilityRole="button"
                >
                  <Text style={styles.viewToggleIcon}>{viewStyle === 'list' ? '🗺️' : '📋'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {typeFilter === 'places' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
                {PLACE_CATEGORIES.map((c) => {
                  const active = placesCategory === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setPlacesCategory(c.key)}
                      accessibilityLabel={c.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={styles.filterChipIcon}>{c.icon}</Text>
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>

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
                    <TouchableOpacity
                      key={pm.key}
                      style={[styles.peopleSubToggleButton, active && styles.peopleSubToggleButtonActive]}
                      onPress={() => selectPeopleSubMode(pm.key)}
                      accessibilityLabel={pm.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={styles.peopleSubToggleIcon}>{pm.icon}</Text>
                      <Text style={[styles.peopleSubToggleText, active && styles.peopleSubToggleTextActive]}>{pm.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.postStoryButton}
                onPress={handlePostStory}
                disabled={postingStory}
                accessibilityLabel="Post a story"
                accessibilityRole="button"
              >
                {postingStory ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.postStoryButtonIcon}>📷</Text>}
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            {peopleSubMode === 'dating' ? (
              <DiscoveryScreen navigation={navigation} embedded />
            ) : (
              <FriendDiscoveryScreen navigation={navigation} embedded />
            )}
          </View>
        </View>
      ) : expandedContext ? (
        /* Phase 8 section F -- the same screen, reconfigured. Gatherings /
           Places / Perks are the primary content, all three scoped to this
           context's own real interest tag; People You Know is a strictly
           secondary section underneath, never a peer tab. */
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionHeader}>Gatherings</Text>
          {contextGatherings.length === 0 ? (
            <>
              <Text style={styles.emptyTextTight}>No {contextTopicLabel.toLowerCase()} gatherings at this time nearby.</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('CreateGathering', {
                  quickStartTitle: contextTopicLabel,
                  quickStartCategory: expandedContext.interestTag ?? expandedContext.categoryTags?.[0] ?? null,
                })}
                accessibilityLabel={`Create a ${contextTopicLabel} gathering`}
                accessibilityRole="button"
              >
                <Text style={styles.emptyActionText}>+ Create a {contextTopicLabel} Gathering →</Text>
              </TouchableOpacity>
            </>
          ) : (
            contextGatherings.map(renderContextGatheringRow)
          )}

          {contextOtherTimeGatherings.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>More {expandedContext.interestTag} Nearby</Text>
              <Text style={styles.contextGroupNote}>Same interest, a different time.</Text>
              {contextOtherTimeGatherings.map(renderContextGatheringRow)}
            </>
          )}

          <Text style={styles.sectionHeader}>Places</Text>
          {!userLocation ? (
            <>
              <Text style={styles.emptyTextTight}>Enable location to see places nearby.</Text>
              <TouchableOpacity onPress={enableLocation} accessibilityLabel="Enable location" accessibilityRole="button">
                <Text style={styles.emptyActionText}>Enable Location →</Text>
              </TouchableOpacity>
            </>
          ) : loadingContextPlaces ? (
            <View style={{ marginVertical: spacing.md }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingCaption}>Finding places nearby…</Text>
            </View>
          ) : contextPlaces.length === 0 ? (
            <>
              <Text style={styles.emptyTextTight}>No {contextTopicLabel.toLowerCase()} places found nearby.</Text>
              <TouchableOpacity onPress={closeContext} accessibilityLabel="Browse other categories" accessibilityRole="button">
                <Text style={styles.emptyActionText}>← Browse Other Categories</Text>
              </TouchableOpacity>
            </>
          ) : (
            contextPlaces.slice(0, PREVIEW_COUNT).map((p) => (
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
            ))
          )}

          <Text style={styles.sectionHeader}>Perks</Text>
          {contextOffers.length === 0 ? (
            <>
              <Text style={styles.emptyTextTight}>No {contextTopicLabel.toLowerCase()} perks nearby right now.</Text>
              <TouchableOpacity onPress={closeContext} accessibilityLabel="Browse other categories" accessibilityRole="button">
                <Text style={styles.emptyActionText}>← Browse Other Categories</Text>
              </TouchableOpacity>
            </>
          ) : (
            contextOffers.map((o) => {
              const isRedeemed = redeemedOfferIds.has(o.id);
              return (
                <PlaceCard
                  key={o.id}
                  icon="🎁"
                  photoUrl={o.target_interest_tag ? curatedCoverPhotoFor(o.target_interest_tag) : null}
                  tintColor={o.target_interest_tag ? categoryStyleFor(o.target_interest_tag).color : null}
                  title={o.title}
                  reason={[o.brand_partners?.name, businessSignalLine(o.brand_partners)].filter(Boolean).join(' · ')}
                  onPress={() => navigation.navigate('BrandOffers', { highlightOfferId: o.id })}
                  accessibilityLabel={`${o.title}, ${o.brand_partners?.name}, ${isRedeemed ? 'already redeemed' : 'Redeem'}`}
                  actionLabel={isRedeemed ? 'Redeemed ✓' : 'Redeem'}
                  actionIsState={isRedeemed}
                />
              );
            })
          )}

          {/* Phase 8 section G -- secondary by construction: it renders
              below the real supply above, and only when there is genuinely
              someone to show. No "N people nearby" count, no zero-state
              placeholder, and nobody who isn't already a real connection. */}
          {contextConnections.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>People You Know</Text>
              <Text style={styles.contextGroupNote}>
                Friends and matches who are already going to one of these.
              </Text>
              {contextConnections.map((person) => (
                <TouchableOpacity
                  key={person.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('ViewProfile', { userId: person.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${person.display_name}, ${person.connection === 'friend' ? 'friend' : 'match'}${person.gatheringTitle ? `, going to ${person.gatheringTitle}` : ''}`}
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
                        person.connection === 'friend' ? 'Friend' : 'Match',
                        person.gatheringTitle ? `Going to ${person.gatheringTitle}` : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
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
            onSelectGathering={(g) => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
            onSelectDeal={(d) => navigation.navigate('BrandOffers', { highlightOfferId: d.id })}
            onSelectBusiness={(b) => navigation.navigate('BusinessProfile', { partnerId: b.id })}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {weatherBanner && (
            <View style={styles.weatherBanner}>
              <Text style={styles.weatherBannerText}>{weatherBanner}</Text>
            </View>
          )}

          {isAll && publicStories.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Public Stories Near You</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
                {publicStories.map((group) => (
                  <TouchableOpacity
                    key={group.userId}
                    style={styles.storyRing}
                    onPress={() => setViewerTarget(group)}
                    accessibilityLabel={`${group.displayName}'s public story`}
                    accessibilityRole="button"
                  >
                    {storyPhotoUrls[group.userId] ? (
                      <Image source={{ uri: storyPhotoUrls[group.userId] }} style={styles.storyAvatar} />
                    ) : (
                      <View style={[styles.storyAvatar, styles.storyAvatarPlaceholder]} />
                    )}
                    <Text style={styles.storyName} numberOfLines={1}>{group.displayName}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {loadingCore && (
            <View style={{ marginVertical: spacing.lg }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingCaption}>Finding things nearby…</Text>
            </View>
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
          {happeningNowGatherings.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>⚡ Happening Now</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.md }}>
                {happeningNowGatherings.map(renderHappeningNowTile)}
              </ScrollView>
            </>
          )}

          {todayGatherings.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>🌅 Today</Text>
              {todayGatherings.map(renderGatheringTile)}
              {todayHasMore && (
                <TouchableOpacity onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'today' })} accessibilityLabel="See all happening today" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all happening today →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {weekendGatherings.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>🌴 This Weekend</Text>
              {weekendGatherings.map(renderGatheringTile)}
              {weekendHasMore && (
                <TouchableOpacity onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'weekend' })} accessibilityLabel="See all this weekend" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all this weekend →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

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
              <Text style={styles.sectionHeader}>Categories</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.md }}>
                {CATEGORY_GROUPS.map((group) => (
                  <TouchableOpacity
                    key={group.key}
                    style={styles.categoryChip}
                    onPress={() => openCategoryContext(group)}
                    activeOpacity={0.85}
                    accessibilityLabel={group.label}
                    accessibilityRole="button"
                  >
                    <Text style={styles.categoryChipIcon}>{group.icon}</Text>
                    <Text style={styles.categoryChipText}>{group.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

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
          {isSearching && intentSearching && (
            <View style={styles.intentSearchLoadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.intentSearchLoadingText}>Understanding "{searchQuery.trim()}"…</Text>
            </View>
          )}
          {isSearching && !intentSearching && intentSearch?.outcome === 'results' && (
            <View style={styles.intentSearchBlock}>
              <Text style={styles.intentSearchTitle}>
                {intentSearch.experience?.title ?? intentSearchFallbackTitle(intentSearch.classifyResult)}
              </Text>
              <View style={styles.intentSearchTagsRow}>
                <Text style={styles.intentSearchTag}>📍 Nearby</Text>
                {intentSearchDateLabel(intentSearch.classifyResult?.dateWindow) && (
                  <Text style={styles.intentSearchTag}>📅 {intentSearchDateLabel(intentSearch.classifyResult.dateWindow)}</Text>
                )}
                {intentSearch.classifyResult?.partyType === 'date' && <Text style={styles.intentSearchTag}>❤️ For two</Text>}
                {intentSearch.classifyResult?.partyType === 'groups' && <Text style={styles.intentSearchTag}>👨‍👩‍👧‍👦 Big group</Text>}
                {intentSearch.classifyResult?.partyType === 'friends' && <Text style={styles.intentSearchTag}>👥 Bring friends</Text>}
                {intentSearch.classifyResult?.partyType === 'solo' && <Text style={styles.intentSearchTag}>🧍 Solo</Text>}
              </View>
              {intentSearch.experience ? (
                <>
                  {(intentSearch.experience.bundles ?? []).map((bundle) => (
                    <View key={bundle.id} style={{ marginBottom: spacing.sm }}>
                      <Text style={styles.intentSearchGroupLabel}>
                        ✨ One place has it all: {bundle.componentLabels.join(' + ')}
                      </Text>
                      {renderIntentSearchResultRow(bundle)}
                    </View>
                  ))}
                  {intentSearch.experience.components.map((component) => (
                    <View key={component.key} style={{ marginBottom: spacing.sm }}>
                      <Text style={styles.intentSearchGroupLabel}>{component.label}</Text>
                      {component.items.map(renderIntentSearchResultRow)}
                    </View>
                  ))}
                </>
              ) : (
                intentSearch.items.map(renderIntentSearchResultRow)
              )}
            </View>
          )}

          {/* The dedicated Gatherings tab's own real scored/tiered list
              (unaffected by the P1 item 14 redesign above, which only
              replaces the default "All" landing view). */}
          {notableGatherings.length > 0 && (
            <Text style={styles.sectionHeader}>Recommended For You</Text>
          )}
          {notableGatherings.map(renderGatheringTile)}

          {showFlatGatheringsSection && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
              <Text style={styles.loadingCaption}>Searching gatherings…</Text>
            </>
          )}

          {showFlatGatheringsSection && isSearching && !loadingSearch && gatheringsToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              <Text style={styles.emptyTextTight}>No gatherings match "{searchQuery.trim()}".</Text>
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
                <Text style={styles.emptyActionText}>Clear Search →</Text>
              </TouchableOpacity>
            </>
          )}

          {showFlatGatheringsSection && !(isSearching && loadingSearch) && gatheringsToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              {gatheringsToShow.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${g.title}, ${g.distanceLabel}`}
                  accessibilityRole="button"
                >
                  {coverPhotoUrls[g.id] ? (
                    <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
                  ) : (
                    renderCardIcon(categoryStyleFor(g.interest_tag).icon, g.interest_tag)
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{g.title}</Text>
                    <Text style={styles.cardSubtitle}>{g.distanceLabel}</Text>
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
              ))}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('Gatherings')} accessibilityLabel="See all gatherings" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Gatherings →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showCommunities && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
              <Text style={styles.loadingCaption}>Searching communities…</Text>
            </>
          )}

          {showCommunities && isSearching && !loadingSearch && communitiesToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              <Text style={styles.emptyTextTight}>No communities match "{searchQuery.trim()}".</Text>
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
                <Text style={styles.emptyActionText}>Clear Search →</Text>
              </TouchableOpacity>
            </>
          )}

          {showCommunities && !(isSearching && loadingSearch) && communitiesToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              {communitiesToShow.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })}
                  activeOpacity={0.85}
                  accessibilityLabel={c.name}
                  accessibilityRole="button"
                >
                  {renderCardIcon('🏘️', c.interest_tag)}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {c.description ? <Text style={styles.cardSubtitle} numberOfLines={1}>{c.description}</Text> : null}
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('Communities')} accessibilityLabel="See all communities" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Communities →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showPlaces && (
            <>
              <Text style={styles.sectionHeader}>Places</Text>
              {!userLocation ? (
                <>
                  <Text style={styles.emptyTextTight}>Enable location to discover places nearby.</Text>
                  <TouchableOpacity onPress={enableLocation} accessibilityLabel="Enable location" accessibilityRole="button">
                    <Text style={styles.emptyActionText}>Enable Location →</Text>
                  </TouchableOpacity>
                </>
              ) : loadingPlaces ? (
                <View style={{ marginVertical: spacing.md }}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingCaption}>Finding places nearby…</Text>
                </View>
              ) : placesToShow.length === 0 ? (
                <>
                  <Text style={styles.emptyTextTight}>Nothing found nearby{typeFilter === 'places' ? ' in this category' : ''}.</Text>
                  {isSearching ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
                      <Text style={styles.emptyActionText}>Clear Search →</Text>
                    </TouchableOpacity>
                  ) : typeFilter === 'places' ? (
                    <TouchableOpacity onPress={() => setTypeFilter('all')} accessibilityLabel="Browse everything" accessibilityRole="button">
                      <Text style={styles.emptyActionText}>← Browse Everything</Text>
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
                        ? `Looking for "${searchQuery.trim()}" nearby`
                        : `Looking for ${PLACE_CATEGORIES.find((c) => c.key === placesCategory)?.label || 'something'} nearby`,
                    })}
                    accessibilityLabel="Ask nearby businesses"
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyActionText}>Ask Nearby Businesses →</Text>
                  </TouchableOpacity>
                </>
              ) : (
                placesToShow.map((p) => (
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
                ))
              )}
              {isAll && places.length > 0 && (
                <TouchableOpacity onPress={() => navigation.navigate('Places')} accessibilityLabel="See all places" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Places →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showPerks && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
              <Text style={styles.loadingCaption}>Searching perks…</Text>
            </>
          )}

          {showPerks && isSearching && !loadingSearch && offersToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              <Text style={styles.emptyTextTight}>No perks match "{searchQuery.trim()}".</Text>
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
                <Text style={styles.emptyActionText}>Clear Search →</Text>
              </TouchableOpacity>
            </>
          )}

          {showPerks && !(isSearching && loadingSearch) && offersToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              {offersToShow.map((o) => {
                const isRedeemed = redeemedOfferIds.has(o.id);
                return (
                  <PlaceCard
                    key={o.id}
                    icon="🎁"
                    photoUrl={o.target_interest_tag ? curatedCoverPhotoFor(o.target_interest_tag) : null}
                    tintColor={o.target_interest_tag ? categoryStyleFor(o.target_interest_tag).color : null}
                    title={o.title}
                    reason={[
                      o.brand_partners?.name,
                      businessSignalLine(o.brand_partners),
                      // Phase 8 (CLAUDE.md, Discover visual hierarchy) --
                      // names the real matched tag, not the generic shared
                      // "Matches your interests" string (o.target_interest_tag
                      // is already the actual tag value on this row).
                      o.target_interest_tag ? `Matches your ${o.target_interest_tag} interest` : null,
                    ].filter(Boolean).join(' · ')}
                    onPress={() => navigation.navigate('BrandOffers', { highlightOfferId: o.id })}
                    accessibilityLabel={`${o.title}, ${o.brand_partners?.name}, ${isRedeemed ? 'already redeemed' : 'Redeem'}`}
                    actionLabel={isRedeemed ? 'Redeemed ✓' : 'Redeem'}
                    actionIsState={isRedeemed}
                  />
                );
              })}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('BrandOffers')} accessibilityLabel="See all perks" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Perks →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Decision 5 (CLAUDE.md, Aug 27 2026): once every one of the
              three searchable sections above has genuinely come back empty
              for this term, offer the one thing Discover couldn't --
              routes the typed term through the same classifyCreateRequest()
              call Home's own intent box already uses, then lands on
              whichever real creation screen it returns, term carried
              forward as a real, editable prefill. Never auto-submitted. */}
          {nothingMatchedAnywhere && (
            <View style={styles.createItCard}>
              <Text style={styles.createItTitle}>Don't see what you're looking for?</Text>
              <Text style={styles.createItSubtitle}>Tell Nearby what you want to do.</Text>
              {/* Item 37 (context-aware primary CTA): "looking at search
                  results" with nothing real to show -- the primary action
                  is creating the thing itself, in the user's own words. */}
              <TouchableOpacity
                style={styles.createItButton}
                onPress={handleCreateItFromSearch}
                disabled={creatingFromSearch}
                accessibilityLabel="Create what you're looking for"
                accessibilityRole="button"
              >
                {creatingFromSearch ? (
                  <ActivityIndicator color={colors.surface} />
                ) : (
                  <Text style={styles.createItButtonText}>Create What You're Looking For →</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {isAll && happeningNearby.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>🔴 Happening Nearby</Text>
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

      <StoryViewerModal
        visible={!!viewerTarget}
        group={viewerTarget}
        onClose={() => {
          setViewerTarget(null);
          loadPublicStories();
        }}
      />
      <Modal visible={!!gatheringStoryViewer} animationType="slide" onRequestClose={() => setGatheringStoryViewer(null)}>
        <SafeAreaView style={styles.container}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.lg }}>
            <Text style={styles.title}>{gatheringStoryViewer?.title}</Text>
            <TouchableOpacity onPress={() => setGatheringStoryViewer(null)} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={gatheringStoryViewer?.stories ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <GatheringStoryItem story={item} colors={colors} posterLabelFallback={gatheringStoryViewer?.posterLabelFallback} />}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function GatheringStoryItem({ story, colors, posterLabelFallback }) {
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
            accessibilityLabel={`${posterLabel}'s video story`}
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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  modeToggleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  modeToggleButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5,
    borderColor: colors.border, paddingVertical: spacing.sm + 2, gap: 6,
  },
  modeToggleButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  modeToggleIcon: { fontSize: 16 },
  modeToggleText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  modeToggleTextActive: { color: colors.primary },
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
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.md,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.sm, fontSize: 14 },
  searchClear: { color: colors.textTertiary, fontSize: 16, paddingLeft: spacing.sm },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
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
  // Same "one cluster header, several lighter sub-labels underneath"
  // recipe HomeScreen.js's own "✨ Because You Like…" cluster already
  // established -- reused verbatim (Aug 30 2026 second UX critique fix)
  // so Recommended/Trending read as one grouped signal, not two
  // competing top-level sections.
  subLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.xs },
  seeAll: { color: colors.primary, fontWeight: '700', fontSize: 13, marginBottom: spacing.lg },
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
  storyRing: { alignItems: 'center', width: 64 },
  storyAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#e1306c', marginBottom: 4, backgroundColor: colors.surfaceElevated },
  storyAvatarPlaceholder: {},
  storyName: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
});
