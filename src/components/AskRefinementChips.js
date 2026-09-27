// The typed-ask refinement chips (owner item 107), one component for Home and Discover: same chips, labels, selection and
// styling on both. Chips come from utils/askRefinements.js; the tap handler is the surface's call into services/askRefine.js.
// Typed-ask refinement only: never a persistent filter, and no more chips until real usage shows a need.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import { refinementChips, canRefine } from '../utils/askRefinements';
import { NLoader } from '../motion';
import EmptyCopy from './EmptyCopy';

export default function AskRefinementChips({ classifyResult, onRefine, refining = false, empty = false }) {
  const { colors } = useTheme();
  if (!canRefine(classifyResult)) return null;
  return (
    <>
      <View style={styles.row}>
        {refinementChips(classifyResult).map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, { borderColor: colors.border }, chip.selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => onRefine(chip.key)}
            disabled={refining}
            accessibilityRole="button"
            accessibilityState={{ selected: chip.selected, disabled: refining }}
            accessibilityLabel={chip.label}
          >
            <Text style={[styles.text, { color: chip.selected ? '#fff' : colors.textPrimary }]}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {refining && <NLoader fullScreen={false} size="inline" kind="recommendations" />}
      {!refining && empty && <EmptyCopy id="refine_none" />}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  text: { ...typography.caption, fontWeight: '600' },
});
