import React, { useState, useEffect, useRef } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, Image, Platform, Linking, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mutesFromOnboardingChoices } from '../constants/notificationPreferences';
import { ONBOARDING_ANSWERS_KEY, ONBOARDING_DRAFT_KEY } from './OnboardingQuestionsScreen';
import { canonicalizeInterests, sanitizeInterestGroups } from '../constants/interestGraph';
import { pickProfilePhoto, uploadProfilePhoto } from '../services/photos';
import { checkTextModeration } from '../services/textModeration';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { QUICK_INTEREST_TAGS } from '../constants/onboardingInterests';
import { categoryName } from '../i18n/categoryNames';
import { typography, spacing, radius } from '../theme';

const MIN_AGE = 18;
const TERMS_URL = 'https://allenklein94.github.io/Nearby/terms.html';
const PRIVACY_URL = 'https://allenklein94.github.io/Nearby/privacy.html';
// Scoped per signed-in account (not a single global key) so a sign-out and
// a different real account signing in on the same device never inherits a
// stranger's typed name/birthdate/interests — the whole point of
// persisting this is "the SAME account picks up where they left off"
// (matches the Sign Out safety valve's own "come back and finish anytime"
// promise), not a shared draft. photoAsset is deliberately never
// persisted — a picked-image URI/asset reference is a local file handle
// that isn't reliably valid across a real app restart, so restoring one
// could silently produce a broken "photo picked but won't load" state on
// a required field. Restoring caps the step at the photo step instead of
// wherever the user actually was, so a returning user never lands past a
// step whose required data (the photo) genuinely wasn't saved.
function wizardDraftKey(userId) {
  return `complete_profile_wizard_draft:${userId}`;
}

// One decision per screen, matching the same "required fields, split
// across deliberate steps" philosophy Create 2.0 already proved out for
// gathering creation -- required-ness is unchanged (every step still
// gates Next, nothing here became skippable), only the "one giant form"
// shape changed. Terms consent deliberately lives on the last step
// alongside Interests rather than getting its own step, per direct
// instruction -- it's a short checkbox, not a decision that needs its
// own screen. See CLAUDE.md's Aug 22 2026 entry for the full reasoning.
const STEP_DEFS = [
  { key: 'about' },
  { key: 'photo' },
  { key: 'interests' },
];

