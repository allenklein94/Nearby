import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { spacing, radius, typography } from '../theme';

// Wording lives in ui.confidenceBanner.<reason>.{title,text}.
const MESSAGES = {
  heavy_outreach: { emoji: '💛' },
  analysis_paralysis: { emoji: '🌱' },
  heavy_browsing: { emoji: '💛' },
};

export default function ConfidenceModeBanner({ reason, onDismiss }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const key = MESSAGES[reason] ? reason : 'heavy_outreach';
  const content = MESSAGES[key];

  return (
    <View style={styles.banner}>
      <Text style={styles.emoji}>{content.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t(`ui.confidenceBanner.${key}.title`)}</Text>
        <Text style={styles.text}>{t(`ui.confidenceBanner.${key}.text`)}</Text>
      </View>
      <TouchableOpacity onPress={onDismiss} style={styles.dismissButton} accessibilityRole="button" accessibilityLabel={t('ui.confidenceBanner.dismissA11y')}>
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg,
    padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  emoji: { fontSize: 24, marginRight: spacing.sm },
  title: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: 4 },
  text: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  dismissButton: { padding: spacing.xs },
  dismissText: { color: colors.textTertiary, fontSize: 16 },
});