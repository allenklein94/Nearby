import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from '../motion/motionBudget';
import { categoryName, groupName } from '../i18n/categoryNames';
import { PARTY_TYPE_LABELS } from '../constants/gatheringDisplaySignals';
import { understoodPieces, understoodKey, takeUnderstoodPlay } from '../utils/askUnderstood';

// Owner item 45 (2026-10-11): "Nearby understood me". The quiet chips of what a typed ask was read as ("Tonight · 🌳 Outdoor"),
// shown the moment the ask is understood (under the "Finding…" loader) and kept above its results. Which pieces: only
// utils/askUnderstood.js. Not buttons (the refinement chips below are the ones that change the ask), no coral, no new strings:
// labels reuse the date filter, environment chip, category and party names already shown elsewhere. The first time an ask is
// understood they settle in one after another (small tier, readable from frame one); Reduce Motion or a repeat = already there.
const T = SEQUENCES.askUnderstood;

export default function AskUnderstoodChips({ classifyResult, typedText }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const reduceMotion = useReduceMotion();
  const pieces = understoodPieces(classifyResult, typedText).slice(0, T.maxPieces);
  const [play] = useState(() => pieces.length > 0 && takeUnderstoodPlay(understoodKey(pieces, typedText)) && !reduceMotion);
  const steps = useRef(Array.from({ length: T.maxPieces }, () => new Animated.Value(play ? 0 : 1))).current;

  useEffect(() => {
    if (!play) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.stagger(T.staggerMs, steps.map((v) => Animated.timing(v, { toValue: 1, duration: T.pieceMs, easing: ease, useNativeDriver: true })));
    anim.start();
    return () => { anim.stop(); steps.forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pieces.length === 0) return null;
  const label = (p) => {
    if (p.key === 'what') return p.category ? categoryName(p.category, language) : groupName(p.group, language);
    if (p.key === 'when') return t(`ui.gatherings.dateFilter.${p.window}`);
    if (p.key === 'where') return t(p.environment === 'outdoor' ? 'ui.gatherings.envOutdoorChip' : 'ui.gatherings.envIndoorChip');
    return p.party === 'groups' ? t('ui.discover.tagBigGroup') : PARTY_TYPE_LABELS[p.party];
  };
  const labels = pieces.map(label);
  return (
    <View style={styles.row} pointerEvents="none" accessible accessibilityLabel={labels.join(', ')}>
      {pieces.map((p, i) => (
        <Animated.View
          key={p.key}
          style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }, {
            opacity: infoOpacity(steps[i]),
            transform: [{ translateY: steps[i].interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }],
          }]}
        >
          <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>{labels[i]}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  text: { ...typography.caption, fontWeight: '600' },
});
