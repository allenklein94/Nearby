import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
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
//
// Item 122 ("Don't overanimate the business experience"): occasion-creation
// moments (a plan being born, a community going live) can stay playful --
// tone="celebratory" (the default), the full N -> ✨ -> ✓ production below.
// A business TRANSACTION confirming (an offer accepted, a reservation locking
// in) should feel fast + trustworthy + professional instead -- tone="business"
// skips the ✨ discovery beat entirely (a confirmation isn't Nearby finding
// something, it's a fact settling), lands on the checkmark in roughly half the
// time, and swaps the springy scale-pop for a plain, minimal-overshoot settle.
// Content/meaning are identical either way; only the intensity changes.
const STAGE_MS = { celebratory: 340, business: 160 };

// `haptic` (Item 130): opt-in, pass true ONLY when this plays as the direct result of the user's
// own action (they tapped Confirm/Submit). A state change that merely arrived (a realtime update,
// a background refresh) gets the animation but never a haptic.
export default function SuccessAnimation({ text = "It's happening. 🎉", tone = 'celebratory', haptic = false }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const styles = getStyles(colors);
  const isBusiness = tone === 'business';
  const stageMs = STAGE_MS[tone] ?? STAGE_MS.celebratory;
  const [stage, setStage] = useState('mark'); // 'mark' -> 'sparkle'? -> 'check'
  const glyphOpacity = useRef(new Animated.Value(0)).current;
  const glyphScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (haptic) playHaptic(HAPTIC_MOMENTS.success);
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
      glyphScale.setValue(isBusiness ? 0.85 : 0.6);
      Animated.parallel([
        Animated.timing(glyphOpacity, { toValue: 1, duration: isBusiness ? 120 : 180, useNativeDriver: true }),
        isBusiness
          // A plain, fast settle -- no springy overshoot, reads as "confirmed," not "confetti."
          ? Animated.timing(glyphScale, { toValue: 1, duration: 120, useNativeDriver: true })
          : Animated.spring(glyphScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    };
    const stages = isBusiness ? ['mark', 'check'] : ['mark', 'sparkle', 'check'];
    stages.forEach((next, i) => {
      if (i === 0) { playStage(next); return; }
      timers.push(setTimeout(() => playStage(next), stageMs * i));
    });
    timers.push(setTimeout(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: isBusiness ? 160 : 260, useNativeDriver: true }).start();
    }, stageMs * (stages.length - 1) + (isBusiness ? 120 : 180)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, tone]);

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
