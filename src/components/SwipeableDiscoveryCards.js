import React, { useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { formatCrossedPathsTimeShort, gatheringReasonText } from '../services/crossedPathsSignals';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;

// A genuinely optional alternative to the list view — swipe right to
// send a Notice, swipe left to move on with no action taken. Wave
// stays as an explicit button rather than a swipe direction, since
// it's premium-limited and shouldn't be triggerable by accident.
//
// `discoveryMode` (CLAUDE.md, 2026-09-10 fix): previously this card
// showed a hardcoded "📍 Within about 35 feet" line unconditionally,
// even when the data passed in was actually Browse-mode data (no real
// proximity signal at all) -- a fabricated-signal bug. Now branches the
// same way the list view (DiscoveryScreen.js) already does: Browse mode
// shows "🔎 Matches your filters", Crossed Paths mode shows the real
// per-candidate reason (shared gathering attendance when it exists,
// proximity sighting otherwise) -- never both, never a guess.
export default function SwipeableDiscoveryCards({
  data, photoUrls, onlineStatuses, storyByUserId = {}, onViewStory, onNotice, onWave, onViewProfile, onReport, compatibilityColor, onNeedMore, discoveryMode = 'crossedPaths',
}) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastSkippedIndex, setLastSkippedIndex] = useState(null);
  const position = useRef(new Animated.ValueXY()).current;
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-8deg', '0deg', '8deg'],
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
      onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          forceSwipe('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          forceSwipe('left');
        } else {
          Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  function forceSwipe(direction) {
    const x = direction === 'right' ? SCREEN_WIDTH * 1.2 : -SCREEN_WIDTH * 1.2;
    Haptics.impactAsync(direction === 'right' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(position, { toValue: { x, y: 0 }, duration: 220, useNativeDriver: false }).start(() => {
      onSwipeComplete(direction);
    });
  }

  function onSwipeComplete(direction) {
    const item = data[currentIndex];
    if (direction === 'right' && item) {
      onNotice(item.otherUserId);
    }
    // Skipping never persists anything server-side — so rewinding is
    // just moving the local index back, nothing to undo remotely.
    if (direction === 'left') {
      setLastSkippedIndex(currentIndex);
    } else {
      setLastSkippedIndex(null);
    }
    position.setValue({ x: 0, y: 0 });
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);

    // Request more results once only a few cards remain, so the
    // stack rarely actually runs dry mid-swipe.
    if (onNeedMore && data.length - nextIndex <= 3) {
      onNeedMore();
    }
  }

  function handleRewind() {
    if (lastSkippedIndex === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCurrentIndex(lastSkippedIndex);
    setLastSkippedIndex(null);
  }

  function handleButtonSkip() {
    forceSwipe('left');
  }

  function handleButtonNotice() {
    forceSwipe('right');
  }

  if (currentIndex >= data.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>📍</Text>
        <Text style={styles.emptyText}>That's everyone for now — check back soon.</Text>
      </View>
    );
  }

  const item = data[currentIndex];
  const nextItem = data[currentIndex + 1];
  const crossedPathsTime = formatCrossedPathsTimeShort(item.last_seen_at);
  const gatheringText = discoveryMode === 'browse' ? null : gatheringReasonText(item.crossedPathsReason);
  const storyGroup = storyByUserId[item.otherUserId] ?? null;

  const cardStyle = {
    transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }],
  };

  const likeOpacity = position.x.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const skipOpacity = position.x.interpolate({ inputRange: [-SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.stackContainer}>
      {nextItem && (
        <View style={[styles.card, styles.cardBehind]}>
          <Image source={{ uri: photoUrls[nextItem.id] || 'https://placehold.co/200' }} style={styles.avatar} />
        </View>
      )}

      <Animated.View style={[styles.card, cardStyle]} {...panResponder.panHandlers}>
        {/* Discover UX cleanup item 8: the avatar is the real story
            affordance -- a ring when a visible (in practice, public)
            story exists, tapping it opens that story directly instead of
            the profile. No story, no ring: today's existing "tap opens
            profile" behavior, unchanged. Profile is still one tap away
            below via cardBody regardless of story presence. */}
        <TouchableOpacity
          activeOpacity={0.95}
          onPress={() => (storyGroup ? onViewStory(storyGroup) : onViewProfile(item.otherUserId))}
          accessibilityLabel={storyGroup ? `View ${item.profiles?.display_name}'s story` : `View ${item.profiles?.display_name}'s profile`}
          accessibilityRole="button"
        >
          <Image
            source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }}
            style={[styles.avatar, storyGroup && (storyGroup.hasUnviewed ? styles.avatarRingUnviewed : styles.avatarRingViewed)]}
          />
          {onlineStatuses[item.otherUserId] && <View style={styles.onlineDot} />}

          <Animated.View style={[styles.stampLike, { opacity: likeOpacity }]}>
            <Text style={styles.stampLikeText}>NOTICE</Text>
          </Animated.View>
          <Animated.View style={[styles.stampSkip, { opacity: skipOpacity }]}>
            <Text style={styles.stampSkipText}>SKIP</Text>
          </Animated.View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cardBody}
          activeOpacity={0.95}
          onPress={() => onViewProfile(item.otherUserId)}
          accessibilityLabel={`View ${item.profiles?.display_name}'s profile`}
          accessibilityRole="button"
        >
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.profiles?.display_name}</Text>
            {item.profiles?.photo_verified && <Text style={styles.verifiedBadge}>✓</Text>}
            {item.compatibilityScore !== null && (
              <View style={[styles.compatBadge, { borderColor: compatibilityColor(item.compatibilityScore) }]}>
                <Text style={[styles.compatText, { color: compatibilityColor(item.compatibilityScore) }]}>{item.compatibilityScore}%</Text>
              </View>
            )}
          </View>
          <Text style={styles.proximityText}>
            {discoveryMode === 'browse'
              ? '🔎 Matches your filters'
              : gatheringText
                ? `🗓️ ${gatheringText}`
                : `📍 Within about 35 feet${crossedPathsTime ? ` · ${crossedPathsTime}` : ''}`}
          </Text>
          <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
        </TouchableOpacity>
      </Animated.View>

      <View style={styles.buttonRow}>
        {lastSkippedIndex !== null && (
          <TouchableOpacity
            style={styles.rewindButton}
            onPress={handleRewind}
            accessibilityLabel="Rewind to the person you just skipped"
            accessibilityRole="button"
          >
            <Text style={styles.rewindButtonText}>↺</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleButtonSkip}
          accessibilityLabel={`Skip ${item.profiles?.display_name}`}
          accessibilityRole="button"
        >
          <Text style={styles.skipButtonText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.waveButton}
          onPress={() => onWave(item.otherUserId)}
          accessibilityLabel={`Send a Wave to ${item.profiles?.display_name}`}
          accessibilityRole="button"
        >
          <Text style={styles.waveButtonText}>👋</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.noticeButton}
          onPress={handleButtonNotice}
          accessibilityLabel={`Send a Notice to ${item.profiles?.display_name}`}
          accessibilityRole="button"
        >
          <Text style={styles.noticeButtonText}>♡</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  stackContainer: { flex: 1, alignItems: 'center', paddingTop: spacing.md },
  card: {
    position: 'absolute', top: 0, width: SCREEN_WIDTH - spacing.lg * 2,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', ...shadow.card,
  },
  cardBehind: { top: 8, opacity: 0.6, transform: [{ scale: 0.96 }] },
  avatar: { width: '100%', height: 420, backgroundColor: colors.surfaceElevated },
  avatarRingUnviewed: { borderWidth: 2.5, borderColor: colors.textPrimary },
  avatarRingViewed: { borderWidth: 2.5, borderColor: colors.border },
  onlineDot: {
    position: 'absolute', top: spacing.md, right: spacing.md,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.success, borderWidth: 2.5, borderColor: colors.surface,
  },
  stampLike: {
    position: 'absolute', top: 40, left: 24, borderWidth: 3, borderColor: colors.success,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, transform: [{ rotate: '-15deg' }],
  },
  stampLikeText: { color: colors.success, fontWeight: '800', fontSize: 20, letterSpacing: 1 },
  stampSkip: {
    position: 'absolute', top: 40, right: 24, borderWidth: 3, borderColor: colors.danger,
    borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, transform: [{ rotate: '15deg' }],
  },
  stampSkipText: { color: colors.danger, fontWeight: '800', fontSize: 20, letterSpacing: 1 },
  cardBody: { padding: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  name: { ...typography.headline, color: colors.textPrimary },
  verifiedBadge: { color: colors.success, fontSize: 16, fontWeight: '700' },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontSize: 11, fontWeight: '700' },
  proximityText: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.sm },
  bio: { ...typography.body, color: colors.textSecondary },
  buttonRow: {
    position: 'absolute', bottom: spacing.xl, flexDirection: 'row', gap: spacing.lg, alignItems: 'center',
  },
  rewindButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: '#f59e0b', justifyContent: 'center', alignItems: 'center', ...shadow.card,
  },
  rewindButtonText: { color: '#f59e0b', fontSize: 22, fontWeight: '700' },
  skipButton: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', ...shadow.card,
  },
  skipButtonText: { color: colors.textTertiary, fontSize: 22, fontWeight: '700' },
  waveButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.primary, justifyContent: 'center', alignItems: 'center', ...shadow.card,
  },
  waveButtonText: { fontSize: 18 },
  noticeButton: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', ...shadow.button,
  },
  noticeButtonText: { color: '#fff', fontSize: 28 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
});