import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { DIETARY_OPTIONS } from '../constants/businessAttributes';

// Consumer-picked, closed-vocabulary dietary needs for a food request (never inferred, never free text).
// Shared by every screen that creates a business request so the wording and the "who sees this" promise stay identical.
export default function DietaryPicker({ selected, onChange, note }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View>
      <Text style={styles.label}>Dietary needs (optional)</Text>
      <View style={styles.chipRow}>
        {DIETARY_OPTIONS.map((d) => {
          const on = selected.includes(d.key);
          return (
            <TouchableOpacity
              key={d.key}
              style={[styles.chip, on && styles.chipSelected]}
              onPress={() => onChange(on ? selected.filter((k) => k !== d.key) : [...selected, d.key])}
              accessibilityLabel={d.label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextSelected]}>{d.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.note}>{note ?? 'Shared only with businesses that respond to this request, so they can plan your meal.'}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  label: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, marginRight: spacing.sm, marginBottom: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
});
