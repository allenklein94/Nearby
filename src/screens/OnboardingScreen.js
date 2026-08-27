import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import NearbyMark from '../components/brand/NearbyMark';

// Deliberately sells the outcome, not the features — "your next
// favorite memory" rather than a feature-by-feature carousel
// explaining notifications, privacy, discovery, etc. Whatever
// someone needs to know about those, they'll learn by using the
// app; the first thing they should feel is anticipation, not
// paperwork.
export default function OnboardingScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <NearbyMark size={88} style={styles.mark} />
        <Text style={styles.headline}>Your next favorite memory could start today.</Text>
        <Text style={styles.subtext}>Meet people, discover gatherings, and create experiences together.</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('OnboardingQuestions')}
          activeOpacity={0.85}
          accessibilityLabel="Get Started"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
          accessibilityLabel="I already have an account"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>I already have an account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  mark: { marginBottom: spacing.xl },
  headline: { ...typography.display, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  subtext: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 18, alignItems: 'center', ...shadow.button },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondaryButton: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryButtonText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});