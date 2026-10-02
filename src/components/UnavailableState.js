import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, typography } from '../theme';
import { NearbyMark } from './brand';

// Item 139: the one "this is gone" state for a screen opened on an object that was deleted or is no longer visible (often
// from a push tap or a link). It never retries (nothing to retry) and never sends the person somewhere unrelated: Back
// returns to where they were; with no history (a cold start) it lands on Home, the only history there is.
export default function UnavailableState({ navigation, message }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const goBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else navigation?.navigate?.('MainTabs', { screen: 'Home' });
  };
  return (
    <View style={styles.container}>
      <NearbyMark size={28} style={styles.mark} />
      <Text style={styles.title}>{t('ui.shared.unavailable.title')}</Text>
      <Text style={styles.message}>{message ?? t('ui.shared.unavailable.message')}</Text>
      <TouchableOpacity style={styles.button} onPress={goBack} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('ui.shared.unavailable.back')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    container: { padding: spacing.xl, alignItems: 'center' },
    mark: { opacity: 0.35, marginBottom: spacing.sm },
    title: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
    message: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },
    button: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    buttonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  });
