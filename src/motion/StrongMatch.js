import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { translate } from '../i18n/translate';
import { categoryName } from '../i18n/categoryNames';
import { displayWhen, displayDistance } from '../i18n/display';

// Owner item 37 (2026-10-11): the strong-match moment on the top result of the person's own typed ask (utils/strongMatch.js
// decides IF; this only shows it). The pieces of the ask that really matched line up one after another, each ticking ✓
// (activity, time, place), then "✨ A strong match for you" settles: the "Your intent -> Activity -> Time -> Location -> Strong
// match" idea, in one small block where the Nearby Pick badge would be. Plays once when the results arrive (a real event: the
// answer to the person's own ask), medium tier. Information is readable from the first frame (infoOpacity, item 19); only the
// ✓ marks and the badge's scale start from nothing. Takes no touches (the row's tap acts at once). No haptic. Reduce Motion =
// the settled block. Same component on Home and Discover.
const T = SEQUENCES.strongMatch;

export default function StrongMatch({ pieces, language, playKey }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const steps = useRef(T.pieces.map(() => new Animated.Value(reduceMotion ? 1 : 0))).current;
  const badge = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) { steps.forEach((v) => v.setValue(1)); badge.setValue(1); return undefined; }
    steps.forEach((v) => v.setValue(0));
    badge.setValue(0);
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.parallel([
      ...steps.map((v, i) => Animated.timing(v, { toValue: 1, duration: T.pieceMs, delay: i * T.staggerMs, easing: ease, useNativeDriver: true })),
      Animated.timing(badge, { toValue: 1, duration: T.badgeMs, delay: T.badgeDelayMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => { anim.stop(); steps.forEach((v) => v.setValue(1)); badge.setValue(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, reduceMotion]);

  if (!Array.isArray(pieces) || pieces.length !== T.pieces.length) return null;
  const styles = getStyles(colors);
  const label = (p) => (p.key === 'activity' ? categoryName(p.value, language) : p.key === 'time' ? displayWhen(p.value, language) : displayDistance(p.value, language));

  return (
    <View pointerEvents="none" style={styles.block}>
      <View style={styles.pieces}>
        {pieces.map((p, i) => (
          <Animated.View key={p.key} style={[styles.piece, { opacity: infoOpacity(steps[i]) }]}>
            <Text style={styles.pieceText} numberOfLines={1}>{label(p)}</Text>
            <Animated.Text style={[styles.tick, { opacity: steps[i], transform: [{ scale: steps[i] }] }]}> ✓</Animated.Text>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[styles.badge, { opacity: infoOpacity(badge), transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [T.badgeFromScale, 1] }) }] }]}>
        <Text style={styles.badgeText}>✨ {translate(language, 'vocab.confidence.high')}</Text>
      </Animated.View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  block: { marginBottom: 2 },
  pieces: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 2 },
  piece: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm },
  pieceText: { ...typography.caption, color: colors.textSecondary },
  tick: { ...typography.caption, color: colors.success, fontWeight: '700' },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
