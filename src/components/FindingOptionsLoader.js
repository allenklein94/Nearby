import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { NearbyMark } from './brand';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';

// Item 112 follow-up (CLAUDE.md, "the best animation might actually be the
// planning process... instead of the user staring at a spinner, they're
// watching Nearby work"): replaces a bare ActivityIndicator + one static
// caption with a small rotating sequence of plain-language captions
// (paired with a subtly pulsing NearbyMark) narrating the real conceptual
// stages resolveIntent() actually goes through -- finding candidate
// places, checking their real availability, scoring/assembling the final
// list. Deliberately NOT a fake progress bar or a claimed count ("Found 4
// places!") -- there is exactly one real network round trip behind this
// (resolveIntent() returns everything at once), so this narrates plausible
// real work honestly rather than fabricating measured phases or numbers;
// it loops for as long as the real fetch actually takes, never asserting
// "done" before the real result (optionsFetched) actually arrives.
const CAPTIONS = [
  'Finding something special nearby…',
  'Finding places…',
  'Checking availability…',
  'Building your options…',
];
const CAPTION_STEP_MS = 900;
const PULSE_MS = 700;

export default function FindingOptionsLoader() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [captionIndex, setCaptionIndex] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ])
    );
    loop.start();
    const interval = setInterval(() => {
      setCaptionIndex((i) => (i + 1) % CAPTIONS.length);
    }, CAPTION_STEP_MS);
    return () => {
      loop.stop();
      clearInterval(interval);
    };
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <NearbyMark size={32} />
      </Animated.View>
      <Text style={styles.text}>{CAPTIONS[captionIndex]}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { alignItems: 'center', marginTop: spacing.lg },
  text: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
});
