import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

// Reversible navigation for every pre-account onboarding screen: nobody is
// trapped after tapping Get Started. "Back" pops to the previous screen (every
// screen's answers are kept: the stack keeps earlier screens mounted and the
// Questions/Notifications screens also persist drafts). "Sign in" is the
// persistent escape for someone who already has an account.
export default function OnboardingTopBar({ navigation, showSignIn = true, onBack }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const canGoBack = navigation.canGoBack();
  return (
    <View style={styles.row}>
      {canGoBack ? (
        <TouchableOpacity
          onPress={onBack ?? (() => navigation.goBack())}
          style={styles.hit}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
      ) : <View />}
      {showSignIn && (
        <TouchableOpacity
          onPress={() => navigation.navigate('Login')}
          style={styles.hit}
          accessibilityLabel="Already have an account? Sign in"
          accessibilityRole="button"
        >
          <Text style={styles.signIn}>Already have an account? <Text style={styles.signInStrong}>Sign in</Text></Text>
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
