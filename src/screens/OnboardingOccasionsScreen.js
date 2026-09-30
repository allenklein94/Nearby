import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { OCCASION_OPTIONS, ONBOARDING_OCCASION_KEYS } from '../constants/businessAttributes';
import { occasionName } from '../i18n/categoryNames';

// Nothing is created here: a tile just opens the existing add-occasion form with that type preselected.

export default function OnboardingOccasionsScreen({ navigation }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const tiles = ONBOARDING_OCCASION_KEYS.map((k) => OCCASION_OPTIONS.find((o) => o.key === k)).filter(Boolean);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1, justifyContent: 'center' }}>
        <Text style={styles.title}>{t('ui.onboarding.anyDatesWorthRemembering')}</Text>
        <Text style={styles.subtitle}>{t('ui.onboarding.nearbyCanRemindYouAhead')}</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {tiles.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={styles.option}
              onPress={() => navigation.navigate('Occasions', { presetType: o.key })}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('ui.onboarding.addAA11y', { label: occasionName(o.key, language) })}
            >
              <Text style={styles.optionIcon}>{o.icon}</Text>
              <Text style={styles.optionText}>{occasionName(o.key, language)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={styles.skip}
          onPress={() => navigation.navigate('MainTabs')}
          accessibilityRole="button"
          accessibilityLabel={t('ui.onboarding.skipForNowA11y')}
        >
          <Text style={styles.skipText}>{t('ui.onboarding.skipForNow')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card,
  },
  optionIcon: { fontSize: 24, marginRight: spacing.md },
  optionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  skip: { alignItems: 'center', padding: spacing.md, marginTop: spacing.md },
  skipText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
