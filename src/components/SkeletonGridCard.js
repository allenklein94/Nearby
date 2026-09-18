import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Matches the shape of Notices' 2-column grid cards (tall
// photo area + name line), distinct from SkeletonCard's
// horizontal row shape used in single-column lists.
export default function SkeletonGridCard() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.photo, { opacity }]} />
      <View style={styles.footer}>
        <Animated.View style={[styles.line, { opacity }]} />
      </View>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: {
    flex: 1, margin: spacing.xs, borderRadius: radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, aspectRatio: 0.85,
  },
  photo: { width: '100%', height: '75%', backgroundColor: colors.surfaceElevated },
  footer: { padding: spacing.sm, justifyContent: 'center' },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceElevated, width: '70%' },
});