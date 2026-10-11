import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';

// Owner item 41 (2026-10-11, approved): "Your people are doing things". Home's friends-planning line tells its story instead of
// only changing a number: the friends' faces appear one after another, then up to 3 one-line gathering chips (activity glyph +
// the plan's title) fade and rise into place under them, then the line settles. Owner decisions: the wording never says
// "nearby" (the plans are not distance-filtered); the chips are a NARROW exception to "no animated cards" for this moment
// only -- they move once, when utils/friendsPlanningMoment.js says the set of plans has something new (playKey), and are
// static otherwise (no pulse, loop or expansion). A chip opens that gathering's existing detail (onOpen); "See gatherings"
// below stays as it was. Transform/opacity only, so the Home layout never shifts. Everything is readable from the first frame
// (infoOpacity) and a chip takes a tap at once, mid-motion (item 20). No haptic. Reduce Motion = settled. Medium tier.
const T = SEQUENCES.friendsPlanning;

export default function FriendsPlanning({ people, photoUrls = {}, text, textStyle, playKey, onOpen }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const shown = (people ?? []).slice(0, T.maxPeople);
  const faces = useRef(Array.from({ length: T.maxPeople }, () => new Animated.Value(1))).current;
  const chips = useRef(Array.from({ length: T.maxPeople }, () => new Animated.Value(1))).current;
  const line = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!playKey || reduceMotion) return undefined;
    [...faces, ...chips, line].forEach((v) => v.setValue(0));
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.parallel([
      ...faces.map((v, i) => Animated.timing(v, { toValue: 1, duration: T.avatarMs, delay: i * T.staggerMs, easing: ease, useNativeDriver: true })),
      ...chips.map((v, i) => Animated.timing(v, { toValue: 1, duration: T.chipMs, delay: T.chipDelayMs + i * T.staggerMs, easing: ease, useNativeDriver: true })),
      Animated.timing(line, { toValue: 1, duration: T.lineMs, delay: T.lineDelayMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => { anim.stop(); [...faces, ...chips, line].forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, reduceMotion]);

  return (
    <View>
      {shown.length > 0 ? (
        <View style={styles.faces} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {shown.map((p, i) => (
            <Animated.View
              key={p.gatheringId}
              style={[i > 0 && styles.overlap, { opacity: infoOpacity(faces[i]), transform: [{ scale: faces[i].interpolate({ inputRange: [0, 1], outputRange: [T.fromScale, 1] }) }] }]}
            >
              {photoUrls[p.id]
                ? <Image source={{ uri: photoUrls[p.id] }} style={[styles.face, { borderColor: colors.background }]} accessibilityIgnoresInvertColors />
                : <View style={[styles.face, styles.faceEmpty, { borderColor: colors.background, backgroundColor: colors.border }]}><Ionicons name="person" size={12} color={colors.textTertiary} /></View>}
            </Animated.View>
          ))}
        </View>
      ) : null}
      {shown.filter((p) => p.title).map((p, i) => (
        <Animated.View
          key={p.gatheringId}
          style={{ opacity: infoOpacity(chips[i]), transform: [{ translateY: chips[i].interpolate({ inputRange: [0, 1], outputRange: [T.chipRise, 0] }) }] }}
        >
          <Pressable
            onPress={() => onOpen?.(p)}
            style={({ pressed }) => [styles.chip, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={p.title}
          >
            {p.tag ? <Text style={styles.chipGlyph}>{categoryStyleFor(p.tag).icon}</Text> : null}
            <Text style={[styles.chipTitle, { color: colors.textPrimary }]} numberOfLines={1}>{p.title}</Text>
          </Pressable>
        </Animated.View>
      ))}
      <Animated.Text style={[textStyle, { opacity: infoOpacity(line) }]}>{text}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faces: { flexDirection: 'row', marginBottom: spacing.xs },
  overlap: { marginLeft: -6 },
  face: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  faceEmpty: { alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs },
  chipGlyph: { fontSize: 13, marginRight: 6 },
  chipTitle: { fontSize: 14, flexShrink: 1 },
});
