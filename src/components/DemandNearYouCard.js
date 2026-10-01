import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Top-of-dashboard "Demand near you". `signals` are already-described rows from
// describeDemandSignals() (privacy floor enforced server-side and re-checked there). `loaded`
// distinguishes "still fetching" (render nothing) from "not enough activity" (honest empty copy).
export default function DemandNearYouCard({ signals, loaded, onAction, windowDays = 14, matchSummary = null }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  if (!loaded) return null;

  return (
    <View style={styles.card} accessibilityLabel={t('ui.bizComp.demandNearYouA11y')}>
      <Text style={styles.title}>{t('ui.bizComp.demandNearYou')}</Text>
      <Text style={styles.window}>{t('ui.bizComp.lastDays', { windowDays: windowDays })}</Text>
      {matchSummary ? (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>{matchSummary.line}</Text>
          <TouchableOpacity onPress={() => onAction(matchSummary.action)} accessibilityLabel={matchSummary.actionLabel} accessibilityRole="button">
            <Text style={styles.actionText}>{matchSummary.actionLabel} →</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {signals.length === 0 ? (
        <Text style={styles.empty}>{t('ui.bizComp.wereStillGatheringEnoughLocal')}</Text>
      ) : (
        signals.map((s, i) => (
          <View key={s.key} style={[styles.row, i > 0 && styles.rowDivider]}>
            <Text style={styles.headline}>{s.headline}</Text>
            <Text style={styles.detail}>{s.detail}</Text>
            {s.matchLine ? <Text style={styles.match}>{s.matchLine}</Text> : null}
            <TouchableOpacity
              style={styles.action}
              onPress={() => onAction(s.action)}
              accessibilityLabel={s.actionLabel}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{s.actionLabel} →</Text>
            </TouchableOpacity>
            {s.secondaryAction ? (
              <TouchableOpacity
                style={styles.action}
                onPress={() => onAction(s.secondaryAction)}
                accessibilityLabel={s.secondaryActionLabel}
                accessibilityRole="button"
              >
                <Text style={styles.actionText}>{s.secondaryActionLabel} →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.title, color: colors.textPrimary },
  window: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 14 },
  summary: { paddingBottom: spacing.sm, marginBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  row: { paddingVertical: spacing.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  headline: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  match: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  action: { alignSelf: 'flex-start', marginTop: spacing.sm },
  actionText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
