import React, { useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import EmptyCopy from './EmptyCopy';
import { View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import FriendCandidateDetails, { DISTANCE_BUCKET_KEYS } from './FriendCandidateDetails';
import FriendDecisionButtons from './FriendDecisionButtons';
import { FRIEND_DECISIONS } from '../utils/friendDiscoveryView';

import { MOTION_BUDGET, SEQUENCES, AMBIENT } from '../motion/motionBudget';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
export { DISTANCE_BUCKET_KEYS };

// The empty state both Friends modes share (list and deck): a real next action, not a dead end -- the same InviteFriends
// destination every other empty state routes to (Thursday plan item 25).
export function FriendDiscoveryEmpty({ navigation }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>🤝</Text>
      <EmptyCopy id="friend_discovery_empty" />
      {navigation && (
        <TouchableOpacity
          onPress={() => navigation.navigate('InviteFriends')}
          accessibilityLabel={t('ui.friends.inviteFriendsA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyActionText}>{t('ui.friends.inviteFriends')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Friend Discovery's OPTIONAL deck (owner idea 156: the list is the default; this mode is the person's own choice). Shares
// SwipeableDiscoveryCards' swipe mechanics (PanResponder threshold, animated stamps, a two-deep stack) but not the same
// component: the card answers "would I want this person as a friend?" (FriendCandidateDetails, the same card the list shows).
// It always shows data[0]: the screen removes a decided person (undecidedCandidates), so a failed write puts them back on
// top and a person decided in the list never reappears here. Swiping is optional: the labelled Pass / Connect buttons do
// exactly what the swipe does (FriendDecisionButtons, FRIEND_DECISIONS).
export default function FriendDiscoverySwipeCards({ data, photoUrls, onlineStatuses = {}, storyByUserId = {}, onViewStory, compatibilityColor, onSwipe, navigation }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const position = useRef(new Animated.ValueXY()).current;
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
    outputRange: ['-8deg', '0deg', '8deg'],
  });
  // The pan handler is created once (a closure from the first render); it reads the current top card and the current
  // onSwipe through refs, so a swipe always decides the person on screen.
  const topRef = useRef(null);
  topRef.current = data[0] ?? null;
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

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
    const item = topRef.current;
    Animated.timing(position, { toValue: { x, y: 0 }, duration: MOTION_BUDGET.small.ms, useNativeDriver: false }).start(() => {
      position.setValue({ x: 0, y: 0 });
      if (item) onSwipeRef.current(item, direction === 'right' ? FRIEND_DECISIONS.connect.direction : FRIEND_DECISIONS.pass.direction);
    });
  }

  if (!data.length) return <FriendDiscoveryEmpty navigation={navigation} />;

  const item = data[0];
  const nextItem = data[1];
  const storyGroup = storyByUserId[item.id] ?? null;
  const cardStyle = { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] };
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
        {/* Discover UX cleanup item 8 (CLAUDE.md, 2026-09-10): this deck
            has no "view profile" tap at all today -- adding one is a
            separate product decision, out of scope here. Only a story ring
            + tap-to-view when a visible (in practice, public) story exists. */}
        {storyGroup ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onViewStory(storyGroup)}
            accessibilityLabel={t('ui.friends.viewSStoryA11y', { name: item.display_name })}
            accessibilityRole="button"
          >
            <Image
              source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }}
              style={[styles.avatar, storyGroup.hasUnviewed ? styles.avatarRingUnviewed : styles.avatarRingViewed]}
            />
          </TouchableOpacity>
        ) : (
          <Image source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }} style={styles.avatar} />
        )}
        {onlineStatuses[item.id] && <View style={styles.onlineDot} />}
        <Animated.View style={[styles.stampLike, { opacity: likeOpacity }]}>
          <Text style={styles.stampLikeText}>{t(FRIEND_DECISIONS.connect.labelKey)}</Text>
        </Animated.View>
        <Animated.View style={[styles.stampSkip, { opacity: skipOpacity }]}>
          <Text style={styles.stampSkipText}>{t(FRIEND_DECISIONS.pass.labelKey)}</Text>
        </Animated.View>

        <View style={styles.cardBody}>
          <FriendCandidateDetails item={item} compatibilityColor={compatibilityColor} />
        </View>
      </Animated.View>

      <View style={styles.buttonRow}>
        <FriendDecisionButtons
          name={item.display_name}
          onDecide={(direction) => forceSwipe(direction === FRIEND_DECISIONS.connect.direction ? 'right' : 'left')}
        />
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
  avatarRingUnviewed: { borderWidth: 2.5, borderColor: colors.textPrimary },
  avatarRingViewed: { borderWidth: 2.5, borderColor: colors.border },
  // Same treatment as SwipeableDiscoveryCards.js's own onlineDot -- values
  // copied verbatim so the two surfaces read as the same product.
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
  buttonRow: { position: 'absolute', bottom: spacing.xl, flexDirection: 'row', gap: spacing.xl, alignItems: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyActionText: { ...typography.body, color: colors.primary, fontWeight: '700', marginTop: spacing.md },
});
