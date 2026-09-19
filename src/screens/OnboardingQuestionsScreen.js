import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { ONBOARDING_INTEREST_GROUPS, tagsForGroups } from '../constants/interestGraph';
import { ONBOARDING_GOALS, LOOKING_FOR_OPTIONS, motivationsFromAnswers } from '../constants/onboardingGoals';

// This screen runs before signup — there's no account yet to save
// these answers to. They're held in AsyncStorage temporarily and
// picked up by CompleteProfileScreen once an account actually
// exists, the same pattern already used elsewhere in the app for
// state that needs to survive across this part of the flow.
export const ONBOARDING_ANSWERS_KEY = 'pending_onboarding_answers';

const COMFORT_LEVELS = [
  { value: 'one_on_one', label: 'I like one-on-one conversations' },
  { value: 'small_groups', label: 'Small groups' },
  { value: 'large_gatherings', label: 'Large gatherings' },
  { value: 'open', label: "I'm open to anything" },
];

export default function OnboardingQuestionsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [stepIndex, setStepIndex] = useState(0);
  const [goals, setGoals] = useState([]);
  const [lookingFor, setLookingFor] = useState(null);
  const [comfortLevel, setComfortLevel] = useState(null);
  const [groupKeys, setGroupKeys] = useState([]);
  const [tags, setTags] = useState([]);
  const [saving, setSaving] = useState(false);

  function toggleGoal(label) {
    setGoals((prev) => (prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]));
  }

  function toggleGroup(key) {
    const next = groupKeys.includes(key) ? groupKeys.filter((k) => k !== key) : [...groupKeys, key];
    setGroupKeys(next);
    // Drop any picked tag whose group was just deselected.
    const allowed = new Set(tagsForGroups(next));
    setTags((t) => t.filter((x) => allowed.has(x)));
  }

  function toggleTag(tag) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Flow: what Nearby should help with -> what you're into (-> favorites, only if a group was picked) -> what you're looking for
  // -> relevant preferences. Every step is skippable; nothing here gates signup.
  const steps = ['goals', 'groups', ...(groupKeys.length > 0 ? ['tags'] : []), 'lookingFor', 'comfort'];
  const step = steps[stepIndex];
  const lastStep = steps.length - 1;

  async function handleContinue() {
    if (stepIndex < lastStep) {
      setStepIndex((i) => i + 1);
      return;
    }
    setSaving(true);
    try {
      await AsyncStorage.setItem(
        ONBOARDING_ANSWERS_KEY,
        JSON.stringify({
          onboarding_motivations: motivationsFromAnswers({ goals, lookingFor }),
          social_comfort_level: comfortLevel,
          // Canonical tags (see interestGraph.js): seed CompleteProfile's interests step and this
          // month's mood, so onboarding never introduces a vocabulary of its own.
          monthly_interests: tags,
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

  const canContinue = true; // every step is skippable

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
        {step === 'goals' && (
          <>
            <Text style={styles.title}>What do you want Nearby to help you do?</Text>
            <Text style={styles.subtitle}>Pick any that fit.</Text>
            <View style={{ gap: spacing.sm }}>
              {ONBOARDING_GOALS.map((g) => {
                const selected = goals.includes(g.label);
                return (
                  <TouchableOpacity
                    key={g.key}
                    style={[styles.option, styles.optionRow, selected && styles.optionSelected]}
                    onPress={() => toggleGoal(g.label)}
                    accessibilityLabel={g.label}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={styles.optionIcon}>{selected ? '☑' : '☐'}</Text>
                    <Text style={styles.chipIcon}>{g.icon}</Text>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'groups' && (
          <>
            <Text style={styles.title}>What are you into?</Text>
            <Text style={styles.subtitle}>Pick any that fit — you can skip this.</Text>
            <View style={styles.grid}>
              {ONBOARDING_INTEREST_GROUPS.map((g) => {
                const selected = groupKeys.includes(g.key);
                return (
                  <TouchableOpacity
                    key={g.key}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleGroup(g.key)}
                    accessibilityLabel={g.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{g.icon}</Text>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'tags' && (
          <>
            <Text style={styles.title}>Any favorites?</Text>
            <Text style={styles.subtitle}>Optional — the more specific, the better we can find things for you.</Text>
            <View style={styles.grid}>
              {tagsForGroups(groupKeys).map((tag) => {
                const selected = tags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleTag(tag)}
                    accessibilityLabel={tag}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'lookingFor' && (
          <>
            <Text style={styles.title}>What are you looking for?</Text>
            <Text style={styles.subtitle}>This just decides what we show you first. You can change it any time.</Text>
            <View style={{ gap: spacing.sm }}>
              {LOOKING_FOR_OPTIONS.map((o) => {
                const selected = lookingFor === o.key;
                return (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.option, styles.optionRow, selected && styles.optionSelected]}
                    onPress={() => setLookingFor(o.key)}
                    accessibilityLabel={o.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{o.icon}</Text>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'comfort' && (
          <>
            <Text style={styles.title}>What sounds most like you?</Text>
            <Text style={styles.subtitle}>
              {lookingFor === 'dating' || lookingFor === 'both'
                ? "It helps us suggest the right kind of plans. You can fine-tune dating preferences later, when you first open Dating."
                : 'It helps us suggest the right kind of plans. Optional.'}
            </Text>
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
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {Array.from({ length: lastStep + 1 }, (_, i) => i).map((i) => (
            <View key={i} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>
        {stepIndex > 0 && (
          <TouchableOpacity onPress={() => setStepIndex((i) => i - 1)} style={styles.backLink} accessibilityLabel="Back" accessibilityRole="button">
            <Text style={styles.backLinkText}>Back</Text>
          </TouchableOpacity>
        )}
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
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  optionIcon: { fontSize: 18, marginRight: spacing.sm, color: colors.primary },
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
  backLink: { alignSelf: 'center', paddingVertical: spacing.sm, marginBottom: spacing.xs },
  backLinkText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});