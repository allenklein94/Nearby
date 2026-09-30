import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingTopBar from '../components/OnboardingTopBar';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { sanitizeInterestGroups } from '../constants/interestGraph';
import { categoryName, groupName } from '../i18n/categoryNames';
import { QUICK_INTERESTS, onboardingInterestSelection, migrateOnboardingDraft, savedOnboardingInterests, ONBOARDING_DRAFT_VERSION } from '../constants/onboardingInterests';
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
  { value: 'one_on_one' },
  { value: 'small_groups' },
  { value: 'large_gatherings' },
  { value: 'open' },
];

export default function OnboardingQuestionsScreen({ navigation }) {
  const { t, language } = useLanguage();
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
  // Selections carried over from the previous onboarding version's draft (never dropped; removable like any chip).
  const [earlierTags, setEarlierTags] = useState([]);
  const [earlierGroups, setEarlierGroups] = useState([]);
  const [earlierOff, setEarlierOff] = useState([]);
  const [saving, setSaving] = useState(false);

  const hydrated = useRef(false);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_DRAFT_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        // Old-format drafts (groupKeys/tags) are migrated, never discarded (constants/onboardingInterests.js).
        const d = migrateOnboardingDraft(JSON.parse(raw));
        setGoals(d.goals);
        setLookingFor(d.lookingFor);
        setComfortLevel(d.comfortLevel);
        setQuickKeys(d.quickKeys);
        setAnythingElse(d.anythingElse);
        setExcluded(d.excluded);
        setEarlierTags(d.earlierTags);
        setEarlierGroups(d.earlierGroups);
        setEarlierOff(d.earlierOff);
      })
      .catch(() => {})
      .finally(() => { hydrated.current = true; });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      v: ONBOARDING_DRAFT_VERSION, goals, lookingFor, comfortLevel, quickKeys, anythingElse, excluded, earlierTags, earlierGroups, earlierOff,
    })).catch(() => {});
  }, [goals, lookingFor, comfortLevel, quickKeys, anythingElse, excluded, earlierTags, earlierGroups, earlierOff]);

  function toggleGoal(label) {
    setGoals((prev) => (prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]));
  }

  function toggleQuick(key) {
    setQuickKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // What will be saved: the quick picks + the words, mapped to canonical tags/groups, minus anything tapped off.
  // One function decides what is saved (quick picks + kept earlier selections + kept words).
  const extraOnly = onboardingInterestSelection([], anythingElse);
  const { tags: savedTags, groups: savedGroups } = savedOnboardingInterests({ quickKeys, anythingElse, excluded, earlierTags, earlierGroups, earlierOff });
  const earlierItems = [...earlierTags.map((tag) => ({ key: tag, label: categoryName(tag, language) })), ...earlierGroups.map((g) => ({ key: g, label: groupName(g, language) }))];
  const groupLabel = (key) => groupName(key, language);

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
            <Text style={styles.title}>{t('ui.onboarding.whatDoYouWantNearby')}</Text>
            <Text style={styles.subtitle}>{t('ui.onboarding.pickAnyThatFit')}</Text>
            <View style={{ gap: spacing.sm }}>
              {ONBOARDING_GOALS.map((g) => {
                const selected = goals.includes(g.label);
                return (
                  <TouchableOpacity
                    key={g.key}
                    style={[styles.option, styles.optionRow, selected && styles.optionSelected]}
                    onPress={() => toggleGoal(g.label)}
                    accessibilityLabel={t(`ui.onboarding.goal.${g.key}`)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={styles.optionIcon}>{selected ? '☑' : '☐'}</Text>
                    <Text style={styles.chipIcon}>{g.icon}</Text>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{t(`ui.onboarding.goal.${g.key}`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'interests' && (
          <>
            <Text style={styles.title}>{t('ui.onboarding.whatAreYouInto')}</Text>
            <Text style={styles.subtitle}>{t('ui.onboarding.chooseAFewYouCan')}</Text>
            <View style={styles.grid}>
              {QUICK_INTERESTS.map((q) => {
                const selected = quickKeys.includes(q.key);
                return (
                  <TouchableOpacity
                    key={q.key}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleQuick(q.key)}
                    accessibilityLabel={t(`ui.onboarding.quick.${q.key}`)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{q.icon}</Text>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`ui.onboarding.quick.${q.key}`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {earlierItems.length > 0 && (
              <>
                <Text style={styles.understoodLabel}>{t('ui.onboarding.youPickedTheseEarlierTap')}</Text>
                <View style={styles.grid}>
                  {earlierItems.map((item) => {
                    const kept = !earlierOff.includes(item.key);
                    return (
                      <TouchableOpacity
                        key={`earlier-${item.key}`}
                        style={[styles.chip, kept && styles.chipSelected]}
                        onPress={() => setEarlierOff((prev) => (kept ? [...prev, item.key] : prev.filter((k) => k !== item.key)))}
                        accessibilityLabel={kept ? t('ui.onboarding.keptTapToLeaveItA11y', { label: item.label }) : t('ui.onboarding.leftOutA11y', { label: item.label })}
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
          </>
        )}

        {step === 'anythingElse' && (
          <>
            <Text style={styles.title}>{t('ui.onboarding.anythingElse')}</Text>
            <Text style={styles.subtitle}>{t('ui.onboarding.optionalTypeAFewThings')}</Text>
            <TextInput
              style={styles.input}
              value={anythingElse}
              onChangeText={(text) => { setAnythingElse(text); setExcluded([]); }}
              placeholder={t('ui.onboarding.anythingElseYoureInto')}
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={200}
              accessibilityLabel={t('ui.onboarding.anythingElseYoureIntoA11y')}
            />
            {(extraOnly.tags.length > 0 || extraOnly.groups.length > 0) && (
              <>
                <Text style={styles.understoodLabel}>{t('ui.onboarding.theseInterestsWillBeAdded')}</Text>
                <View style={styles.grid}>
                  {[...extraOnly.tags.map((tag) => ({ key: tag, label: categoryName(tag, language) })), ...extraOnly.groups.map((g) => ({ key: g, label: groupLabel(g) }))].map((item) => {
                    const kept = !excluded.includes(item.key);
                    return (
                      <TouchableOpacity
                        key={item.key}
                        style={[styles.chip, kept && styles.chipSelected]}
                        onPress={() => setExcluded((prev) => (kept ? [...prev, item.key] : prev.filter((k) => k !== item.key)))}
                        accessibilityLabel={kept ? t('ui.onboarding.addedTapToLeaveItA11y', { label: item.label }) : t('ui.onboarding.leftOutA11y', { label: item.label })}
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
                {t('ui.onboarding.notMatchedYetLine', { words: extraOnly.unmatched.join(', ') })}
              </Text>
            )}
          </>
        )}

        {step === 'lookingFor' && (
          <>
            <Text style={styles.title}>{t('ui.onboarding.whatAreYouLookingFor')}</Text>
            <Text style={styles.subtitle}>{t('ui.onboarding.thisJustDecidesWhatWe')}</Text>
            <View style={{ gap: spacing.sm }}>
              {LOOKING_FOR_OPTIONS.map((o) => {
                const selected = lookingFor === o.key;
                return (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.option, styles.optionRow, selected && styles.optionSelected]}
                    onPress={() => setLookingFor(o.key)}
                    accessibilityLabel={t(`ui.onboarding.lookingFor.${o.key}`)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={styles.chipIcon}>{o.icon}</Text>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{t(`ui.onboarding.lookingFor.${o.key}`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {step === 'comfort' && (
          <>
            <Text style={styles.title}>{t('ui.onboarding.whatSoundsMostLikeYou')}</Text>
            <Text style={styles.subtitle}>
              {lookingFor === 'dating' || lookingFor === 'both'
                ? t('ui.onboarding.itHelpsUsSuggestThe')
                : t('ui.onboarding.itHelpsUsSuggestThe2')}
            </Text>
            <View style={{ gap: spacing.sm }}>
              {COMFORT_LEVELS.map((c) => {
                const selected = comfortLevel === c.value;
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => setComfortLevel(c.value)}
                    accessibilityLabel={t(`ui.onboarding.comfort.${c.value}`)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{t(`ui.onboarding.comfort.${c.value}`)}</Text>
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
          accessibilityLabel={saving ? t('ui.onboarding.savingA11y') : t('ui.onboarding.continueA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{saving ? t('ui.onboarding.saving') : t('ui.onboarding.continue')}</Text>
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