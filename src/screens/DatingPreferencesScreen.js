import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { supabase, functionUrl } from '../services/supabase';
import { basicsOption } from '../i18n/basicsVocab';
import { categoryName } from '../i18n/categoryNames';
import { useTheme } from '../context/ThemeContext';
import { ETHNICITY_OPTIONS } from '../constants/ethnicityOptions';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { feetInchesToTotalInches, isBlankHeightPair, totalInchesToFeetInches } from '../utils/heightUnits';

// Sep 3 2026 ("global onboarding -> product wiring" master plan,
// CLAUDE.md, Phase B) -- the real, curated 8-value vocabulary a
// self-description hair_color field already uses (basicsFields.js) is
// reused verbatim as the filter's own options, not a second invented
// list.
const HAIR_COLOR_OPTIONS = BASICS_FIELDS.find((f) => f.key === 'hair_color')?.options ?? [];
// Sep 14 2026 -- the second appearance-based matching filter, same
// reuse-the-real-curated-vocabulary shape as hair color above. Unlike
// hair_color, eye_color was already a real, curated select (never free
// text), so this is purely the missing preference/filter half, not a
// promote-out-of-basics step.
const EYE_COLOR_OPTIONS = BASICS_FIELDS.find((f) => f.key === 'eye_color')?.options ?? [];
import { typography, spacing, radius, shadow } from '../theme';

