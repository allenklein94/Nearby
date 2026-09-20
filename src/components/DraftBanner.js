import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { formatAgo } from '../utils/timeLabels';

// "You have an unfinished draft" -> Continue editing / Start over (item 82).
export default function DraftBanner({ savedAt, what = 'draft', onContinue, onDiscard, style }) {
  const { colors } = useTheme();
  const ago = savedAt ? formatAgo(new Date(savedAt).toISOString()) : null;
  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>You have an unfinished {what}.{ago ? ` Saved ${ago}.` : ''}</Text>
      <View style={styles.row}>
        <TouchableOpacity onPress={onContinue} accessibilityRole="button" accessibilityLabel="Continue editing">
          <Text style={[styles.primary, { color: colors.primary }]}>Continue editing</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDiscard} accessibilityRole="button" accessibilityLabel="Start over">
          <Text style={[styles.secondary, { color: colors.textSecondary }]}>Start over</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  title: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  primary: { fontSize: 14, fontWeight: '700' },
  secondary: { fontSize: 14, fontWeight: '600' },
});
