import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

// Sep 6 2026 (CLAUDE.md, external UX critique item 13): a branded loading
// treatment using the app's own splash mark (assets/branding/splash-mark.png
// -- the same image the native splash screen shows, so this reads as a
// continuation of it rather than a jarring image swap) plus a subtle coral
// sweep, in place of a generic spinner/blank screen. Deliberately not a
// wholesale SkeletonCard replacement -- SkeletonCard's content-shaped bars
// are still the right treatment for "a list is loading more items"; this is
// for "the app itself is still figuring out where to put you," starting
// with RootNavigator's own session/profile boot gate (previously a bare
// `return null`, i.e. a blank screen).
const ICON_SIZE = 88;
const BAR_WIDTH = 120;
const BAR_HEIGHT = 3;
const SWEEP_WIDTH = 46;

export default function BrandedLoader({ fullScreen = true }) {
  const { colors } = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => {
      sweepLoop.stop();
      pulseLoop.stop();
    };
  }, [sweep, pulse]);

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-SWEEP_WIDTH, BAR_WIDTH],
  });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  const content = (
    <View style={styles.center}>
      <Animated.Image
        source={require('../../assets/branding/splash-mark.png')}
        style={[styles.icon, { opacity, transform: [{ scale }] }]}
        resizeMode="contain"
        accessibilityLabel="Nearby is loading"
      />
      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
        <Animated.View style={[styles.sweepClip, { transform: [{ translateX }] }]}>
          <LinearGradient
            colors={['transparent', colors.primary, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sweepGradient}
          />
        </Animated.View>
      </View>
    </View>
  );

  if (!fullScreen) return content;
  return <View style={[styles.fullScreen, { backgroundColor: colors.background }]}>{content}</View>;
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  icon: { width: ICON_SIZE, height: ICON_SIZE, marginBottom: spacing.lg },
  barTrack: { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
  sweepClip: { width: SWEEP_WIDTH, height: BAR_HEIGHT },
  sweepGradient: { flex: 1, height: '100%' },
});
