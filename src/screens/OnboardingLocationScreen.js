import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import * as Location from 'expo-location';
import OnboardingTopBar from '../components/OnboardingTopBar';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function OnboardingLocationScreen({ navigation }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [requesting, setRequesting] = useState(false);

  // One honest ask. The old three options ("Near me" / "Around my city" / "I'm traveling") all did the same thing -- the
  // choice was never stored or read by anything -- so they're gone. Location is asked once and used everywhere
  // (userLocation.js); declining just continues, and the permission can be granted later where it's needed.
  async function handleAllow() {
    setRequesting(true);
    await Location.requestForegroundPermissionsAsync().catch(() => null);
    setRequesting(false);
    navigation.navigate('OnboardingNotifications');
  }

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingTopBar navigation={navigation} />
      <View style={styles.content}>
        <Text style={styles.title}>{t('ui.onboarding.findWhatsHappeningNearYou')}</Text>
        <Text style={styles.subtitle}>{t('ui.onboarding.nearbyUsesYourLocationTo')}</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <TouchableOpacity
            style={styles.primary}
            onPress={handleAllow}
            disabled={requesting}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.onboarding.useMyLocationA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('ui.onboarding.useMyLocation')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('OnboardingNotifications')}
            disabled={requesting}
            style={styles.skip}
            accessibilityLabel={t('ui.onboarding.notNowA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>{t('ui.onboarding.notNow')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  primary: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  primaryText: { ...typography.body, color: '#fff', fontWeight: '700' },
  skip: { padding: spacing.md, alignItems: 'center' },
  skipText: { ...typography.body, color: colors.textSecondary },
});
