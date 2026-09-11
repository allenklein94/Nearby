import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing, radius, typography } from '../theme';

// Refactored out of the now-removed standalone RecommendationPreferencesScreen
// (external UX critique item 17 follow-up, 2026-09-11): direct feedback that a
// whole navigation destination for 4 rows of controls fights this app's own
// "fewer screens, contextual disclosure" direction. This is now a plain inline
// panel rendered directly under each Settings notification row's own
// "Customize" link (an in-place expand/collapse, not a navigation push) --
// same content and columns as before, just no longer its own screen. Kept as
// a shared component (not copy-pasted twice into SettingsScreen) since Things
// To Do and Nearby Opportunities each render it once with their own values.
//
// Categories deliberately shows only the user's own already-declared
// interests (profiles.interests) as togglable chips, not the full ~75-tag
// catalog -- a push can only ever be about something the trigger already
// requires to be a genuine interest of theirs (see
// 20261004_recommended_for_you_push.sql's own p.interests @> array[...]
// check), so offering the full catalog here would let someone "select" a
// category that could never actually fire a push.
export const FREQUENCY_OPTIONS = [
  { key: 'few_per_day', label: 'A few per day' },
  { key: 'more_often', label: 'More often' },
  { key: 'as_they_happen', label: 'As they happen' },
];
// Reuses this app's own real distance tiers (gatherings.js's
// LOCAL_TIER_MAX_MILES / WIDE_TIER_MAX_MILES) rather than inventing a new
// distance concept or a slider.
export const DISTANCE_OPTIONS = [
  { key: 1, label: 'Nearby (1 mi)' },
  { key: 15, label: 'Wider area (15 mi)' },
  { key: null, label: 'Any distance' },
];
export const TIME_OPTIONS = [
  { key: 'anytime', label: 'Anytime' },
  { key: 'evenings_weekends', label: 'Evenings & Weekends' },
];

export default function RecommendationCustomizePanel({
  colors,
  myInterests,
  frequency,
  distance,
  timePref,
  selectedCategories,
  onChangeFrequency,
  onChangeDistance,
  onChangeTimePref,
  onToggleCategory,
}) {
  const styles = getStyles(colors);
  const effectiveSelectedCategories = selectedCategories ?? myInterests;

  return (
    <View style={styles.panel}>
      <Text style={styles.sectionHeader}>Frequency</Text>
      <View style={styles.chipsWrap}>
        {FREQUENCY_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.chip, frequency === opt.key && styles.chipSelected]}
            onPress={() => onChangeFrequency(opt.key)}
            accessibilityLabel={opt.label}
            accessibilityRole="button"
            accessibilityState={{ selected: frequency === opt.key }}
          >
            <Text style={[styles.chipText, frequency === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionHeader}>Distance</Text>
      <View style={styles.chipsWrap}>
        {DISTANCE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.label}
            style={[styles.chip, distance === opt.key && styles.chipSelected]}
            onPress={() => onChangeDistance(opt.key)}
            accessibilityLabel={opt.label}
            accessibilityRole="button"
            accessibilityState={{ selected: distance === opt.key }}
          >
            <Text style={[styles.chipText, distance === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionHeader}>Time</Text>
      <View style={styles.chipsWrap}>
        {TIME_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.chip, timePref === opt.key && styles.chipSelected]}
            onPress={() => onChangeTimePref(opt.key)}
            accessibilityLabel={opt.label}
            accessibilityRole="button"
            accessibilityState={{ selected: timePref === opt.key }}
          >
            <Text style={[styles.chipText, timePref === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionHeader}>Categories</Text>
      {myInterests.length === 0 ? (
        <Text style={styles.emptyText}>Add interests to your profile to fine-tune which categories notify you.</Text>
      ) : (
        <View style={styles.chipsWrap}>
          {myInterests.map((tag) => {
            const isSelected = effectiveSelectedCategories.includes(tag);
            return (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => onToggleCategory(tag)}
                accessibilityLabel={tag}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  panel: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, fontStyle: 'italic' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  chipTextSelected: { color: '#fff' },
});
