import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import { dismissedLineKey } from '../utils/notInterested';

// "Not interested" (owner idea "153"; rules in utils/notInterested.js, state in hooks/useNotInterested.js). Item 200's narrow
// exception: a quiet ⋯ beside the card's one action, ONE inline row under the card, and the line that replaces it.
// Static: nothing here animates (no entrance, exit, collapse or layout animation).

export function NotInterestedMore({ title, open, onPress, color }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!open }}
      accessibilityLabel={t('ui.notInterested.moreA11y', { title })}
      testID="not-interested-more"
    >
      <Text style={[styles.more, { color: color ?? colors.textTertiary }]}>⋯</Text>
    </TouchableOpacity>
  );
}

export function NotInterestedRow({ title, onPress }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <TouchableOpacity
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('ui.notInterested.actionA11y', { title })}
        testID="not-interested-action"
      >
        <Text style={[styles.rowText, { color: colors.textSecondary }]}>{t('ui.notInterested.action')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function NotInterestedLine({ title, kindDownRanked, onUndo, style }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  return (
    <View style={[styles.line, { borderColor: colors.border }, style]} accessibilityLiveRegion="polite">
      <Text style={[styles.lineText, { color: colors.textSecondary }]}>{t(dismissedLineKey(kindDownRanked))}</Text>
      <TouchableOpacity
        onPress={onUndo}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('ui.notInterested.undoA11y', { title })}
        testID="not-interested-undo"
      >
        <Text style={[styles.undo, { color: colors.primary }]}>{t('ui.notInterested.undo')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  more: { fontSize: 18, fontWeight: '700', paddingHorizontal: spacing.xs },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: 'flex-start' },
  rowText: { fontSize: 14, fontWeight: '600' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginBottom: spacing.sm },
  lineText: { flex: 1, fontSize: 14 },
  undo: { fontSize: 14, fontWeight: '700' },
});
