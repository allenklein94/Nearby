import React, { useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;

function formatCrossedPathsTime(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMins = Math.floor((Date.now() - then.getTime()) / (1000 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return null;
}

// A genuinely optional alternative to the list view — swipe right to
// send a Notice, swipe left to move on with no action taken. Wave
// stays as an explicit button rather than a swipe direction, since
// it's premium-limited and shouldn't be triggerable by accident.
export default function SwipeableDiscoveryCards({
  data, photoUrls, onlineStatuses, onNotice, onWave, onViewProfile, onReport, compatibilityColor,
}) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [currentIndex, setCurrentIndex] = useState(0);
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
    position.setValue({ x: 0, y: 0 });
    setCurrentIndex((prev) => prev + 1);
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
  const crossedPathsTime = formatCrossedPathsTime(item.last_seen_at);

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
        <TouchableOpacity activeOpacity={0.95} onPress={() => onViewProfile(item.otherUserId)}>
          <Image source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }} style={styles.avatar} />
          {onlineStatuses[item.otherUserId] && <View style={styles.onlineDot} />}

          <Animated.View style={[styles.stampLike, { opacity: likeOpacity }]}>
            <Text style={styles.stampLikeText}>NOTICE</Text>
          </Animated.View>
          <Animated.View style={[styles.stampSkip, { opacity: skipOpacity }]}>
            <Text style={styles.stampSkipText}>SKIP</Text>
          </Animated.View>
        </TouchableOpacity>

        <View style={styles.cardBody}>
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
            📍 Within about 35 feet{crossedPathsTime ? ` · ${crossedPathsTime}` : ''}
          </Text>
          <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
        </View>
      </Animated.View>

      <View style={styles.buttonRow}>
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