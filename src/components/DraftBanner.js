import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { displayAgo } from '../i18n/display';
import { useLanguage } from '../context/LanguageContext';

// "You have an unfinished draft" -> Continue editing / Start over (item 82).
export default function DraftBanner({ savedAt, what = 'draft', onContinue, onDiscard, style }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const ago = savedAt ? displayAgo(new Date(savedAt).toISOString(), language) : null;
  const lead = t(`ui.shared.draft.${['gathering', 'request', 'offer'].includes(what) ? what : 'draft'}`);
  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{lead}{ago ? ` ${t('ui.shared.draft.savedAgo', { ago })}` : ''}</Text>
      <View style={styles.row}>
        <TouchableOpacity onPress={onContinue} accessibilityRole="button" accessibilityLabel={t('ui.shared.draft.continue')}>
          <Text style={[styles.primary, { color: colors.primary }]}>{t('ui.shared.draft.continue')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDiscard} accessibilityRole="button" accessibilityLabel={t('ui.shared.draft.startOver')}>
          <Text style={[styles.secondary, { color: colors.textSecondary }]}>{t('ui.shared.draft.startOver')}</Text>
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
