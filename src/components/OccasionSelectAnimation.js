import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Item 112 (CLAUDE.md, "We should have animations for that too... purposeful
// and contextual, not generic animations everywhere"): a deliberately SMALL
// set of per-occasion micro-celebrations -- only the 5 the user explicitly
// named (birthday/anniversary/graduation/celebration/surprise). Every other
// occasion (anything reached via "More Occasions" besides Graduation) gets
// no animation at all, on purpose -- "not a giant confetti explosion every
// time," just enough to signal "you've entered a special planning
// experience." Same plain RN Animated API this codebase already uses for
// MatchCelebrationModal.js's own celebratory entrance -- no new dependency.
export const OCCASION_SELECT_ANIMATIONS = {
  birthday: { kind: 'morph', glyphs: ['🎂', '✨', '🎈'], text: "Let's make it special." },
  anniversary: { kind: 'morph', glyphs: ['💍', '✨'], text: "Plan something they'll remember." },
  graduation: { kind: 'morph', glyphs: ['🎓', '✨'], text: 'Celebrate the milestone.' },
  // "A quick burst of tasteful celebratory particles" -- no transition line
  // named for this one, so none is fabricated; the particles alone are the
  // whole moment.
  celebration: { kind: 'particles', glyphs: ['🎉', '✨', '🎊', '🎈', '🎉', '✨'], text: null },
  // "The UI could transition into a 'surprise mode' visually... with a
  // subtle lock animation" -- a quick unlocked-to-locked snap, then the
  // real mode name, rather than a full theme change (a much bigger,
  // separate redesign this item doesn't ask for).
  surprise: { kind: 'lock', glyphs: ['🔓', '🔒'], text: '🔒 Surprise Mode' },
};

const MORPH_STEP_MS = 260;
const HOLD_MS = 550;
const LOCK_SNAP_DELAY_MS = 320;

export default function OccasionSelectAnimation({ triggerKey, onDone }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const spec = OCCASION_SELECT_ANIMATIONS[triggerKey];

  const containerOpacity = useRef(new Animated.Value(0)).current;
  const glyphOpacity = useRef(new Animated.Value(0)).current;
  const glyphScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const [glyphIndex, setGlyphIndex] = useState(0);
  const particleAnims = useRef(
    Array.from({ length: 6 }, () => ({
      opacity: new Animated.Value(0),
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (!spec) {
      onDone?.();
      return undefined;
    }

    let cancelled = false;
    const timers = [];

    containerOpacity.setValue(0);
    textOpacity.setValue(0);
    setGlyphIndex(0);
    Animated.timing(containerOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();

    let totalMs;
    if (spec.kind === 'morph') {
      const playGlyph = (i) => {
        if (cancelled) return;
        setGlyphIndex(i);
        glyphOpacity.setValue(0);
        glyphScale.setValue(0.6);
        Animated.parallel([
          Animated.timing(glyphOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.spring(glyphScale, { toValue: 1, friction: 5, useNativeDriver: true }),
        ]).start();
        if (i < spec.glyphs.length - 1) {
          timers.push(setTimeout(() => playGlyph(i + 1), MORPH_STEP_MS));
        } else {
          timers.push(setTimeout(() => {
            if (!cancelled) Animated.timing(textOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
          }, MORPH_STEP_MS));
        }
      };
      playGlyph(0);
      totalMs = MORPH_STEP_MS * spec.glyphs.length + HOLD_MS;
    } else if (spec.kind === 'lock') {
      glyphOpacity.setValue(1);
      glyphScale.setValue(1);
      timers.push(setTimeout(() => {
        if (cancelled) return;
        setGlyphIndex(1);
        glyphScale.setValue(1.3);
        Animated.spring(glyphScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
        Animated.timing(textOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      }, LOCK_SNAP_DELAY_MS));
      totalMs = LOCK_SNAP_DELAY_MS + HOLD_MS;
    } else {
      // particles
      particleAnims.forEach((p, i) => {
        p.opacity.setValue(0);
        p.translateX.setValue(0);
        p.translateY.setValue(0);
        const angle = (i / particleAnims.length) * Math.PI * 2;
        const dist = 30 + (i % 2) * 12;
        Animated.sequence([
          Animated.delay(i * 30),
          Animated.parallel([
            Animated.timing(p.opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
            Animated.timing(p.translateX, { toValue: Math.cos(angle) * dist, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(p.translateY, { toValue: Math.sin(angle) * dist, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]),
          Animated.timing(p.opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
        ]).start();
      });
      totalMs = 700;
    }

    timers.push(setTimeout(() => {
      Animated.timing(containerOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        if (!cancelled) onDone?.();
      });
    }, totalMs));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

  if (!spec) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.overlay, shadow.card, { opacity: containerOpacity }]}>
      {spec.kind === 'particles' ? (
        <View style={styles.particleField}>
          {particleAnims.map((p, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.particleGlyph,
                { opacity: p.opacity, transform: [{ translateX: p.translateX }, { translateY: p.translateY }] },
              ]}
            >
              {spec.glyphs[i % spec.glyphs.length]}
            </Animated.Text>
          ))}
        </View>
      ) : (
        <Animated.Text style={[styles.glyph, { opacity: glyphOpacity, transform: [{ scale: glyphScale }] }]}>
          {spec.glyphs[glyphIndex]}
        </Animated.Text>
      )}
      {!!spec.text && (
        <Animated.Text style={[styles.text, { opacity: textOpacity }]}>{spec.text}</Animated.Text>
      )}
    </Animated.View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  overlay: {
    alignItems: 'center', justifyContent: 'center', minHeight: 76,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, marginTop: spacing.sm, marginBottom: spacing.xs,
  },
  glyph: { fontSize: 36 },
  text: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' },
  particleField: { width: 72, height: 40, alignItems: 'center', justifyContent: 'center' },
  particleGlyph: { position: 'absolute', fontSize: 18 },
});
