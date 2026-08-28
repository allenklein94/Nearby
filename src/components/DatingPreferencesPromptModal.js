import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { supabase } from '../services/supabase';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { GENDER_IDENTITY_OPTIONS } from '../constants/genderOptions';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Phase 3 of the "build everything" plan (see CLAUDE.md): a real
// first-open prompt for DiscoveryScreen.js, closing the gap that
// "Looking For"/"Discovery Preferences" were previously only ever asked
// in Settings -- a user who never opens Settings was never asked at all.
// Shown once, gated on the caller's own real profiles.dating_preferences_set
// flag (added this same phase, the same "shown once, flip a flag" shape
// DiscoveryScreen's own seen_browse_callout already uses). Deliberately
// scoped to just the core matching preferences the plan itself names
// (dating intent / age range / gender) -- ethnicity and its own hide
// toggles stay Settings-only, not duplicated here, per the "ask only what's
// necessary up front" principle this whole phase is built around. Every
// field stays fully editable from Settings/Profile afterward.
//
// Taxonomy Post-Implementation Audit remediation (CLAUDE.md, Aug 28 2026):
// this modal originally wrote the legacy discovery_gender/show_me fields --
// a real bug, since passesGenderMatch() (services/proximity.js) treats
// gender_identity/interested_in_genders as canonical and only falls back
// to the legacy pair when either party hasn't set the new fields. A
// brand-new user whose only interaction with dating preferences was this
// modal was permanently parked on the legacy fallback. Fixed by using the
// exact same fields/vocab/copy ProfileScreen.js's own "I identify as"/
// "I'm interested in dating" pickers already use -- one canonical system,
// not two, from a user's very first open of Dating.
export default function DatingPreferencesPromptModal({ visible, userId, initialValues, onDone }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [relationshipIntention, setRelationshipIntention] = useState([]);
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('99');
  const [genderIdentity, setGenderIdentity] = useState([]);
  const [interestedInGenders, setInterestedInGenders] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setRelationshipIntention(Array.isArray(initialValues?.relationship_intention) ? initialValues.relationship_intention : []);
      setMinAge(String(initialValues?.preferred_min_age ?? 18));
      setMaxAge(String(initialValues?.preferred_max_age ?? 99));
      setGenderIdentity(Array.isArray(initialValues?.gender_identity) ? initialValues.gender_identity : []);
      setInterestedInGenders(Array.isArray(initialValues?.interested_in_genders) ? initialValues.interested_in_genders : []);
    }
  }, [visible, initialValues]);

  function toggleIntention(value) {
    setRelationshipIntention((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function toggleGenderIdentity(option) {
    setGenderIdentity((prev) =>
      prev.includes(option) ? prev.filter((g) => g !== option) : [...prev, option]
    );
  }

  function toggleInterestedInGender(option) {
    setInterestedInGenders((prev) =>
      prev.includes(option) ? prev.filter((g) => g !== option) : [...prev, option]
    );
  }

  // Marks the prompt seen either way -- matching seen_browse_callout's own
  // "shown once, never again regardless of what was picked" convention.
  async function finish(extraFields) {
    if (!userId) {
      onDone?.(extraFields || {});
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ dating_preferences_set: true, ...(extraFields || {}) })
      .eq('id', userId);
    setSaving(false);
    if (error) {
      // Non-fatal -- this is a one-time nudge, never worth blocking Discover
      // over. Logged, not surfaced, matching this codebase's own established
      // "supplementary, never blocks core content" convention.
      console.error('DatingPreferencesPromptModal save failed', error);
    }
    onDone?.({ dating_preferences_set: true, ...(extraFields || {}) });
  }

  function handleSkip() {
    finish({});
  }

  function handleSave() {
    const minAgeNum = parseInt(minAge, 10);
    const maxAgeNum = parseInt(maxAge, 10);
    const validAge = !isNaN(minAgeNum) && !isNaN(maxAgeNum) && minAgeNum >= 18 && maxAgeNum >= minAgeNum;

    finish({
      relationship_intention: relationshipIntention.length > 0 ? relationshipIntention : null,
      gender_identity: genderIdentity,
      interested_in_genders: interestedInGenders,
      ...(validAge ? { preferred_min_age: minAgeNum, preferred_max_age: maxAgeNum } : {}),
    });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleSkip}>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>What are you looking for?</Text>
          <Text style={styles.subtitle}>
            A couple of quick preferences so we can show you the right people. You can change
            these anytime in Settings.
          </Text>

          <Text style={styles.label}>Looking For</Text>
          <View style={styles.chipsWrap}>
            {INTENTION_OPTIONS.map((option) => {
              const selected = relationshipIntention.includes(option.value);
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleIntention(option.value)}
                  activeOpacity={0.8}
                  accessibilityLabel={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {option.icon} {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Age Range</Text>
          <View style={styles.ageRow}>
            <TextInput
              style={styles.ageInput}
              value={minAge}
              onChangeText={setMinAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Minimum age"
            />
            <Text style={styles.ageDash}>to</Text>
            <TextInput
              style={styles.ageInput}
              value={maxAge}
              onChangeText={setMaxAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Maximum age"
            />
          </View>

          <Text style={styles.label}>I identify as</Text>
          <View style={styles.chipsWrap}>
            {GENDER_IDENTITY_OPTIONS.map((option) => {
              const selected = genderIdentity.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleGenderIdentity(option)}
                  activeOpacity={0.8}
                  accessibilityLabel={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>Select all that apply — this affects who you're matched with.</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>I'm interested in dating</Text>
          <View style={styles.chipsWrap}>
            {GENDER_IDENTITY_OPTIONS.map((option) => {
              const selected = interestedInGenders.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleInterestedInGender(option)}
                  activeOpacity={0.8}
                  accessibilityLabel={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helperText}>
            Select all that apply. Matching is mutual — you'll only see people whose preferences
            also include you.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleSkip}
            disabled={saving}
            accessibilityLabel="Skip for now"
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, shadow.button]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
            accessibilityLabel="Save preferences"
            accessibilityRole="button"
          >
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  label: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.small, color: colors.textPrimary, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ageInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  ageDash: { ...typography.body, color: colors.textSecondary },
  helperText: { ...typography.small, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 18 },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  skipText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  saveButtonText: { color: '#fff', ...typography.body, fontWeight: '700' },
});
