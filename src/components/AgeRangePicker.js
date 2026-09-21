import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { AGE_MIN_OPTIONS, AGE_MAX_OPTIONS, ageRangeLabel } from '../utils/suitedAges';

// "Suited ages" (owner item 50): a descriptive From / To range. Tap a chip to choose, tap it again (or "Any") to leave that end open.
// Shared by Create, Edit and the business Profile tab. Picking a From above the To (or the reverse) clears the other end, so the
// pair is always valid. Says plainly that it does not restrict who can join.
export default function AgeRangePicker({ min, max, onChange, label = 'Suited ages' }) {
  const { colors } = useTheme();
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
      accessibilityLabel={`${text}${selected ? ', selected' : ''}`}
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
      <Text style={[styles.sub, { color: colors.textSecondary }]}>From age</Text>
      <View style={styles.row}>
        {chip('Any', min == null, () => set(null, max), 'min-any')}
        {AGE_MIN_OPTIONS.map((n) => chip(String(n), min === n, () => set(min === n ? null : n, max), `min-${n}`))}
      </View>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>Up to age</Text>
      <View style={styles.row}>
        {chip('Any', max == null, () => set(min, null), 'max-any')}
        {AGE_MAX_OPTIONS.map((n) => chip(String(n), max === n, () => set(min, max === n ? null : n), `max-${n}`))}
      </View>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        {summary ? `${summary}. ` : ''}A guide for families, not a rule: it doesn't stop anyone from joining.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sub: { fontSize: 13, marginTop: spacing.sm },
});
