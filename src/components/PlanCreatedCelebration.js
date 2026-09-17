import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { NearbyMark } from './brand';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';

// Item 112 follow-up (CLAUDE.md, "take it beyond the occasion-selection
// screen... when the plan is successfully created"): the brand mark itself
// becomes the celebration, not just decoration next to one (Item 57's own
// GatheringConfirmationScreen treatment) -- N -> ✨ -> ✓, settling on the
// checkmark, then "It's happening. 🎉" fades in below and stays (this
// replaces what would otherwise be a flat "Plan created." line, it doesn't
// self-dismiss the way OccasionSelectAnimation.js's tile-selection moments
// do -- the checkmark + line ARE the header of the real success state the
// screen renders underneath, e.g. "We asked N nearby businesses...").
// Plain RN Animated API, same cross-fade-through-stages shape
// OccasionSelectAnimation.js already uses for its 'morph' kind -- no new
// dependency, no new pattern.
const STAGE_MS = 340;

export default function PlanCreatedCelebration({ text = "It's happening. 🎉" }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [stage, setStage] = useState('mark'); // 'mark' -> 'sparkle' -> 'check'
  const glyphOpacity = useRef(new Animated.Value(0)).current;
  const glyphScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timers = [];
    const playStage = (next) => {
      setStage(next);
      glyphOpacity.setValue(0);
      glyphScale.setValue(0.6);
      Animated.parallel([
        Animated.timing(glyphOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(glyphScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    };
    playStage('mark');
    timers.push(setTimeout(() => playStage('sparkle'), STAGE_MS));
    timers.push(setTimeout(() => playStage('check'), STAGE_MS * 2));
    timers.push(setTimeout(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    }, STAGE_MS * 2 + 180));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: glyphOpacity, transform: [{ scale: glyphScale }] }}>
        {stage === 'mark' ? (
          <NearbyMark size={36} />
        ) : (
          <Text style={styles.glyph}>{stage === 'sparkle' ? '✨' : '✓'}</Text>
        )}
      </Animated.View>
      {!!text && <Animated.Text style={[styles.text, { opacity: textOpacity }]}>{text}</Animated.Text>}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { alignItems: 'center', marginBottom: spacing.sm },
  glyph: { fontSize: 30, textAlign: 'center', color: colors.primary, fontWeight: '700' },
  text: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' },
});