function calculateAge(birthdate) {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

export default function CompleteProfileScreen() {
  const { refreshProfile } = useAuth();
  const { colors, isDark } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors);
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [photoAsset, setPhotoAsset] = useState(null);
  const [interests, setInterests] = useState([]);
  // Item 94: the interests step never lists the whole taxonomy. It confirms what the person already chose (onboarding or a
  // saved draft) and offers the same short quick list; the long tail lives in Settings.
  const [knownInterests, setKnownInterests] = useState([]);
  const interestChoices = [...new Set([...knownInterests, ...QUICK_INTEREST_TAGS])];
  const [submitting, setSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const draftKeyRef = useRef(null);
  const restoredRef = useRef(false);

  const stepKey = STEP_DEFS[step].key;
  const maxSelectableDate = new Date();
  maxSelectableDate.setFullYear(maxSelectableDate.getFullYear() - MIN_AGE);

  // Restore once, on mount — a returning user (closed the app mid-wizard,
  // or used the Sign Out safety valve and signed back in) picks up where
  // they left off instead of retyping everything from scratch.
  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        if (!userId) return;
        draftKeyRef.current = wizardDraftKey(userId);
        const stored = await AsyncStorage.getItem(draftKeyRef.current);
        let restoredInterests = false;
        if (stored) {
          const draft = JSON.parse(stored);
          if (draft.displayName) setDisplayName(draft.displayName);
          if (draft.birthdateIso) setBirthdate(new Date(draft.birthdateIso));
          if (Array.isArray(draft.interests) && draft.interests.length) { setInterests(draft.interests); setKnownInterests(draft.interests); restoredInterests = true; }
          if (draft.agreedToTerms) setAgreedToTerms(true);
          if (typeof draft.step === 'number') {
            const photoStepIndex = STEP_DEFS.findIndex((s) => s.key === 'photo');
            setStep(Math.min(draft.step, photoStepIndex));
          }
        }
        // Seed the interests step from what onboarding already asked (shown for confirmation, the
        // user still edits/confirms before it's saved) so nobody re-states their interests.
        if (!restoredInterests) {
          const pending = await AsyncStorage.getItem(ONBOARDING_ANSWERS_KEY);
          const seeded = canonicalizeInterests(pending ? JSON.parse(pending).monthly_interests : []);
          if (seeded.length) { setInterests(seeded); setKnownInterests(seeded); }
        }
      } catch (e) {
        console.error('Failed to restore profile wizard draft', e);
      } finally {
        restoredRef.current = true;
      }
    })();
  }, []);

  // Save after every change — not just on Next — so even closing the app
  // mid-step (before Next is ever tapped) doesn't lose what was typed.
  // Skipped until restore has actually run, so a fresh mount's own
  // still-empty initial state can't overwrite a real saved draft a beat
  // before it's read back in.
  useEffect(() => {
    if (!draftKeyRef.current || !restoredRef.current) return;
    const draft = { step, displayName, birthdateIso: birthdate ? birthdate.toISOString() : null, interests, agreedToTerms };
    AsyncStorage.setItem(draftKeyRef.current, JSON.stringify(draft)).catch(() => null);
  }, [step, displayName, birthdate, interests, agreedToTerms]);

  function toggleInterest(interest) {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  }

  async function choosePhoto() {
    try {
      const asset = await pickProfilePhoto();
      if (asset) setPhotoAsset(asset);
    } catch (e) {
      Alert.alert(t('ui.onboarding.couldnTAccessPhotos'), e.message);
    }
  }

  // Required-gate safety valve: this screen must stay required (no way to
  // skip profile setup), but that's not the same as trapping someone here.
  // Signing out never marks onboarding complete and never touches the
  // profile row — it's purely Authenticated+Setup-Required ->
  // Signed-Out, so nothing is lost and setup picks up again on the
  // account's next real sign-in. Always reachable, regardless of step.
  function handleSignOut() {
    Alert.alert(
      t('ui.onboarding.signOut'),
      t('ui.onboarding.youCanComeBackAnd'),
      [
        { text: t('ui.onboarding.cancel'), style: 'cancel' },
        { text: t('ui.onboarding.signOut2'), style: 'destructive', onPress: () => { supabase.auth.signOut(); } },
      ]
    );
  }

  function goNext() {
    if (stepKey === 'about') {
      if (!displayName.trim()) {
        return Alert.alert(t('ui.onboarding.nameRequired'), t('ui.onboarding.enterADisplayName'));
      }
      if (!birthdate) {
        return Alert.alert(t('ui.onboarding.birthdateRequired'), t('ui.onboarding.thisAppIs18Only'));
      }
      const age = calculateAge(birthdate);
      if (age < MIN_AGE) {
        return Alert.alert(t('ui.onboarding.ageRequirementNotMet'), t('ui.onboarding.youMustBe18Or'));
      }
    }
    if (stepKey === 'photo' && !photoAsset) {
      return Alert.alert(t('ui.onboarding.photoRequired'), t('ui.onboarding.addAProfilePhotoTo'));
    }
    setStep((s) => Math.min(s + 1, STEP_DEFS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (!agreedToTerms) {
      return Alert.alert(t('ui.onboarding.agreementRequired'), t('ui.onboarding.youMustAgreeToThe'));
    }

    const nameCheck = await checkTextModeration(displayName);
    if (!nameCheck.safe) {
      return Alert.alert(t('ui.onboarding.displayNameNotAllowed'), t('ui.onboarding.pleaseChooseADifferentDisplay'));
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      // Picks up whatever was answered during the pre-signup onboarding
      // questions, if any exist — someone could reach this screen
      // without having gone through that flow (e.g., an existing
      // account somehow ending up here), so this is genuinely optional.
      let onboardingAnswers = {};
      try {
        await AsyncStorage.removeItem(ONBOARDING_DRAFT_KEY);
        const stored = await AsyncStorage.getItem(ONBOARDING_ANSWERS_KEY);
        if (stored) {
          onboardingAnswers = JSON.parse(stored);
          await AsyncStorage.removeItem(ONBOARDING_ANSWERS_KEY);
        }
      } catch (e) {
        console.error('Failed to read onboarding answers', e);
      }

      // Sep 3 2026 ("global onboarding -> product wiring" master plan,
      // CLAUDE.md, Phase A): onboarding_motivations was a real, confirmed
      // orphaned field before this pass -- captured here at signup, then
      // never read by anything downstream, anywhere in the app (grepped
      // for it before writing this). Closing the one honest, bounded,
      // explicit-consent consumption of it: choosing "Make new friends" as
      // one of up to 3 motivations *is* the same explicit opt-in Friend
      // Discovery's own "Turn On" screen already asks for separately
      // (open_to_friend_discovery, Aug 16 2026) -- so a real, stated
      // intent at signup can honestly set it automatically, without
      // silently discovering anyone the person didn't ask to be shown to.
      // Never forced back to false here -- an existing account that
      // already turned it off some other way is untouched, since this
      // only ever runs once, at first profile completion.
      const wantsFriends = Array.isArray(onboardingAnswers.onboarding_motivations)
        && onboardingAnswers.onboarding_motivations.includes('Make new friends');

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: userId,
        display_name: displayName.trim(),
        birthdate: birthdate.toISOString().split('T')[0],
        interests,
        terms_accepted_at: new Date().toISOString(),
        ...(onboardingAnswers.onboarding_motivations ? { onboarding_motivations: onboardingAnswers.onboarding_motivations } : {}),
        ...(onboardingAnswers.social_comfort_level ? { social_comfort_level: onboardingAnswers.social_comfort_level } : {}),
        ...(canonicalizeInterests(onboardingAnswers.monthly_interests).length ? { monthly_interests: canonicalizeInterests(onboardingAnswers.monthly_interests), monthly_interests_updated_at: new Date().toISOString() } : {}),
        ...(sanitizeInterestGroups(onboardingAnswers.interest_groups).length ? { interest_groups: sanitizeInterestGroups(onboardingAnswers.interest_groups) } : {}),
        ...(wantsFriends ? { open_to_friend_discovery: true } : {}),
        // Item 142: onboarding's per-area choices become muted groups (the older columns are derived from them server-side).
        ...(mutesFromOnboardingChoices(onboardingAnswers.notification_choices).length ? { notification_mutes: mutesFromOnboardingChoices(onboardingAnswers.notification_choices) } : {}),
      });
      if (!profileError) {
        // Marks this as a fresh signup so the navigator shows the
        // recommendations screen first instead of jumping straight to
        // MainTabs — checked and cleared the very next time the app's
        // main stack renders, so it only ever fires once.
        await AsyncStorage.setItem('just_completed_signup', 'true').catch(() => null);
        if (draftKeyRef.current) {
          await AsyncStorage.removeItem(draftKeyRef.current).catch(() => null);
        }
      }

      if (profileError) {
        setSubmitting(false);
        return Alert.alert(t('ui.onboarding.error'), profileError.message);
      }

      try {
        await uploadProfilePhoto(userId, photoAsset);
      } catch (e) {
        setSubmitting(false);
        return presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => submit() });
      }

      setSubmitting(false);
      Alert.alert(
        t('ui.onboarding.almostThere'),
        t('ui.onboarding.yourProfileIsSavedYour')
      );
      refreshProfile();
    } catch (e) {
      setSubmitting(false);
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => submit() });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl }}>
        <Text style={styles.header} accessibilityRole="header">{t('completeProfile.header')}</Text>
        <Text style={styles.subheader}>{t('completeProfile.subheader')}</Text>

        <View style={styles.progressRow} accessibilityLabel={t('ui.onboarding.stepOfA11y', { value: step + 1, length: STEP_DEFS.length, label: t(`ui.onboarding.step.${STEP_DEFS[step].key}`) })}>
          {STEP_DEFS.map((s, i) => (
            <View key={s.key} style={styles.progressStep}>
              <View style={[styles.progressDot, i <= step && styles.progressDotActive]} />
              <Text style={[styles.progressLabel, i === step && styles.progressLabelActive]}>{t(`ui.onboarding.step.${s.key}`)}</Text>
            </View>
          ))}
        </View>

        {stepKey === 'about' && (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t('ui.onboarding.n18Only')}</Text>
            </View>

            <Text style={styles.label}>{t('completeProfile.displayName')}</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('completeProfile.displayNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={t('ui.onboarding.displayNameA11y')}
            />

            <Text style={styles.label}>{t('completeProfile.dateOfBirth')}</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowPicker(true)}
              accessibilityLabel={birthdate ? t('ui.onboarding.dateOfBirthA11y', { date: birthdate.toLocaleDateString() }) : t('ui.onboarding.dateOfBirthNotSetA11y')}
              accessibilityRole="button"
            >
              <Text style={{ color: birthdate ? colors.textPrimary : colors.textTertiary }}>
                {birthdate ? birthdate.toLocaleDateString() : t('completeProfile.tapToSelect')}
              </Text>
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={birthdate || maxSelectableDate}
                mode="date"
                maximumDate={maxSelectableDate}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={(event, selectedDate) => {
                  setShowPicker(Platform.OS === 'ios');
                  if (selectedDate) setBirthdate(selectedDate);
                }}
              />
            )}
          </>
        )}

        {stepKey === 'photo' && (
          <>
            <Text style={styles.label}>{t('completeProfile.profilePhoto')}</Text>
            <TouchableOpacity
              style={styles.photoPicker}
              onPress={choosePhoto}
              activeOpacity={0.85}
              accessibilityLabel={photoAsset ? t('ui.onboarding.changeYourProfilePhotoA11y') : t('ui.onboarding.chooseAProfilePhotoRequiredA11y')}
              accessibilityRole="button"
            >
              {photoAsset ? (
                <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} />
              ) : (
                <Text style={styles.photoPickerText}>📷{'\n'}{t('ui.onboarding.tapToChooseAPhoto')}</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.helperText}>{t('completeProfile.photoHelper')}</Text>
          </>
        )}

        {stepKey === 'interests' && (
          <>
            <Text style={styles.label}>{t('ui.onboarding.yourInterestsOptional')}</Text>
            <Text style={styles.interestsHelper}>{t('ui.onboarding.helpsUsShowYouGatherings')}</Text>
            <View style={styles.chipsWrap}>
              {interestChoices.map((interest) => {
                const selected = interests.includes(interest);
                return (
                  <TouchableOpacity
                    key={interest}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleInterest(interest)}
                    activeOpacity={0.85}
                    accessibilityLabel={categoryName(interest, language)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{categoryName(interest, language)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.consentRow}
              onPress={() => setAgreedToTerms(!agreedToTerms)}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.onboarding.agreeToTermsOfServiceA11y')}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreedToTerms }}
            >
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.consentText}>
                {t('completeProfile.agreeText')}{' '}
                <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>{t('completeProfile.termsOfService')}</Text>
                {' '}{t('completeProfile.andText')}{' '}
                <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>{t('completeProfile.privacyPolicy')}</Text>
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.navRow}>
          {step > 0 && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={goBack}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.onboarding.backA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.backButtonText}>{t('ui.onboarding.back2')}</Text>
            </TouchableOpacity>
          )}
          {step < STEP_DEFS.length - 1 ? (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={goNext}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.onboarding.nextA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.nextButtonText}>{t('ui.onboarding.next')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextButton, !agreedToTerms && styles.nextButtonDisabled]}
              onPress={submit}
              disabled={submitting || !agreedToTerms}
              activeOpacity={0.85}
              accessibilityLabel={submitting ? t('completeProfile.saving') : t('completeProfile.continue')}
              accessibilityRole="button"
            >
              <Text style={styles.nextButtonText}>{submitting ? t('completeProfile.saving') : t('completeProfile.continue')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.signOutLink}
          onPress={handleSignOut}
          accessibilityLabel={t('ui.onboarding.signOutA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.signOutLinkText}>{t('ui.onboarding.signOut2')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subheader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, lineHeight: 18 },
  progressRow: { flexDirection: 'row', marginBottom: spacing.xl },
  progressStep: { flex: 1, alignItems: 'center' },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginBottom: 6 },
  progressDotActive: { backgroundColor: colors.primary },
  progressLabel: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
  progressLabelActive: { color: colors.primary },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginBottom: spacing.md,
  },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, justifyContent: 'center', minHeight: 50, borderWidth: 1, borderColor: colors.border },
  photoPicker: {
    backgroundColor: colors.surface, borderRadius: radius.lg, height: 160, width: 160,
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden', alignSelf: 'center', marginTop: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: '100%' },
  photoPickerText: { color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.md, fontSize: 13, lineHeight: 20 },
  helperText: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
  interestsHelper: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary,
    marginRight: spacing.sm, marginTop: 2, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  consentText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 19 },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  navRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  backButton: {
    paddingVertical: 16, paddingHorizontal: spacing.lg, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  backButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  nextButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  nextButtonDisabled: { opacity: 0.5 },
  nextButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signOutLink: { paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  signOutLinkText: { color: colors.textTertiary, fontSize: 13 },
});
