// The typed-ask refinement chips (owner item 107), one component for Home and Discover: same chips, labels, selection and
// styling on both. Chips come from utils/askRefinements.js; the tap handler is the surface's call into services/askRefine.js.
// Typed-ask refinement only: never a persistent filter, and no more chips until real usage shows a need.
// Owner item 46: the next useful step's chips (Who, then Budget; nextRefinementStep) carry a soft emphasis. It is there from the
// first render; when the person's own tap moves it to the next step it fades in there (small tier); Reduce Motion = at once.
// Never while a refinement runs or after one came back empty (it would point at narrowing further), never once both are answered.
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import { refinementChips, canRefine, nextRefinementStep } from '../utils/askRefinements';
import { NLoader } from '../motion';
import { SEQUENCES } from '../motion/motionBudget';
import useReduceMotion from '../hooks/useReduceMotion';
import EmptyCopy from './EmptyCopy';

const T = SEQUENCES.refineNextStep;

export default function AskRefinementChips({ classifyResult, onRefine, refining = false, empty = false }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const step = canRefine(classifyResult) && !refining && !empty ? nextRefinementStep(classifyResult) : null;
  const emphasis = useRef(new Animated.Value(1)).current;
  const shownStep = useRef(step);

  useEffect(() => {
    if (step === shownStep.current) return undefined;
    shownStep.current = step;
    if (!step || reduceMotion) { emphasis.setValue(1); return undefined; }
    emphasis.setValue(0);
    const anim = Animated.timing(emphasis, { toValue: 1, duration: T.fadeMs, useNativeDriver: true });
    anim.start();
    return () => { anim.stop(); emphasis.setValue(1); };
  }, [step, reduceMotion, emphasis]);

  if (!canRefine(classifyResult)) return null;
  return (
    <>
      <View style={styles.row}>
        {refinementChips(classifyResult).map((chip) => {
          const next = !chip.selected && chip.step === step;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[styles.chip, { borderColor: colors.border }, chip.selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => onRefine(chip.key)}
              disabled={refining}
              accessibilityRole="button"
              accessibilityState={{ selected: chip.selected, disabled: refining }}
              accessibilityLabel={chip.label}
            >
              {next && (
                <Animated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.emphasis, { backgroundColor: colors.primaryMuted, opacity: emphasis }]}
                />
              )}
              <Text style={[styles.text, { color: chip.selected ? '#fff' : colors.textPrimary }]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {refining && <NLoader fullScreen={false} size="inline" kind="recommendations" />}
      {!refining && empty && <EmptyCopy id="refine_none" />}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  // A soft coral wash inside the chip's own border, never the solid selected look.
  emphasis: { borderRadius: 16 },
  text: { ...typography.caption, fontWeight: '600' },
});
