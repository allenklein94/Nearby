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
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

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
export default function FriendDiscoveryScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [matchModal, setMatchModal] = useState(null); // { theirName, theirPhotoUrl, matchId }
  const [togglingOn, setTogglingOn] = useState(false);

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
        <Text style={styles.headerTitle} accessibilityRole="header">
          🤝 Friends
        </Text>
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
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <LoadErrorState message="Couldn't load Meet New Friends." onRetry={load} />
        </View>
      </SafeAreaView>
    );
  }

  if (!enabled) {
    return (
      <SafeAreaView style={styles.container}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header />

      <FriendDiscoverySwipeCards data={candidates} photoUrls={photoUrls} onSwipe={handleSwipe} />

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
    </SafeAreaView>
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
