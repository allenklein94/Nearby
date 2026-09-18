import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { NearbyMark } from '../components/brand';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// SuccessAnimation -- ✓ = completion (plan/reservation/request confirmed), per
// the Nearby Motion Language. The brand mark itself becomes the celebration:
// N -> ✨ -> ✓, settling on the checkmark, then the real success text fades in
// below and stays -- this is the header of whatever real content renders
// underneath it (e.g. "We asked N nearby businesses…", a Plan Status pill), it
// doesn't self-dismiss the way OccasionAnimation's tile-selection moments do.
// A caller that wants a transient flash (e.g. "you just accepted an offer,"
// distinct from a standing status label right below it) is responsible for its
// own show/hide timing -- this component always renders fully mounted.
const STAGE_MS = 340;

export default function SuccessAnimation({ text = "It's happening. 🎉" }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const styles = getStyles(colors);
  const [stage, setStage] = useState('mark'); // 'mark' -> 'sparkle' -> 'check'
  const glyphOpacity = useRef(new Animated.Value(0)).current;
  const glyphScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timers = [];

    // Reduce Motion: land directly on the real settled state (✓ + the real success
    // text) with no cross-fade through mark/sparkle -- this is often the header of
    // the screen's own real content below it, so it needs to be legible immediately.
    if (reduceMotion) {
      setStage('check');
      glyphOpacity.setValue(1);
      glyphScale.setValue(1);
      textOpacity.setValue(1);
      return undefined;
    }

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
  }, [reduceMotion]);

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
