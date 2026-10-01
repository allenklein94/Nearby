import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { AGE_MIN_OPTIONS, AGE_MAX_OPTIONS, AGE_BANDS, ageBandOf, ageRangeLabel } from '../utils/suitedAges';

// "Suited ages" (owner item 50): a descriptive From / To range. Tap a chip to choose, tap it again (or "Any") to leave that end open.
// Shared by Create, Edit and the business Profile tab. Picking a From above the To (or the reverse) clears the other end, so the
// pair is always valid. Says plainly that it does not restrict who can join. A quick row (All ages / Kids / Teens) sets the SAME
// min/max pair; tapping the selected band clears it back to not said. The exact From / To chips stay one tap away ("Exact ages"),
// open by default when the saved range is an exact one that is not a band.
export default function AgeRangePicker({ min, max, onChange, label: labelProp }) {
  const { t } = useLanguage();
  const label = labelProp ?? t('ui.ageRange.suitedAges');
  const { colors } = useTheme();
  const band = ageBandOf(min, max);
  const exactSaved = (min != null || max != null) && !band;
  const [showExact, setShowExact] = useState(exactSaved);
  const set = (nextMin, nextMax) => {
    Haptics.selectionAsync();
    if (nextMin != null && nextMax != null && nextMin > nextMax) { nextMax = null; }
    onChange(nextMin ?? null, nextMax ?? null);
  };
  const chip = (text, selected, onPress, key) => (
    <TouchableOpacity
      key={key}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={selected ? t('ui.ageRange.selectedA11y', { label: text }) : text}
      accessibilityState={{ selected }}
      style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      <Text style={{ color: selected ? '#fff' : colors.text, fontSize: 14 }}>{text}</Text>
    </TouchableOpacity>
  );
  const summary = ageRangeLabel(min, max);
  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '600', marginTop: spacing.md }}>{label}</Text>
      <View style={styles.row}>
        {AGE_BANDS.map((b) => chip(b.label, band?.key === b.key, () => (band?.key === b.key ? set(null, null) : set(b.min, b.max)), `band-${b.key}`))}
      </View>
      {!(showExact || exactSaved) ? (
        <TouchableOpacity onPress={() => setShowExact(true)} accessibilityRole="button" style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>{t('ui.ageRange.exactAges')}</Text>
        </TouchableOpacity>
      ) : (
      <>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('ui.ageRange.fromAge')}</Text>
      <View style={styles.row}>
        {chip(t('ui.ageRange.any'), min == null, () => set(null, max), 'min-any')}
        {AGE_MIN_OPTIONS.map((n) => chip(String(n), min === n, () => set(min === n ? null : n, max), `min-${n}`))}
      </View>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>{t('ui.ageRange.upToAge')}</Text>
      <View style={styles.row}>
        {chip(t('ui.ageRange.any'), max == null, () => set(min, null), 'max-any')}
        {AGE_MAX_OPTIONS.map((n) => chip(String(n), max === n, () => set(min, max === n ? null : n), `max-${n}`))}
      </View>
      </>
      )}
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {summary ? `${summary}. ` : ''}{t('ui.ageRange.aGuideForFamiliesNot')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sub: { fontSize: 13, marginTop: spacing.sm },
});
