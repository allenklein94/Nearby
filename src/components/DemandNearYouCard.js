import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Top-of-dashboard "Demand near you". `signals` are already-described rows from
// describeDemandSignals() (privacy floor enforced server-side and re-checked there). `loaded`
// distinguishes "still fetching" (render nothing) from "not enough activity" (honest empty copy).
export default function DemandNearYouCard({ signals, loaded, onAction }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  if (!loaded) return null;

  return (
    <View style={styles.card} accessibilityLabel="Demand near you">
      <Text style={styles.title}>Demand near you</Text>
      {signals.length === 0 ? (
        <Text style={styles.empty}>We're still gathering enough local activity to show useful demand.</Text>
      ) : (
        signals.map((s, i) => (
          <View key={s.key} style={[styles.row, i > 0 && styles.rowDivider]}>
            <Text style={styles.headline}>{s.headline}</Text>
            <Text style={styles.detail}>{s.detail}</Text>
            <TouchableOpacity
              style={styles.action}
              onPress={() => onAction(s.action)}
              accessibilityLabel={s.actionLabel}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{s.actionLabel} →</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 14 },
  row: { paddingVertical: spacing.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  headline: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  action: { alignSelf: 'flex-start', marginTop: spacing.sm },
  actionText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
