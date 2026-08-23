import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, SafeAreaView } from 'react-native';
import { supabase } from '../services/supabase';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { DISCOVERY_GENDER_OPTIONS, SHOW_ME_OPTIONS } from '../constants/discoveryOptions';
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
// (dating intent / show-me / age range / discovery gender) -- ethnicity
// and its own hide toggles stay Settings-only, not duplicated here, per
// the "ask only what's necessary up front" principle this whole phase is
// built around. Every field stays fully editable from Settings afterward.
export default function DatingPreferencesPromptModal({ visible, userId, initialValues, onDone }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [relationshipIntention, setRelationshipIntention] = useState([]);
  const [showMe, setShowMe] = useState('Everyone');
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('99');
  const [discoveryGender, setDiscoveryGender] = useState('Prefer not to say');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setRelationshipIntention(Array.isArray(initialValues?.relationship_intention) ? initialValues.relationship_intention : []);
      setShowMe(initialValues?.show_me || 'Everyone');
      setMinAge(String(initialValues?.preferred_min_age ?? 18));
      setMaxAge(String(initialValues?.preferred_max_age ?? 99));
      setDiscoveryGender(initialValues?.discovery_gender || 'Prefer not to say');
    }
  }, [visible, initialValues]);

  function toggleIntention(value) {
    setRelationshipIntention((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
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
      show_me: showMe,
      discovery_gender: discoveryGender,
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

          <Text style={styles.label}>Show Me</Text>
          <View style={styles.chipsWrap}>
            {SHOW_ME_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, showMe === option && styles.chipSelected]}
                onPress={() => setShowMe(option)}
                activeOpacity={0.8}
                accessibilityLabel={option}
                accessibilityRole="button"
                accessibilityState={{ selected: showMe === option }}
              >
                <Text style={[styles.chipText, showMe === option && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            ))}
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

          <Text style={styles.label}>My Gender</Text>
          <View style={styles.chipsWrap}>
            {DISCOVERY_GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, discoveryGender === option && styles.chipSelected]}
                onPress={() => setDiscoveryGender(option)}
                activeOpacity={0.8}
                accessibilityLabel={option}
                accessibilityRole="button"
                accessibilityState={{ selected: discoveryGender === option }}
              >
                <Text style={[styles.chipText, discoveryGender === option && styles.chipTextSelected]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.helperText}>
            This is separate from the "Gender" field on your profile — it's only used to match
            against other people's "Show Me" preference.
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
