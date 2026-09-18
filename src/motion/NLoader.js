import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import { resolveLoadingCaption } from './loadingLanguage';
import useReduceMotion from '../hooks/useReduceMotion';

// NLoader -- N = system intelligence (loading/searching/finding/matching/
// recommending), per the Nearby Motion Language. The app's own splash mark
// (assets/branding/splash-mark.png -- the same image the native splash screen
// shows, so this reads as a continuation of it rather than a jarring image
// swap) plus a subtle coral sweep, in place of a generic spinner/blank screen.
// Item 132/133: N + sweep = "Nearby is thinking/finding/matching", with the caption
// (loadingLanguage.js) saying what on. It is NOT the treatment for a known feed's content simply
// loading -- that's a skeleton (SkeletonFeed.js), which makes a large list feel fast by holding its
// shape. Two different meanings, two different treatments. Small inline spinners inside buttons/footers stay plain ActivityIndicators --
// those are in-flight feedback on a control, not Nearby loading content.
const ICON_SIZES = { default: 88, compact: 56, inline: 32 };
const CAPTION_STEP_MS = 900;
const BAR_WIDTH = 120;
const BAR_HEIGHT = 3;
const SWEEP_WIDTH = 46;

// Item 132: THE loading treatment. `kind`/`caption` say what Nearby is working on (see
// loadingLanguage.js); `captions` cycles a multi-stage narration; `size` is 'default' (a whole
// screen / boot), 'compact' (a content area), or 'inline' (a small row).
export default function NLoader({ fullScreen = true, kind, caption, captions, size = 'default' }) {
  const iconSize = ICON_SIZES[size] ?? ICON_SIZES.default;
  const [captionIndex, setCaptionIndex] = useState(0);
  useEffect(() => {
    if (!captions || captions.length < 2) return undefined;
    // Caption rotation is real informational content, so it keeps cycling under Reduce Motion.
    const id = setInterval(() => setCaptionIndex((i) => (i + 1) % captions.length), CAPTION_STEP_MS);
    return () => clearInterval(id);
  }, [captions]);
  const captionText = captions?.length ? captions[captionIndex % captions.length] : resolveLoadingCaption({ kind, caption });
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Reduce Motion: no continuous decorative loop -- the mark just sits at rest,
    // fully visible, while the real load happens (this is always a transient
    // moment, so there's no meaningful progress signal lost by not animating it).
    if (reduceMotion) {
      sweep.setValue(0);
      pulse.setValue(1);
      return undefined;
    }
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
  }, [sweep, pulse, reduceMotion]);

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
        style={[styles.icon, { width: iconSize, height: iconSize, marginBottom: size === 'inline' ? spacing.sm : spacing.lg, opacity, transform: [{ scale }] }]}
        resizeMode="contain"
        accessibilityLabel={captionText ?? 'Nearby is loading'}
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
      {captionText ? <Text style={[styles.caption, { color: colors.textSecondary }]}>{captionText}</Text> : null}
    </View>
  );

  if (!fullScreen) return content;
  return <View style={[styles.fullScreen, { backgroundColor: colors.background }]}>{content}</View>;
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  icon: { width: ICON_SIZES.default, height: ICON_SIZES.default, marginBottom: spacing.lg },
  caption: { ...typography.caption, marginTop: spacing.sm, textAlign: 'center' },
  barTrack: { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' },
  sweepClip: { width: SWEEP_WIDTH, height: BAR_HEIGHT },
  sweepGradient: { flex: 1, height: '100%' },
});
