import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { colors, typography, spacing, radius, shadow } from '../theme';

export default function OnboardingScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>18+</Text>
        </View>

        <Text style={styles.title}>Nearby</Text>
        <Text style={styles.subtitle}>
          You've probably noticed someone nearby you wanted to talk to,
          but didn't. Nearby gives you a low-pressure way to let them
          know — and only if they feel the same way, you both find out.
        </Text>

        <View style={styles.stepsCard}>
          <View style={styles.step}>
            <View style={styles.stepNumWrap}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.stepText}>You cross paths with someone using the app</Text>
          </View>
          <View style={styles.stepDivider} />
          <View style={styles.step}>
            <View style={styles.stepNumWrap}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={styles.stepText}>If you're interested, send a silent "Notice"</Text>
          </View>
          <View style={styles.stepDivider} />
          <View style={styles.step}>
            <View style={styles.stepNumWrap}>
              <Text style={styles.stepNum}>3</Text>
            </View>
            <Text style={styles.stepText}>Nothing happens unless they notice you too</Text>
          </View>
        </View>

        <Text style={styles.privacyNote}>
          🔒 Your exact location is never shown to other users. No one
          can see who you've noticed unless it's mutual.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Login')}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>Get Started</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
  },
  content: { marginTop: spacing.xl },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginBottom: spacing.md,
  },
  badgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  stepsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  stepNumWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  stepNum: { color: '#fff', fontWeight: '700', fontSize: 14 },
  stepText: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  privacyNote: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.lg,
    lineHeight: 18,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadow.button,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});