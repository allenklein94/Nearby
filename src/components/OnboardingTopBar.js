import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

// Reversible navigation for every pre-account onboarding screen: nobody is
// trapped after tapping Get Started. "Back" pops to the previous screen (every
// screen's answers are kept: the stack keeps earlier screens mounted and the
// Questions/Notifications screens also persist drafts). "Sign in" is the
// persistent escape for someone who already has an account.
export default function OnboardingTopBar({ navigation, showSignIn = true, onBack }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const canGoBack = navigation.canGoBack();
  return (
    <View style={styles.row}>
      {canGoBack ? (
        <TouchableOpacity
          onPress={onBack ?? (() => navigation.goBack())}
          style={styles.hit}
          accessibilityLabel={t('ui.shared.onboarding.back')}
          accessibilityRole="button"
        >
          <Text style={styles.back}>{t('ui.shared.onboarding.backArrow')}</Text>
        </TouchableOpacity>
      ) : <View />}
      {showSignIn && (
        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={styles.hit}
          accessibilityLabel={t('ui.shared.onboarding.signInA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.signIn}>{t('ui.shared.onboarding.haveAccount')} <Text style={styles.signInStrong}>{t('ui.shared.onboarding.signIn')}</Text></Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  hit: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  back: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  signIn: { color: colors.textTertiary, fontSize: 13 },
  signInStrong: { color: colors.primary, fontWeight: '700' },
});
