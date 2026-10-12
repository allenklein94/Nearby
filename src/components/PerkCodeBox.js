import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { perkCodeMessage } from '../utils/perkRedemptionState';

// The claimed-perk code box (utils/perkRedemptionState.js 'claimed'): "Your code" + what to do with it. Shared by Discover's
// perk panel, a community's perks and a business profile's perks, so the code reads the same everywhere and is there again
// every time the perk is opened. Static: no animation, nothing waits.
export default function PerkCodeBox({ code, businessName = null, instructions = null, style = null }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const message = perkCodeMessage(t, { code, businessName, instructions });
  if (!message) return null;
  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceElevated }, style]} accessibilityLiveRegion="polite">
      <Text style={[styles.label, { color: colors.textTertiary }]}>{t('ui.brandOffersUi.yourCode')}</Text>
      <Text style={[styles.text, { color: colors.textPrimary }]} selectable>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  label: { ...typography.caption, marginBottom: spacing.xs },
  text: { ...typography.body },
});
