import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Linking, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const PRIVACY_URL = 'https://allenklein94.github.io/Nearby/privacy.html';
const TERMS_URL = 'https://allenklein94.github.io/Nearby/terms.html';

const OPEN_SOURCE_LIBRARIES = [
  { name: 'React Native', license: 'MIT' },
  { name: 'Expo', license: 'MIT' },
  { name: 'Supabase JS', license: 'MIT' },
  { name: 'React Navigation', license: 'MIT' },
  { name: 'react-native-purchases (RevenueCat)', license: 'MIT' },
  { name: 'Sentry React Native', license: 'MIT' },
  { name: 'PostHog React Native', license: 'MIT' },
  { name: 'expo-image-picker', license: 'MIT' },
  { name: 'expo-location', license: 'MIT' },
  { name: 'expo-notifications', license: 'MIT' },
  { name: 'expo-haptics', license: 'MIT' },
  { name: '@react-native-community/datetimepicker', license: 'MIT' },
];

export default function LegalScreen() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.sectionLabel} accessibilityRole="header">{t('legal.legalSection')}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL(PRIVACY_URL)}
            accessibilityLabel={t('legal.privacyPolicy')}
            accessibilityRole="link"
          >
            <Text style={styles.rowText}>{t('legal.privacyPolicy')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL(TERMS_URL)}
            accessibilityLabel={t('legal.termsOfService')}
            accessibilityRole="link"
          >
            <Text style={styles.rowText}>{t('legal.termsOfService')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('legal.privacyChoices')}</Text>
        <View style={styles.card}>
          <Text style={styles.bodyText}>{t('legal.privacyChoicesText')}</Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('legal.openSourceLicenses')}</Text>
        <View style={styles.card}>
          {OPEN_SOURCE_LIBRARIES.map((lib, i) => (
            <View
              key={lib.name}
              style={[styles.licenseRow, i > 0 && styles.divider]}
              accessibilityLabel={`${lib.name}, ${lib.license} license`}
            >
              <Text style={styles.rowText}>{lib.name}</Text>
              <Text style={styles.licenseText}>{lib.license}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, marginBottom: spacing.md, overflow: 'hidden',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  rowText: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  chevron: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border },
  bodyText: { ...typography.body, color: colors.textSecondary, padding: spacing.md, lineHeight: 20 },
  licenseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md },
  licenseText: { color: colors.textTertiary, fontSize: 13 },
});