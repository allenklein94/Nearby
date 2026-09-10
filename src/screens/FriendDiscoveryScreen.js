import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  isOpenToFriendDiscovery,
  setOpenToFriendDiscovery,
  getFriendDiscoveryCandidates,
  getFriendCrossedPaths,
  recordFriendDiscoverySwipe,
} from '../services/friendDiscovery';
import { getSignedPhotoUrl } from '../services/photos';
import { getOnlineStatuses } from '../services/presenceStatus';
import { getStoryPresenceForUsers } from '../services/stories';
import StoryViewerModal from '../components/StoryViewerModal';
import { calculateFriendCompatibility } from '../services/compatibility';
import { supabase } from '../services/supabase';
import FriendDiscoverySwipeCards from '../components/FriendDiscoverySwipeCards';
import FriendMatchCelebrationModal from '../components/FriendMatchCelebrationModal';
import LoadErrorState from '../components/LoadErrorState';
import { PERSONAL_INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { FRIEND_DEFAULT_ORDER, FRIEND_DEFAULT_VISIBLE } from '../constants/quickFilterCatalog';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Taxonomy audit Phase 3 (CLAUDE.md, Aug 25 2026): the 3 real distance
// buckets get_friend_discovery_candidates() already returns -- never a
// 4th invented value, matching the RPC's own vocabulary exactly.
const DISTANCE_BUCKETS = ['Nearby', 'A few miles away', 'In the wider area'];

// The one real entry point into Friend Discovery -- a completely separate
// product surface from dating discovery (own opt-in gate, own matching
// engine, own consent model -- see CLAUDE.md, never merged into Dating's
// pool). Reached from Discover's People mode.
//
// Aug 24 2026 (CLAUDE.md): this screen's own chrome used to diverge hard
// from Dating's -- registered headerShown:false in RootNavigator (forcing
// a hand-rolled back button with no title/subtitle anywhere), where Dating
// gets a real native transparent header + a persistent title/subtitle
// DiscoveryScreen.js builds itself. That divergence, not the card content
// (already comparably rich -- shared interests/communities/mutual friends,
// bio, chips), is what made this read as "a different, blank product."
// Fixed by matching Nearby's exact route registration and rebuilding this
// screen's own header to reuse DiscoveryScreen's header/headerRow/
// headerTitle/headerSubtitle style values verbatim, present across every
// render branch -- never again just a bare back arrow over nothing.
//
// Aug 24 2026 (CLAUDE.md): an optional `embedded` prop lets this screen
// mount directly inside Discover's People mode, the same real-screen-
// embedded-with-a-toggle pattern DiscoveryScreen just gained alongside it
// and MatchesScreen/FriendsScreen already have inside MessagesScreen. When
// embedded, the outer SafeAreaView is skipped (the host already has one)
// and the big "🤝 Friends" title is hidden -- the segmented Dating|Friends
// toggle one level up already names this surface. The subtitle and the
// On/Off switch both stay -- the subtitle is the one place the "separate
// from dating" boundary is actually stated, and the switch is a real,
// necessary control, not decoration.
export default function FriendDiscoveryScreen({ navigation, embedded = false }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const Container = embedded ? View : SafeAreaView;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [onlineStatuses, setOnlineStatuses] = useState({});
  // Discover UX cleanup item 8 (CLAUDE.md, 2026-09-10): same treatment as
  // DiscoveryScreen.js's own storyByUserId -- keyed by candidate id (this
  // screen's own candidates already use plain `id`, not `otherUserId`).
  const [storyByUserId, setStoryByUserId] = useState({});
  const [viewingStoryGroup, setViewingStoryGroup] = useState(null);
  const [matchModal, setMatchModal] = useState(null); // { theirName, theirPhotoUrl, matchId }
  const [togglingOn, setTogglingOn] = useState(false);
  // Taxonomy audit Phase 3: purely client-side filters over the already-
  // fetched 20-candidate batch, no RPC change -- both fields already come
  // back on every candidate row, just never exposed as a filter before.
  const [interestFilters, setInterestFilters] = useState([]);
  const [distanceFilter, setDistanceFilter] = useState(null);
  // Quick filters parity with Dating's own Verified Only/Online Now chips
  // (DiscoveryScreen.js) -- same client-side-over-the-fetched-batch
  // approach the two filters above already use, no RPC change.
  const [verifiedOnlyFilter, setVerifiedOnlyFilter] = useState(false);
  const [onlineOnlyFilter, setOnlineOnlyFilter] = useState(false);
  // Taxonomy Post-Implementation Audit remediation (CLAUDE.md, Aug 28
  // 2026), item 4: the two chip rows below used to render always-visible,
  // unlike Dating's own collapsible accordion sections
  // (DiscoveryScreen.js's accordionContainer/accordionHeader/
  // accordionChevron) -- a real UI inconsistency between two screens that
  // now sit as siblings under the same People-mode segmented toggle. Fixed
  // with a single collapsible "Filters" section reusing that same visual
  // language, deliberately smaller than Dating's own multi-section
  // accordion (one toggle, two labeled sub-rows, not two separate
  // accordion headers) -- the filter *logic* below is completely
  // unchanged, this is presentation only.
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  // Sep 6 2026 (CLAUDE.md, external UX critique item 9): real "select
  // filters, set values, reorder" parity with Dating's own Quick Filters
  // (QuickFilterCustomizeScreen, quickFilterCatalog.js) -- for Friends,
  // "set values" already happens live above (tap tags, tap a distance
  // bucket), so Customize here only needs to control which of these 4
  // sections show and in what order.
  const [quickFilterOrder, setQuickFilterOrder] = useState(FRIEND_DEFAULT_ORDER);
  const [quickFilterVisible, setQuickFilterVisible] = useState(FRIEND_DEFAULT_VISIBLE);
  // Unified Crossed Paths, step 5 (CLAUDE.md, 2026-09-10): Friends gains
  // the same Browse | Crossed Paths mode switch Dating already has --
  // this screen previously had only a single Browse-style pool
  // (getFriendDiscoveryCandidates). Browse stays the default so existing
  // behavior is unchanged for anyone who hasn't tried the new mode yet.
  const [discoveryMode, setDiscoveryMode] = useState('browse');

  // Wave 2B of the full-system acceptance audit (see
  // PRODUCT_AUDIT/ACCEPTANCE_AUDIT_PROGRESS.md) found this had zero
  // try/catch -- a network failure left the screen on its spinner
  // forever, with no error state and no retry, the exact LoadErrorState
  // gap the Aug-15 UX-cohesion pass was built to close everywhere else.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const isOn = await isOpenToFriendDiscovery();
      setEnabled(isOn);

      // Supplementary chrome (which filter sections show/their order),
      // never worth failing the whole screen over -- same non-fatal
      // convention TabHeaderActions.js and this file's own swipe-retry
      // already use.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        if (userId) {
          const { data: mine } = await supabase.from('profiles')
            .select('friend_quick_filter_order, friend_quick_filter_visible')
            .eq('id', userId).single();
          if (mine?.friend_quick_filter_order) setQuickFilterOrder(mine.friend_quick_filter_order);
          if (mine?.friend_quick_filter_visible) setQuickFilterVisible(mine.friend_quick_filter_visible);
        }
      } catch (e) {
        console.error('load friend quick filter config failed', e);
      }

      if (isOn) {
        const results = discoveryMode === 'crossedPaths'
          ? await getFriendCrossedPaths()
          : await getFriendDiscoveryCandidates(20);
        setCandidates(results);

        const urlEntries = await Promise.all(
          results.map(async (item) => {
            if (!item.photo_url) return [item.id, null];
            const url = await getSignedPhotoUrl(item.photo_url);
            return [item.id, url];
          })
        );
        setPhotoUrls(Object.fromEntries(urlEntries));
        setOnlineStatuses(results.length > 0 ? await getOnlineStatuses(results.map((item) => item.id)) : {});
        setStoryByUserId(results.length > 0 ? await getStoryPresenceForUsers(results.map((item) => item.id)) : {});
      }
      setLoadError(false);
    } catch (e) {
      console.error('FriendDiscoveryScreen load failed', e);
      setLoadError(true);
    }
    setLoading(false);
  }, [discoveryMode]);

  function switchDiscoveryMode(mode) {
    if (mode === discoveryMode) return;
    setDiscoveryMode(mode);
    // Crossed Paths candidates never carry a real distance bucket -- a
    // stale filter value from Browse would otherwise silently exclude
    // every result.
    if (mode === 'crossedPaths') setDistanceFilter(null);
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleEnable() {
    setTogglingOn(true);
    try {
      await setOpenToFriendDiscovery(true);
      await load();
    } catch (e) {
      console.error('enable friend discovery failed', e);
    } finally {
      setTogglingOn(false);
    }
  }

  async function handleDisable() {
    try {
      await setOpenToFriendDiscovery(false);
      setEnabled(false);
      setCandidates([]);
    } catch (e) {
      console.error('disable friend discovery failed', e);
    }
  }

  // Wave 2B (see PRODUCT_AUDIT/ACCEPTANCE_AUDIT_PROGRESS.md) found a real
  // failed swipe was previously invisible: FriendDiscoverySwipeCards
  // advances the deck regardless of whether onSwipe's promise resolves,
  // so a network drop mid-swipe left the user believing they'd swiped
  // (the card is gone) while the swipe was never recorded server-side --
  // worst case, a genuine mutual "like" could silently never register,
  // with no way for the user to know or retry. This can't un-animate the
  // card (the deck has already moved on), but it can tell the user
  // honestly what happened and offer a real, working retry for that same
  // person -- recordFriendDiscoverySwipe only needs their id, not their
  // still-visible position in the deck.
  async function handleSwipe(item, direction) {
    try {
      const { isMutualMatch, matchId } = await recordFriendDiscoverySwipe(item.id, direction);
      if (isMutualMatch) {
        setMatchModal({ theirName: item.display_name, theirPhotoUrl: photoUrls[item.id] || null, matchId });
      }
    } catch (e) {
      console.error('recordFriendDiscoverySwipe failed', e);
      Alert.alert(
        "Couldn't save that",
        `Your ${direction === 'like' ? 'like' : 'pass'} on ${item.display_name ?? 'this person'} didn't go through. Check your connection.`,
        [
          { text: 'Dismiss', style: 'cancel' },
          { text: 'Retry', onPress: () => handleSwipe(item, direction) },
        ]
      );
    }
  }

  function toggleInterestFilter(tag) {
    setInterestFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Same 3-line thresholds DiscoveryScreen.js's own compatibilityColor()
  // uses -- kept local rather than shared since it's just a colors lookup,
  // not real logic worth extracting into its own module.
  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  const candidatesWithScore = candidates.map((c) => ({ ...c, compatScore: calculateFriendCompatibility(c) }));

  const filteredCandidates = candidatesWithScore.filter((c) => {
    const matchesInterest = interestFilters.length === 0 || (c.interests ?? []).some((i) => interestFilters.includes(i));
    const matchesDistance = !distanceFilter || c.distance_bucket === distanceFilter;
    const matchesVerified = !verifiedOnlyFilter || c.photo_verified;
    const matchesOnline = !onlineOnlyFilter || onlineStatuses[c.id];
    return matchesInterest && matchesDistance && matchesVerified && matchesOnline;
  });
  const filtersActive = interestFilters.length > 0 || !!distanceFilter || verifiedOnlyFilter || onlineOnlyFilter;

  // Real values only, never an invented distance number -- distanceFilter
  // is already one of DISTANCE_BUCKETS' own real strings ("Nearby", "A few
  // miles away", "In the wider area"), matching this screen's own
  // established honesty convention. Shown up to 2 interest tags plus a
  // real "+N" count so the collapsed summary never grows unbounded.
  const filterSummaryParts = [
    ...interestFilters.slice(0, 2),
    ...(interestFilters.length > 2 ? [`+${interestFilters.length - 2}`] : []),
    ...(distanceFilter ? [distanceFilter] : []),
    ...(verifiedOnlyFilter ? ['Verified'] : []),
    ...(onlineOnlyFilter ? ['Online'] : []),
  ];
  const filterSummary = filterSummaryParts.length > 0 ? filterSummaryParts.join(' · ') : 'All';

  // Reused identically across every render branch below so the screen
  // never again reads as blank -- the native header (headerTransparent,
  // matching Nearby's own registration) already supplies the back
  // chevron, so this block is purely the persistent title/subtitle and,
  // once there's something to toggle, the On/Off switch -- the same
  // headerRow-right-side placement Dating uses for its own info/view-
  // toggle buttons.
  const Header = () => (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {!embedded ? (
          <Text style={styles.headerTitle} accessibilityRole="header">
            🤝 Friends
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {enabled && (
          <View style={styles.headerToggle}>
            <Text style={styles.headerToggleLabel}>On</Text>
            <Switch value={enabled} onValueChange={handleDisable} trackColor={{ true: colors.primary }} />
          </View>
        )}
      </View>
      <Text style={styles.headerSubtitle}>
        People nearby who are also here to make friends — separate from dating.
      </Text>
    </View>
  );

  if (loading) {
    return (
      <Container style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Container>
    );
  }

  if (loadError) {
    return (
      <Container style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <LoadErrorState message="Couldn't load Meet New Friends." onRetry={load} />
        </View>
      </Container>
    );
  }

  if (!enabled) {
    return (
      <Container style={styles.container}>
        <Header />
        <View style={styles.explainer}>
          <Text style={styles.explainerEmoji}>🤝</Text>
          <Text style={styles.explainerTitle}>Meet New Friends</Text>
          <Text style={styles.explainerBody}>
            Swipe to meet new people nearby who are also open to making friends. This is
            completely separate from dating — turning it on here never affects your dating
            profile or preferences, and only people who've also explicitly turned this on can
            ever show up in your deck.
          </Text>
          <TouchableOpacity
            style={styles.enableButton}
            onPress={handleEnable}
            disabled={togglingOn}
            activeOpacity={0.85}
            accessibilityLabel="Turn on Meet New Friends"
            accessibilityRole="button"
          >
            <Text style={styles.enableButtonText}>{togglingOn ? 'Turning on…' : 'Turn On'}</Text>
          </TouchableOpacity>
        </View>
      </Container>
    );
  }

  return (
    <Container style={styles.container}>
      <Header />

      {/* Unified Crossed Paths, step 5 (CLAUDE.md, 2026-09-10): same
          two-mode choice Dating's own Discover surface offers, using this
          screen's own existing filterChip visual language rather than
          inventing a new switcher control. */}
      <View style={styles.modeSwitchRow}>
        <TouchableOpacity
          style={[styles.modeSwitchButton, discoveryMode === 'browse' && styles.modeSwitchButtonActive]}
          onPress={() => switchDiscoveryMode('browse')}
          accessibilityLabel="Browse — a wider pool matching your filters"
          accessibilityRole="button"
          accessibilityState={{ selected: discoveryMode === 'browse' }}
        >
          <Text style={[styles.modeSwitchText, discoveryMode === 'browse' && styles.modeSwitchTextActive]}>🔎 Browse</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeSwitchButton, discoveryMode === 'crossedPaths' && styles.modeSwitchButtonActive]}
          onPress={() => switchDiscoveryMode('crossedPaths')}
          accessibilityLabel="Crossed Paths — people you've actually crossed paths with or shared a gathering with"
          accessibilityRole="button"
          accessibilityState={{ selected: discoveryMode === 'crossedPaths' }}
        >
          <Text style={[styles.modeSwitchText, discoveryMode === 'crossedPaths' && styles.modeSwitchTextActive]}>📍 Crossed Paths</Text>
        </TouchableOpacity>
      </View>

      {candidates.length > 0 && (
        <View style={styles.accordionContainer}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setFiltersExpanded((prev) => !prev)}
            accessibilityLabel="Filters"
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersExpanded }}
          >
            <Text style={styles.accordionHeaderLabel}>Filters</Text>
            <View style={styles.accordionHeaderRight}>
              <Text style={styles.accordionHeaderValue}>{filterSummary}</Text>
              <Text style={styles.accordionChevron}>{filtersExpanded ? '⌃' : '⌄'}</Text>
            </View>
          </TouchableOpacity>
          {filtersExpanded && (
            <View style={styles.accordionBody}>
              {quickFilterOrder.filter((key) => quickFilterVisible.includes(key)).map((key) => {
                if (key === 'interests') {
                  return (
                    <View key={key}>
                      <Text style={styles.accordionSubLabel}>Interests</Text>
                      <View style={styles.filterChipRow}>
                        {PERSONAL_INTEREST_OPTIONS.map((tag) => {
                          const selected = interestFilters.includes(tag);
                          return (
                            <TouchableOpacity
                              key={tag}
                              style={[styles.filterChip, selected && styles.filterChipActive]}
                              onPress={() => toggleInterestFilter(tag)}
                              accessibilityLabel={tag}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{tag}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                if (key === 'distance') {
                  // Crossed Paths candidates never carry a real distance
                  // bucket (they come from proximity/gathering signals,
                  // not the wide_area grid Browse's own RPC buckets) --
                  // showing this filter there would just filter
                  // everything out against a value that's always null.
                  if (discoveryMode === 'crossedPaths') return null;
                  return (
                    <View key={key} style={{ marginTop: spacing.sm }}>
                      <Text style={styles.accordionSubLabel}>Distance</Text>
                      <View style={styles.filterChipRow}>
                        {DISTANCE_BUCKETS.map((bucket) => {
                          const selected = distanceFilter === bucket;
                          return (
                            <TouchableOpacity
                              key={bucket}
                              style={[styles.filterChip, selected && styles.filterChipActive]}
                              onPress={() => setDistanceFilter(selected ? null : bucket)}
                              accessibilityLabel={bucket}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{bucket}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                if (key === 'verified') {
                  return (
                    <View key={key} style={{ marginTop: spacing.sm }}>
                      <Text style={styles.accordionSubLabel}>Verified</Text>
                      <View style={styles.filterChipRow}>
                        <TouchableOpacity
                          style={[styles.filterChip, verifiedOnlyFilter && styles.filterChipActive]}
                          onPress={() => setVerifiedOnlyFilter((prev) => !prev)}
                          accessibilityLabel="Verified Only"
                          accessibilityRole="button"
                          accessibilityState={{ selected: verifiedOnlyFilter }}
                        >
                          <Text style={[styles.filterChipText, verifiedOnlyFilter && styles.filterChipTextActive]}>Verified Only</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }
                if (key === 'online') {
                  return (
                    <View key={key} style={{ marginTop: spacing.sm }}>
                      <Text style={styles.accordionSubLabel}>Online</Text>
                      <View style={styles.filterChipRow}>
                        <TouchableOpacity
                          style={[styles.filterChip, onlineOnlyFilter && styles.filterChipActive]}
                          onPress={() => setOnlineOnlyFilter((prev) => !prev)}
                          accessibilityLabel="Online Now"
                          accessibilityRole="button"
                          accessibilityState={{ selected: onlineOnlyFilter }}
                        >
                          <Text style={[styles.filterChipText, onlineOnlyFilter && styles.filterChipTextActive]}>Online Now</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }
                return null;
              })}
              <TouchableOpacity
                onPress={() => navigation.navigate('QuickFilterCustomize', { mode: 'friends' })}
                accessibilityLabel="Customize which filters show and their order"
                accessibilityRole="button"
                style={{ marginTop: spacing.md }}
              >
                <Text style={styles.customizeLink}>⚙️ Customize</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {filtersActive && filteredCandidates.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.explainerBody}>
            No one nearby matches these filters right now — try widening them.
          </Text>
        </View>
      ) : (
        <FriendDiscoverySwipeCards
          data={filteredCandidates}
          photoUrls={photoUrls}
          onlineStatuses={onlineStatuses}
          storyByUserId={storyByUserId}
          onViewStory={setViewingStoryGroup}
          compatibilityColor={compatibilityColor}
          onSwipe={handleSwipe}
        />
      )}

      <FriendMatchCelebrationModal
        visible={!!matchModal}
        theirName={matchModal?.theirName}
        theirPhotoUrl={matchModal?.theirPhotoUrl}
        onSayHi={() => {
          const matchId = matchModal?.matchId;
          setMatchModal(null);
          if (matchId) navigation.navigate('Chat', { matchId });
        }}
        onDismiss={() => setMatchModal(null)}
      />

      <StoryViewerModal
        visible={!!viewingStoryGroup}
        group={viewingStoryGroup}
        onClose={() => setViewingStoryGroup(null)}
      />
    </Container>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // Same values as DiscoveryScreen.js's own header/headerRow/headerTitle/
  // headerSubtitle -- reused verbatim, not approximated, so the two
  // screens' chrome is genuinely identical, not just similar.
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  headerToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerToggleLabel: { ...typography.small, color: colors.textTertiary },
  // Unified Crossed Paths, step 5: same two-button switcher shape used
  // elsewhere in this app for a binary mode choice, built from this
  // screen's own filterChip/filterChipActive tokens rather than a new
  // visual language.
  modeSwitchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  modeSwitchButton: {
    flex: 1, alignItems: 'center', borderRadius: radius.full, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  modeSwitchButtonActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  modeSwitchText: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  modeSwitchTextActive: { color: colors.primary },
  // Taxonomy Post-Implementation Audit remediation (CLAUDE.md, Aug 28
  // 2026), item 4: values copied verbatim from DiscoveryScreen.js's own
  // accordionContainer/accordionHeader/accordionHeaderLabel/
  // accordionHeaderRight/accordionHeaderValue/accordionChevron/
  // accordionBody -- the same visual language, not a new one invented for
  // this screen. accordionSubLabel is new (Dating's own accordion never
  // needed a label *inside* a section body since each of its sections is
  // single-purpose; Friends' one section holds two, so it needs one).
  accordionContainer: {
    marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  accordionHeaderLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  accordionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  accordionHeaderValue: { color: colors.textTertiary, fontSize: 13 },
  accordionChevron: { color: colors.textTertiary, fontSize: 14 },
  accordionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  accordionSubLabel: { ...typography.small, color: colors.textTertiary, fontWeight: '600', marginBottom: spacing.xs },
  filterChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  filterChip: { borderRadius: radius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  filterChipText: { ...typography.small, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary, fontWeight: '600' },
  customizeLink: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  explainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  explainerEmoji: { fontSize: 48, marginBottom: spacing.md },
  explainerTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.sm },
  explainerBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  enableButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl, ...shadow.button,
  },
  enableButtonText: { color: '#fff', ...typography.body, fontWeight: '700' },
});
