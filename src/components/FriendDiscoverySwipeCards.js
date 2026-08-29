import React, { useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
// P1 item 4 (CLAUDE.md, Aug 28 Full Coherence Audit): the same shared
// recommendation-reason vocabulary Best Pick/Nearby Right Now/Ask
// Nearby already use, tagging this card's own real shared-context bits
// (never a new invented signal -- the three counts below already came
// from get_friend_discovery_candidates()) so the leading icon matches
// the same category glyph wherever that category appears app-wide.
import { REASON_CATEGORIES, REASON_CATEGORY_ICONS } from '../constants/recommendationReasonVocabulary';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;

// Friend Discovery's own card -- shares SwipeableDiscoveryCards' swipe
// mechanics (PanResponder threshold, animated stamps, a two-deep stack)
// but deliberately not the same component: the card answers "would I
// want this person as a friend?", so it surfaces interests/communities/
// mutual-friends/bio, never a dating-oriented proximity/compatibility
// readout. Distance is a coarse bucket from the RPC (never exact miles),
// matching the locked "no location-discovery tool" decision.
export default function FriendDiscoverySwipeCards({ data, photoUrls, onSwipe }) {
  const { colors, shadow } = useTheme();
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
      const item = data[currentIndex];
      position.setValue({ x: 0, y: 0 });
      setCurrentIndex((i) => i + 1);
      if (item) onSwipe(item, direction === 'right' ? 'like' : 'pass');
    });
  }

  if (!data.length || currentIndex >= data.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>🤝</Text>
        <Text style={styles.emptyText}>No one nearby has friend discovery on right now — check back later.</Text>
      </View>
    );
  }

  const item = data[currentIndex];
  const nextItem = data[currentIndex + 1];
  const cardStyle = { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] };
  const likeOpacity = position.x.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const skipOpacity = position.x.interpolate({ inputRange: [-SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  // Tagged with the same shared vocabulary Best Pick/Nearby Right Now/
  // Ask Nearby already use -- the joined line stays one compact string
  // (this card has no room for a stacked reason-per-line layout the way
  // GatheringDetailScreen/HomeScreen's Best Pick do), but its one leading
  // icon reflects the strongest real signal present, in the same
  // priority order these three checks already ran in.
  const sharedBits = [];
  if (item.shared_interest_count > 0) {
    sharedBits.push({ text: `${item.shared_interest_count} interest${item.shared_interest_count === 1 ? '' : 's'} in common`, category: REASON_CATEGORIES.INTEREST });
  }
  if (item.shared_community_count > 0) {
    sharedBits.push({ text: `in ${item.shared_community_count} of your communities`, category: REASON_CATEGORIES.CONTEXT });
  }
  if (item.mutual_friend_count > 0) {
    sharedBits.push({ text: `${item.mutual_friend_count} mutual friend${item.mutual_friend_count === 1 ? '' : 's'}`, category: REASON_CATEGORIES.CONTEXT });
  }

  return (
    <View style={styles.stackContainer}>
      {nextItem && (
        <View style={[styles.card, styles.cardBehind]}>
          <Image source={{ uri: photoUrls[nextItem.id] || 'https://placehold.co/200' }} style={styles.avatar} />
        </View>
      )}

      <Animated.View style={[styles.card, cardStyle]} {...panResponder.panHandlers}>
        <Image source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }} style={styles.avatar} />
        <Animated.View style={[styles.stampLike, { opacity: likeOpacity }]}>
          <Text style={styles.stampLikeText}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[styles.stampSkip, { opacity: skipOpacity }]}>
          <Text style={styles.stampSkipText}>PASS</Text>
        </Animated.View>

        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.display_name}</Text>
            {item.distance_bucket && <Text style={styles.distance}>{item.distance_bucket}</Text>}
          </View>
          {sharedBits.length > 0 && (
            <View style={styles.sharedRow}>
              <Ionicons
                name={REASON_CATEGORY_ICONS[sharedBits[0].category]}
                size={13}
                color={colors.primary}
                style={styles.sharedIcon}
              />
              <Text style={styles.sharedText}>{sharedBits.map((b) => b.text).join(' · ')}</Text>
            </View>
          )}
          {item.bio ? <Text style={styles.bio} numberOfLines={3}>{item.bio}</Text> : null}
          {item.interests?.length > 0 && (
            <View style={styles.chipsWrap}>
              {item.interests.slice(0, 6).map((tag) => (
                <View key={tag} style={styles.chip}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Animated.View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => forceSwipe('left')}
          accessibilityLabel={`Pass on ${item.display_name}`}
          accessibilityRole="button"
        >
          <Text style={styles.skipButtonText}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.likeButton}
          onPress={() => forceSwipe('right')}
          accessibilityLabel={`Like ${item.display_name} as a potential friend`}
          accessibilityRole="button"
        >
          <Text style={styles.likeButtonText}>🤝</Text>
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
  avatar: { width: '100%', height: 340, backgroundColor: colors.surfaceElevated },
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
  distance: { ...typography.small, color: colors.textTertiary },
  // sharedText itself keeps its own marginBottom -- sharedRow adds no
  // margin of its own, matching ReasonList.js's own "don't double the
  // gap" convention.
  sharedRow: { flexDirection: 'row', alignItems: 'center' },
  sharedIcon: { marginRight: 4 },
  sharedText: { ...typography.small, color: colors.primary, fontWeight: '600', marginBottom: spacing.xs },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  chipText: { ...typography.small, color: colors.textSecondary },
  buttonRow: { position: 'absolute', bottom: spacing.xl, flexDirection: 'row', gap: spacing.xl, alignItems: 'center' },
  skipButton: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', ...shadow.card,
  },
  skipButtonText: { color: colors.textTertiary, fontSize: 24, fontWeight: '700' },
  likeButton: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', ...shadow.button,
  },
  likeButtonText: { fontSize: 28 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
});
