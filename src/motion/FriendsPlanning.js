import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';

// Owner item 41 (2026-10-11): "Your people are doing things". Home's friends-planning line tells its story instead of only
// changing a number: the friends' faces appear one after another, each plan's activity glyph lands on its face (the plans,
// shown as small marks, not extra cards: Home never expands in place), then the line settles. Plays only when
// utils/friendsPlanningMoment.js says the set of plans has something new (playKey); otherwise the settled row. Medium tier.
// The line is readable from the first frame (infoOpacity); faces never start invisible either. Takes no touches (the line's
// own "See gatherings" stays the action). No haptic. Reduce Motion = settled. Up to 3 faces (the line covers at most 3).
const T = SEQUENCES.friendsPlanning;

export default function FriendsPlanning({ people, photoUrls = {}, text, textStyle, playKey }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const shown = (people ?? []).slice(0, T.maxPeople);
  const faces = useRef(Array.from({ length: T.maxPeople }, () => new Animated.Value(1))).current;
  const glyphs = useRef(Array.from({ length: T.maxPeople }, () => new Animated.Value(1))).current;
  const line = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!playKey || reduceMotion) return undefined;
    [...faces, ...glyphs, line].forEach((v) => v.setValue(0));
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.parallel([
      ...faces.map((v, i) => Animated.timing(v, { toValue: 1, duration: T.avatarMs, delay: i * T.staggerMs, easing: ease, useNativeDriver: true })),
      ...glyphs.map((v, i) => Animated.timing(v, { toValue: 1, duration: T.glyphMs, delay: T.glyphDelayMs + i * T.staggerMs, easing: ease, useNativeDriver: true })),
      Animated.timing(line, { toValue: 1, duration: T.lineMs, delay: T.lineDelayMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => { anim.stop(); [...faces, ...glyphs, line].forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, reduceMotion]);

  return (
    <View pointerEvents="none" accessible accessibilityLabel={text}>
      {shown.length > 0 ? (
        <View style={styles.faces}>
          {shown.map((p, i) => (
            <Animated.View
              key={p.gatheringId}
              style={[i > 0 && styles.overlap, { opacity: infoOpacity(faces[i]), transform: [{ scale: faces[i].interpolate({ inputRange: [0, 1], outputRange: [T.fromScale, 1] }) }] }]}
            >
              {photoUrls[p.id]
                ? <Image source={{ uri: photoUrls[p.id] }} style={[styles.face, { borderColor: colors.background }]} accessibilityIgnoresInvertColors />
                : <View style={[styles.face, styles.faceEmpty, { borderColor: colors.background, backgroundColor: colors.border }]}><Ionicons name="person" size={12} color={colors.textTertiary} /></View>}
              {p.tag ? (
                <Animated.View style={[styles.glyph, { backgroundColor: colors.surface, opacity: glyphs[i], transform: [{ scale: glyphs[i] }] }]}>
                  <Text style={styles.glyphText}>{categoryStyleFor(p.tag).icon}</Text>
                </Animated.View>
              ) : null}
            </Animated.View>
          ))}
        </View>
      ) : null}
      <Animated.Text style={[textStyle, { opacity: infoOpacity(line) }]}>{text}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faces: { flexDirection: 'row', marginBottom: spacing.xs },
  overlap: { marginLeft: -6 },
  face: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  faceEmpty: { alignItems: 'center', justifyContent: 'center' },
  glyph: { position: 'absolute', right: -4, bottom: -3, width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: 9 },
});
