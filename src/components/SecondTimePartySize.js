import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { useLanguage } from '../context/LanguageContext';

// Item 119b: under a reply's SECOND time, the business may make that time for fewer people than the request ("4 at
// 7 PM or 6 at 8:30 PM"). The first time always stays for the whole party (owner LOCKED), so this control exists only
// beside a second time. `total` = the request's party (shown only for 2 or more); `value` = the smaller headcount or
// null (= the whole party). One step at a time, 1 to total - 1; Clear returns it to the whole party.
export default function SecondTimePartySize({ total, value = null, onChange }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const whole = Number(total);
  if (!Number.isInteger(whole) || whole < 2) return null;
  if (value == null) {
    return (
      <TouchableOpacity style={styles.chip} onPress={() => onChange(whole - 1)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.forFewerPeople')}>
        <Text style={styles.chipText}>+ {t('ui.bizDash3.forFewerPeople')}</Text>
      </TouchableOpacity>
    );
  }
  const n = Math.min(Math.max(1, value), whole - 1);
  return (
    <View style={styles.row}>
      <TouchableOpacity style={[styles.step, n <= 1 && styles.stepOff]} disabled={n <= 1} onPress={() => onChange(n - 1)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.onePersonFewerA11y')} accessibilityState={{ disabled: n <= 1 }}>
        <Text style={styles.stepText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.label} accessibilityLiveRegion="polite">{t('ui.bizDash3.secondTimeFor', { count: n, total: whole })}</Text>
      <TouchableOpacity style={[styles.step, n >= whole - 1 && styles.stepOff]} disabled={n >= whole - 1} onPress={() => onChange(n + 1)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash3.onePersonMoreA11y')} accessibilityState={{ disabled: n >= whole - 1 }}>
        <Text style={styles.stepText}>+</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.chip, { marginTop: 0, marginLeft: spacing.sm }]} onPress={() => onChange(null)} accessibilityRole="button" accessibilityLabel={t('ui.bizDash1.clear')}>
        <Text style={styles.chipText}>{t('ui.bizDash1.clear')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.sm },
  chip: {
    alignSelf: 'flex-start', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full,
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.surface,
  },
  chipText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  step: {
    width: 36, height: 36, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  stepOff: { opacity: 0.4 },
  stepText: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  label: { ...typography.body, color: colors.textPrimary, marginHorizontal: spacing.sm },
});
