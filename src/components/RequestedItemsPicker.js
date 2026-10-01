import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { REQUESTED_ITEM_OPTIONS } from '../constants/businessAttributes';

// Customer-picked, closed-list "what would you like on hand" for a food/coffee request (never typed, never inferred).
export default function RequestedItemsPicker({ selected, onChange }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View>
      <Text style={styles.label}>{t('ui.smallParts.whatWouldYouLikeOptional')}</Text>
      <View style={styles.chipRow}>
        {REQUESTED_ITEM_OPTIONS.map((d) => {
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
      <Text style={styles.note}>{t('ui.smallParts.shownToBusinessesThatGet')}</Text>
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
