import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { spacing, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from '../motion/motionBudget';

// Item 187 + owner item 82 (2026-10-12): the "From what you said" card in Create (which rows and on which steps:
// utils/fromWhatYouSaid.js). With `settle`, its rows settle in once, one after another, on item 45's own small tokens
// (SEQUENCES.askUnderstood: readable from frame one, no glow, no haptic, no loop); the card itself is there at once and the
// Hide button works at once. Reduce Motion = already settled. Never delays opening Create.
const T = SEQUENCES.askUnderstood;

export default function FromWhatYouSaidCard({ rows, labelFor, valueFor, guidance, onHide, settle = false, onSettled, labelStyle }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const reduceMotion = useReduceMotion();
  const [play] = useState(() => !!settle && !reduceMotion);
  const steps = useRef(rows.map(() => new Animated.Value(play ? 0 : 1))).current;

  useEffect(() => {
    // Once per Create: the screen stops offering the settle as soon as this card has been shown with it.
    if (settle && onSettled) onSettled();
    if (!play) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.stagger(T.staggerMs, steps.map((v) => Animated.timing(v, { toValue: 1, duration: T.pieceMs, easing: ease, useNativeDriver: true })));
    anim.start();
    return () => { anim.stop(); steps.forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }} accessibilityLabel={t('ui.gatheringForm.fromWhatYouSaid')}>
      <Text style={[labelStyle, { marginTop: 0 }]}>{t('ui.gatheringForm.fromWhatYouSaid')}</Text>
      {rows.map((r, i) => {
        const v = steps[i] ?? null;
        return (
          <Animated.View key={r.layer} style={v ? { opacity: infoOpacity(v), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }] } : null}>
            <Text style={{ color: colors.text, marginTop: 2 }}>
              <Text style={{ color: colors.textSecondary }}>{labelFor(r)}: </Text>{valueFor(r)}
            </Text>
          </Animated.View>
        );
      })}
      {guidance ? <Text style={{ color: colors.textSecondary, marginTop: spacing.xs }}>{guidance}</Text> : null}
      <TouchableOpacity onPress={onHide} accessibilityRole="button" accessibilityLabel={t('ui.gatheringForm.hideSummaryA11y')} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
        <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>{t('ui.gatheringForm.hide')}</Text>
      </TouchableOpacity>
    </View>
  );
}
