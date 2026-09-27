import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingTopBar from '../components/OnboardingTopBar';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { sanitizeInterestGroups } from '../constants/interestGraph';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { QUICK_INTERESTS, onboardingInterestSelection } from '../constants/onboardingInterests';
import { ONBOARDING_GOALS, LOOKING_FOR_OPTIONS, motivationsFromAnswers } from '../constants/onboardingGoals';

// This screen runs before signup — there's no account yet to save
// these answers to. They're held in AsyncStorage temporarily and
// picked up by CompleteProfileScreen once an account actually
// exists, the same pattern already used elsewhere in the app for
// state that needs to survive across this part of the flow.
export const ONBOARDING_ANSWERS_KEY = 'pending_onboarding_answers';
// Raw in-progress selections, so going Back out of onboarding and returning never loses them.
// Removed with the answers key once the account is created (CompleteProfileScreen).
export const ONBOARDING_DRAFT_KEY = 'pending_onboarding_questions_draft';

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
  // Item 94: a few quick picks + optional words, both mapped onto the one taxonomy (constants/onboardingInterests.js).
  const [quickKeys, setQuickKeys] = useState([]);
  const [anythingElse, setAnythingElse] = useState('');
  const [excluded, setExcluded] = useState([]); // understood items the person tapped off (tags or group keys)
  const [saving, setSaving] = useState(false);

  const hydrated = useRef(false);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_DRAFT_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const d = JSON.parse(raw);
        if (Array.isArray(d.goals)) setGoals(d.goals);
        if (typeof d.lookingFor === 'string') setLookingFor(d.lookingFor);
        if (typeof d.comfortLevel === 'string') setComfortLevel(d.comfortLevel);
        if (Array.isArray(d.quickKeys)) setQuickKeys(d.quickKeys.filter((k) => QUICK_INTERESTS.some((q) => q.key === k)));
        if (typeof d.anythingElse === 'string') setAnythingElse(d.anythingElse);
        if (Array.isArray(d.excluded)) setExcluded(d.excluded);
      })
      .catch(() => {})
      .finally(() => { hydrated.current = true; });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ goals, lookingFor, comfortLevel, quickKeys, anythingElse, excluded })).catch(() => {});
  }, [goals, lookingFor, comfortLevel, quickKeys, anythingElse, excluded]);

  function toggleGoal(label) {
    setGoals((prev) => (prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]));
  }

  function toggleQuick(key) {
    setQuickKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // What will be saved: the quick picks + the words, mapped to canonical tags/groups, minus anything tapped off.
  // A tap-off only removes what the WORDS added; a quick pick stays picked.
  const quickOnly = onboardingInterestSelection(quickKeys, '');
  const extraOnly = onboardingInterestSelection([], anythingElse);
  const savedTags = [...new Set([...quickOnly.tags, ...extraOnly.tags.filter((t) => !excluded.includes(t))])];
  const savedGroups = [...new Set([...quickOnly.groups, ...extraOnly.groups.filter((g) => !excluded.includes(g))])];
  const groupLabel = (key) => CATEGORY_GROUPS.find((g) => g.key === key)?.label ?? key;

  // Flow: what Nearby should help with -> what you're into (a few quick picks) -> anything else (optional words) -> what
  // you're looking for -> relevant preferences. Every step is skippable; nothing here gates signup.
  const steps = ['goals', 'interests', 'anythingElse', 'lookingFor', 'comfort'];
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
          monthly_interests: savedTags,
          // Broad interest: a whole area (Outdoors, Arts, or a group named in the words); never expanded into tags.
          interest_groups: sanitizeInterestGroups(savedGroups),
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
      <OnboardingTopBar navigation={navigation} onBack={stepIndex > 0 ? () => setStepIndex((i) => i - 1) : undefined} />
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

        {step === 'interests' && (
          <>
            <Text style={styles.title}>What are you into?</Text>
            <Text style={styles.subtitle}>Choose a few. You can skip this.</Text>
            <View style={styles.grid}>
              {QUICK_INTERESTS.map((q) => {
                const selected = quickKeys.includes(q.key);
                return (
                  <TouchableOpacity
                    key={q.key}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleQuick(q.key)}
                    accessibilityLabel={q.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{q.icon}</Text>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{q.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'anythingElse' && (
          <>
            <Text style={styles.title}>Anything else?</Text>
            <Text style={styles.subtitle}>Optional. Type a few things you like, like "pickleball, board games, hiking".</Text>
            <TextInput
              style={styles.input}
              value={anythingElse}
              onChangeText={(t) => { setAnythingElse(t); setExcluded([]); }}
              placeholder="Anything else you're into"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={200}
              accessibilityLabel="Anything else you're into"
            />
            {(extraOnly.tags.length > 0 || extraOnly.groups.length > 0) && (
              <>
                <Text style={styles.understoodLabel}>We'll add these. Tap one to leave it out.</Text>
                <View style={styles.grid}>
                  {[...extraOnly.tags.map((t) => ({ key: t, label: t })), ...extraOnly.groups.map((g) => ({ key: g, label: groupLabel(g) }))].map((item) => {
                    const kept = !excluded.includes(item.key);
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.chip, kept && styles.chipSelected]}
                        onPress={() => setExcluded((prev) => (kept ? [...prev, item.key] : prev.filter((k) => k !== item.key)))}
                        accessibilityLabel={kept ? `${item.label}, added. Tap to leave it out` : `${item.label}, left out`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: kept }}
                      >
                        <Text style={[styles.chipText, kept && styles.chipTextSelected]}>{kept ? `${item.label} ✓` : item.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
            {extraOnly.unmatched.length > 0 && (
              <Text style={styles.unmatchedNote}>
                Not matched yet: {extraOnly.unmatched.join(', ')}. You can add interests any time in Settings.
              </Text>
            )}
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
  input: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 72, color: colors.textPrimary, fontSize: 15, textAlignVertical: 'top',
  },
  understoodLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md },
  unmatchedNote: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md },
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