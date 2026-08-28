import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Switch, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  isOpenToFriendDiscovery,
  setOpenToFriendDiscovery,
  getFriendDiscoveryCandidates,
  recordFriendDiscoverySwipe,
} from '../services/friendDiscovery';
import { getSignedPhotoUrl } from '../services/photos';
import FriendDiscoverySwipeCards from '../components/FriendDiscoverySwipeCards';
import FriendMatchCelebrationModal from '../components/FriendMatchCelebrationModal';
import LoadErrorState from '../components/LoadErrorState';
import { PERSONAL_INTEREST_OPTIONS } from '../constants/gatheringCategories';
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
  const [matchModal, setMatchModal] = useState(null); // { theirName, theirPhotoUrl, matchId }
  const [togglingOn, setTogglingOn] = useState(false);
  // Taxonomy audit Phase 3: purely client-side filters over the already-
  // fetched 20-candidate batch, no RPC change -- both fields already come
  // back on every candidate row, just never exposed as a filter before.
  const [interestFilters, setInterestFilters] = useState([]);
  const [distanceFilter, setDistanceFilter] = useState(null);
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

      if (isOn) {
        const results = await getFriendDiscoveryCandidates(20);
        setCandidates(results);

        const urlEntries = await Promise.all(
          results.map(async (item) => {
            if (!item.photo_url) return [item.id, null];
            const url = await getSignedPhotoUrl(item.photo_url);
            return [item.id, url];
          })
        );
        setPhotoUrls(Object.fromEntries(urlEntries));
      }
      setLoadError(false);
    } catch (e) {
      console.error('FriendDiscoveryScreen load failed', e);
      setLoadError(true);
    }
    setLoading(false);
  }, []);

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

  const filteredCandidates = candidates.filter((c) => {
    const matchesInterest = interestFilters.length === 0 || (c.interests ?? []).some((i) => interestFilters.includes(i));
    const matchesDistance = !distanceFilter || c.distance_bucket === distanceFilter;
    return matchesInterest && matchesDistance;
  });
  const filtersActive = interestFilters.length > 0 || !!distanceFilter;

  // Real values only, never an invented distance number -- distanceFilter
  // is already one of DISTANCE_BUCKETS' own real strings ("Nearby", "A few
  // miles away", "In the wider area"), matching this screen's own
  // established honesty convention. Shown up to 2 interest tags plus a
  // real "+N" count so the collapsed summary never grows unbounded.
  const filterSummaryParts = [
    ...interestFilters.slice(0, 2),
    ...(interestFilters.length > 2 ? [`+${interestFilters.length - 2}`] : []),
    ...(distanceFilter ? [distanceFilter] : []),
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
              <Text style={[styles.accordionSubLabel, { marginTop: spacing.sm }]}>Distance</Text>
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
        <FriendDiscoverySwipeCards data={filteredCandidates} photoUrls={photoUrls} onSwipe={handleSwipe} />
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