import { showSuccessToast } from '../motion';
// Aug 30 2026 (CLAUDE.md, external product-critique reply): "Dating should
// own the dating-specific information" -- the real, dedicated home for
// what's genuinely dating-specific (what you're looking for, age range,
// ethnicity preferences), reached from Discover -> People -> Dating
// instead of buried in generic Settings, which stays scoped to app/account
// controls. Every field here is the exact same canonical column Settings
// used to write directly -- this is a relocation of the one real edit
// surface, never a second copy of the same data. Gender identity/
// ethnicity/interests/photos/bio stay owned by Profile (a single fact
// about who you are shouldn't have two different edit surfaces that could
// drift) -- this screen only surfaces them read-only, with a real link
// back to Profile to actually change them.
export default function DatingPreferencesScreen({ navigation }) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('99');
  const [relationshipIntention, setRelationshipIntention] = useState([]);
  const [ethnicityPreferences, setEthnicityPreferences] = useState([]);
  const [hairColorPreferences, setHairColorPreferences] = useState([]);
  const [eyeColorPreferences, setEyeColorPreferences] = useState([]);
  // Phase F (CLAUDE.md, Sep 3 2026 master plan) -- a real height-range
  // preference, wired into proximity.js the exact same way as
  // hairColorPreferences above: min/max total inches stored on the
  // caller's own profile, both blank means no preference at all.
  const [minHeightFeet, setMinHeightFeet] = useState('');
  const [minHeightInches, setMinHeightInches] = useState('');
  const [maxHeightFeet, setMaxHeightFeet] = useState('');
  const [maxHeightInches, setMaxHeightInches] = useState('');
  const [interests, setInterests] = useState([]);
  const [loadingStrengths, setLoadingStrengths] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);
    if (id) {
      const { data } = await supabase
        .from('profiles')
        .select(
          'preferred_min_age, preferred_max_age, relationship_intention, ethnicity_preferences, dating_pref_hair_colors, dating_pref_eye_colors, dating_pref_min_height_inches, dating_pref_max_height_inches, interests, dating_preferences_set'
        )
        .eq('id', id)
        .single();
      if (data) {
        setMinAge(String(data.preferred_min_age ?? 18));
        setMaxAge(String(data.preferred_max_age ?? 99));
        setRelationshipIntention(
          Array.isArray(data.relationship_intention)
            ? data.relationship_intention
            : data.relationship_intention
            ? [data.relationship_intention]
            : []
        );
        setEthnicityPreferences(data.ethnicity_preferences ?? []);
        setHairColorPreferences(data.dating_pref_hair_colors ?? []);
        setEyeColorPreferences(data.dating_pref_eye_colors ?? []);
        const minPair = totalInchesToFeetInches(data.dating_pref_min_height_inches);
        setMinHeightFeet(minPair.feet);
        setMinHeightInches(minPair.inches);
        const maxPair = totalInchesToFeetInches(data.dating_pref_max_height_inches);
        setMaxHeightFeet(maxPair.feet);
        setMaxHeightInches(maxPair.inches);
        setInterests(data.interests ?? []);
      }
    }
    setLoading(false);
  }

  async function toggleIntention(value) {
    const current = Array.isArray(relationshipIntention) ? relationshipIntention : [];
    const newValue = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setRelationshipIntention(newValue);
    const { error } = await supabase
      .from('profiles')
      .update({ relationship_intention: newValue.length > 0 ? newValue : null })
      .eq('id', userId);
    if (error) presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => toggleIntention(value) });
  }

  function toggleEthnicityPreference(option) {
    setEthnicityPreferences((prev) => (prev.includes(option) ? prev.filter((e) => e !== option) : [...prev, option]));
  }

  function toggleHairColorPreference(option) {
    setHairColorPreferences((prev) => (prev.includes(option) ? prev.filter((h) => h !== option) : [...prev, option]));
  }

  function toggleEyeColorPreference(option) {
    setEyeColorPreferences((prev) => (prev.includes(option) ? prev.filter((e) => e !== option) : [...prev, option]));
  }

  async function savePreferences() {
    const minAgeNum = parseInt(minAge, 10);
    const maxAgeNum = parseInt(maxAge, 10);
    if (Number.isNaN(minAgeNum) || Number.isNaN(maxAgeNum) || minAgeNum < 18 || maxAgeNum < minAgeNum) {
      return Alert.alert(t('ui.datingPrefs.invalidRange'), t('ui.datingPrefs.enterAValidAgeRange'));
    }

    // Phase F -- same hard-validation posture as the age range above: a
    // genuinely half-filled pair or an out-of-bound value is worth
    // blocking on, not silently discarded. Both sides fully blank means
    // no preference at all, matching hairColorPreferences' own "leave
    // blank for no preference" convention.
    let minHeightToSave = null;
    if (!isBlankHeightPair(minHeightFeet, minHeightInches)) {
      minHeightToSave = feetInchesToTotalInches(minHeightFeet, minHeightInches);
      if (minHeightToSave === null) {
        return Alert.alert(t('ui.datingPrefs.invalidHeight'), t('ui.datingPrefs.enterARealMinimumHeight'));
      }
    }
    let maxHeightToSave = null;
    if (!isBlankHeightPair(maxHeightFeet, maxHeightInches)) {
      maxHeightToSave = feetInchesToTotalInches(maxHeightFeet, maxHeightInches);
      if (maxHeightToSave === null) {
        return Alert.alert(t('ui.datingPrefs.invalidHeight'), t('ui.datingPrefs.enterARealMaximumHeight'));
      }
    }
    if (minHeightToSave !== null && maxHeightToSave !== null && maxHeightToSave < minHeightToSave) {
      return Alert.alert(t('ui.datingPrefs.invalidRange'), t('ui.datingPrefs.maximumHeightMustBeAt'));
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        preferred_min_age: minAgeNum,
        preferred_max_age: maxAgeNum,
        ethnicity_preferences: ethnicityPreferences,
        dating_pref_hair_colors: hairColorPreferences,
        dating_pref_eye_colors: eyeColorPreferences,
        dating_pref_min_height_inches: minHeightToSave,
        dating_pref_max_height_inches: maxHeightToSave,
        dating_preferences_set: true,
      })
      .eq('id', userId);
    if (error) return presentRecoverableError(Alert, { what: 'complete that', error: error, onRetry: () => savePreferences() });
    showSuccessToast(t('ui.datingPrefs.saved'));
  }

  async function showStrengths() {
    setLoadingStrengths(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const response = await fetch(functionUrl('generate-strengths'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          Alert.alert(
            t('ui.datingPrefs.premiumFeature'),
            t('ui.datingPrefs.generatingAPersonalizedNoteAbout'),
            [
              { text: t('ui.datingPrefs.notNow'), style: 'cancel' },
              { text: t('ui.datingPrefs.upgradeToPremium'), onPress: () => navigation.navigate('Paywall') },
            ]
          );
        } else {
          Alert.alert(t('ui.datingPrefs.error'), result.error || t('ui.datingPrefs.couldNotGenerateThisRight'));
        }
      } else {
        Alert.alert(t('ui.datingPrefs.aNoteForYou'), result.summary, [{ text: t('ui.datingPrefs.thanks') }]);
      }
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => showStrengths() });
    }
    setLoadingStrengths(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>{t('ui.datingPrefs.loadingYourDatingProfile')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>{t('ui.datingPrefs.howYouShowUpWhen')}</Text>

        <TouchableOpacity
          style={styles.strengthsButton}
          onPress={showStrengths}
          disabled={loadingStrengths}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.datingPrefs.generateANoteAboutWhyA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.strengthsButtonText}>{loadingStrengths ? t('ui.datingPrefs.thinking') : t('ui.datingPrefs.whySomeoneWouldBeLucky')}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.datingPrefs.whatImLookingFor')}</Text>
        <View style={styles.card}>
          <View style={styles.chipsWrap}>
            {INTENTION_OPTIONS.map((option) => {
              const selected = (Array.isArray(relationshipIntention) ? relationshipIntention : []).includes(option.value);
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleIntention(option.value)}
                  activeOpacity={0.85}
                  accessibilityLabel={t(`ui.viewProfile.intention.${option.value}`)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.icon} {t(`ui.viewProfile.intention.${option.value}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            {t('ui.datingPrefs.selectAsManyAsApply')}
          </Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.datingPrefs.datingPreferences')}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>{t('ui.datingPrefs.ageRange')}</Text>
          <View style={styles.ageRow}>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={minAge}
              onChangeText={setMinAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={t('ui.datingPrefs.minimumAgeA11y')}
            />
            <Text style={styles.ageDash}>{t('ui.datingPrefs.ageTo')}</Text>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={maxAge}
              onChangeText={setMaxAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={t('ui.datingPrefs.maximumAgeA11y')}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.datingPrefs.ethnicityPreferences')}</Text>
          <View style={styles.chipsWrap}>
            {ETHNICITY_OPTIONS.map((option) => {
              const selected = ethnicityPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleEthnicityPreference(option)}
                  activeOpacity={0.85}
                  accessibilityLabel={basicsOption('ethnicity', option, language)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{basicsOption('ethnicity', option, language)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>{t('ui.datingPrefs.whoYoudLikeToBe')}</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.datingPrefs.hairColorPreferences')}</Text>
          <View style={styles.chipsWrap}>
            {HAIR_COLOR_OPTIONS.map((option) => {
              const selected = hairColorPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleHairColorPreference(option)}
                  activeOpacity={0.85}
                  accessibilityLabel={basicsOption('hair_color', option, language)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{basicsOption('hair_color', option, language)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>{t('ui.datingPrefs.aRealFilterNotJust')}</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.datingPrefs.eyeColorPreferences')}</Text>
          <View style={styles.chipsWrap}>
            {EYE_COLOR_OPTIONS.map((option) => {
              const selected = eyeColorPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleEyeColorPreference(option)}
                  activeOpacity={0.85}
                  accessibilityLabel={basicsOption('eye_color', option, language)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{basicsOption('eye_color', option, language)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>{t('ui.datingPrefs.aRealFilterNotJust')}</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>{t('ui.datingPrefs.heightPreference')}</Text>
          <View style={styles.heightRangeRow}>
            <View style={styles.heightRangeCol}>
              <Text style={styles.heightRangeLabel}>{t('ui.datingPrefs.min')}</Text>
              <View style={styles.heightRow}>
                <TextInput
                  style={[styles.input, styles.heightInput]}
                  value={minHeightFeet}
                  onChangeText={setMinHeightFeet}
                  keyboardType="number-pad"
                  placeholder="ft"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={t('ui.datingPrefs.minimumHeightFeetA11y')}
                  maxLength={1}
                />
                <Text style={styles.heightDash}>'</Text>
                <TextInput
                  style={[styles.input, styles.heightInput]}
                  value={minHeightInches}
                  onChangeText={setMinHeightInches}
                  keyboardType="number-pad"
                  placeholder="in"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={t('ui.datingPrefs.minimumHeightInchesA11y')}
                  maxLength={2}
                />
                <Text style={styles.heightDash}>"</Text>
              </View>
            </View>
            <View style={styles.heightRangeCol}>
              <Text style={styles.heightRangeLabel}>{t('ui.datingPrefs.max')}</Text>
              <View style={styles.heightRow}>
                <TextInput
                  style={[styles.input, styles.heightInput]}
                  value={maxHeightFeet}
                  onChangeText={setMaxHeightFeet}
                  keyboardType="number-pad"
                  placeholder="ft"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={t('ui.datingPrefs.maximumHeightFeetA11y')}
                  maxLength={1}
                />
                <Text style={styles.heightDash}>'</Text>
                <TextInput
                  style={[styles.input, styles.heightInput]}
                  value={maxHeightInches}
                  onChangeText={setMaxHeightInches}
                  keyboardType="number-pad"
                  placeholder="in"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel={t('ui.datingPrefs.maximumHeightInchesA11y')}
                  maxLength={2}
                />
                <Text style={styles.heightDash}>"</Text>
              </View>
            </View>
          </View>
          <Text style={styles.helperText}>{t('ui.datingPrefs.aRealFilterNotJust2')}</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={savePreferences}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.datingPrefs.savePreferencesA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{t('ui.datingPrefs.savePreferences')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.datingPrefs.interests')}</Text>
        <View style={styles.card}>
          {interests.length > 0 ? (
            <View style={styles.chipsWrap}>
              {interests.map((interest) => (
                <View key={interest} style={styles.chipReadOnly}>
                  <Text style={styles.chipText}>{categoryName(interest, language)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>{t('ui.datingPrefs.youHaventAddedAnyInterests')}</Text>
          )}
          <TouchableOpacity
            style={{ marginTop: spacing.md }}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel={t('ui.datingPrefs.editYourInterestsOnProfileA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>{t('ui.datingPrefs.editYourInterestsOnProfile')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{ marginTop: spacing.sm, marginBottom: spacing.xxl }}
          onPress={() => navigation.navigate('Profile', { scrollToGenderSection: true })}
          accessibilityLabel={t('ui.datingPrefs.genderIdentityEthnicityAndTheirA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>{t('ui.datingPrefs.genderIdentityEthnicityAndTheir')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl },
    header: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
    sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
    },
    label: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs, marginTop: spacing.md },
    input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.sm, padding: spacing.md, fontSize: 15 },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    // Interests here are read-only (edited on Profile, not duplicated) --
    // a plain View, not a TouchableOpacity, so it never implies a tap does
    // anything.
    chipReadOnly: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    chipTextSelected: { color: '#fff' },
    ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ageInput: { flex: 1, textAlign: 'center' },
    ageDash: { color: colors.textTertiary },
    heightRangeRow: { flexDirection: 'row', gap: spacing.lg },
    heightRangeCol: { flex: 1 },
    heightRangeLabel: { ...typography.small, color: colors.textTertiary, marginBottom: spacing.xs },
    heightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    heightInput: { flex: 1, textAlign: 'center' },
    heightDash: { color: colors.textTertiary },
    helperText: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 16 },
    linkText: { ...typography.body, color: colors.primary, fontWeight: '600' },
    button: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg, ...shadow.button },
    buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    strengthsButton: {
      backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
      paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.lg,
    },
    strengthsButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  });
