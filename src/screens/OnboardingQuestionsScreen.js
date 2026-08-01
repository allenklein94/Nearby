import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// This screen runs before signup — there's no account yet to save
// these answers to. They're held in AsyncStorage temporarily and
// picked up by CompleteProfileScreen once an account actually
// exists, the same pattern already used elsewhere in the app for
// state that needs to survive across this part of the flow.
export const ONBOARDING_ANSWERS_KEY = 'pending_onboarding_answers';

const MOTIVATIONS = [
  { icon: '👥', label: 'Meet new people' },
  { icon: '🎉', label: 'Find things to do' },
  { icon: '🤝', label: 'Make new friends' },
  { icon: '🏃', label: 'Find activity partners' },
  { icon: '🌎', label: 'Explore my city' },
  { icon: '💼', label: 'Network professionally' },
  { icon: '❤️', label: 'Go on dates' },
  { icon: '🌱', label: 'Get out more often' },
  { icon: '😊', label: 'Just curious' },
];

const COMFORT_LEVELS = [
  { value: 'one_on_one', label: 'I like one-on-one conversations' },
  { value: 'small_groups', label: 'Small groups' },
  { value: 'large_gatherings', label: 'Large gatherings' },
  { value: 'open', label: "I'm open to anything" },
];

const MONTHLY_INTERESTS = [
  { icon: '☕', label: 'Coffee' },
  { icon: '🍽️', label: 'Food' },
  { icon: '🥾', label: 'Hiking' },
  { icon: '🏐', label: 'Sports' },
  { icon: '🎲', label: 'Games' },
  { icon: '🎵', label: 'Music' },
  { icon: '📚', label: 'Books' },
  { icon: '🐶', label: 'Dog walks' },
  { icon: '🍻', label: 'Happy Hour' },
  { icon: '🎨', label: 'Art' },
];

// This month, not forever — deliberately not asking people to
// permanently define themselves before they've even used the app.
// These naturally get revisited over time rather than locking
// someone into a static identity from day one.

export default function OnboardingQuestionsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [step, setStep] = useState(0);
  const [motivations, setMotivations] = useState([]);
  const [comfortLevel, setComfortLevel] = useState(null);
  const [monthlyInterests, setMonthlyInterests] = useState([]);
  const [saving, setSaving] = useState(false);

  function toggleMotivation(label) {
    setMotivations((prev) => {
      if (prev.includes(label)) return prev.filter((m) => m !== label);
      if (prev.length >= 3) return prev;
      return [...prev, label];
    });
  }

  function toggleMonthlyInterest(label) {
    setMonthlyInterests((prev) => (prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]));
  }

  async function handleContinue() {
    if (step < 2) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    try {
      await AsyncStorage.setItem(
        ONBOARDING_ANSWERS_KEY,
        JSON.stringify({
          onboarding_motivations: motivations,
          social_comfort_level: comfortLevel,
          monthly_interests: monthlyInterests,
        })
      );
    } catch (e) {
      console.error('Failed to store onboarding answers', e);
      // Fails quietly — these are preference signals, not required
      // fields, and shouldn't block someone from continuing into
      // signup over a transient storage failure.
    }
    setSaving(false);
    navigation.navigate('OnboardingLocation');
  }

  const canContinue = step === 0 ? motivations.length > 0 : step === 1 ? !!comfortLevel : true;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
        {step === 0 && (
          <>
            <Text style={styles.title}>What brought you here today?</Text>
            <Text style={styles.subtitle}>Choose up to 3.</Text>
            <View style={styles.grid}>
              {MOTIVATIONS.map((m) => {
                const selected = motivations.includes(m.label);
                return (
                  <TouchableOpacity
                    key={m.label}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleMotivation(m.label)}
                    accessibilityLabel={m.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{m.icon}</Text>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>What sounds most like you?</Text>
            <View style={{ gap: spacing.sm }}>
              {COMFORT_LEVELS.map((c) => {
                const selected = comfortLevel === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => setComfortLevel(c.value)}
                    accessibilityLabel={c.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>What are you in the mood for this month?</Text>
            <View style={styles.grid}>
              {MONTHLY_INTERESTS.map((m) => {
                const selected = monthlyInterests.includes(m.label);
                return (
                  <TouchableOpacity
                    key={m.label}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleMonthlyInterest(m.label)}
                    accessibilityLabel={m.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{m.icon}</Text>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={[styles.button, !canContinue && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!canContinue || saving}
          activeOpacity={0.85}
          accessibilityLabel={saving ? 'Saving' : 'Continue'}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipIcon: { fontSize: 16, marginRight: 6 },
  chipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  chipTextSelected: { color: colors.primary },
  option: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  optionSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  optionText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  optionTextSelected: { color: colors.primary },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginHorizontal: 4 },
  dotActive: { backgroundColor: colors.primary, width: 20 },
  button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 18, alignItems: 'center', ...shadow.button },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});