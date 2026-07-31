import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

const LABELS = {
  weekly: '🔁 Weekly',
  biweekly: '🔁 Every 2 weeks',
  monthly: '🔁 Monthly',
};

// Purely presentational — no data fetching needed since
// recurrence_rule already comes through on the gathering object
// itself, unlike NewcomerBadge/BusinessHostBadge which need their
// own lookups.
export default function RecurringBadge({ recurrenceRule }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  if (!recurrenceRule || !LABELS[recurrenceRule]) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{LABELS[recurrenceRule]}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  text: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
});