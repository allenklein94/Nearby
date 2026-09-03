import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { supabase, functionUrl } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { ETHNICITY_OPTIONS } from '../constants/ethnicityOptions';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { BASICS_FIELDS } from '../constants/basicsFields';

// Sep 3 2026 ("global onboarding -> product wiring" master plan,
// CLAUDE.md, Phase B) -- the real, curated 8-value vocabulary a
// self-description hair_color field already uses (basicsFields.js) is
// reused verbatim as the filter's own options, not a second invented
// list.
const HAIR_COLOR_OPTIONS = BASICS_FIELDS.find((f) => f.key === 'hair_color')?.options ?? [];
import { typography, spacing, radius, shadow } from '../theme';

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
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [minAge, setMinAge] = useState('18');
  const [maxAge, setMaxAge] = useState('99');
  const [relationshipIntention, setRelationshipIntention] = useState([]);
  const [ethnicityPreferences, setEthnicityPreferences] = useState([]);
  const [hairColorPreferences, setHairColorPreferences] = useState([]);
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
        .select('preferred_min_age, preferred_max_age, relationship_intention, ethnicity_preferences, dating_pref_hair_colors, interests, dating_preferences_set')
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
    if (error) Alert.alert('Error', error.message);
  }

  function toggleEthnicityPreference(option) {
    setEthnicityPreferences((prev) => (prev.includes(option) ? prev.filter((e) => e !== option) : [...prev, option]));
  }

  function toggleHairColorPreference(option) {
    setHairColorPreferences((prev) => (prev.includes(option) ? prev.filter((h) => h !== option) : [...prev, option]));
  }

  async function savePreferences() {
    const minAgeNum = parseInt(minAge, 10);
    const maxAgeNum = parseInt(maxAge, 10);
    if (Number.isNaN(minAgeNum) || Number.isNaN(maxAgeNum) || minAgeNum < 18 || maxAgeNum < minAgeNum) {
      return Alert.alert('Invalid range', 'Enter a valid age range (minimum 18).');
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        preferred_min_age: minAgeNum,
        preferred_max_age: maxAgeNum,
        ethnicity_preferences: ethnicityPreferences,
        dating_pref_hair_colors: hairColorPreferences,
        dating_preferences_set: true,
      })
      .eq('id', userId);
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Saved');
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
            'Premium Feature',
            'Generating a personalized note about your profile uses AI and is a Premium feature.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
            ]
          );
        } else {
          Alert.alert('Error', result.error || 'Could not generate this right now.');
        }
      } else {
        Alert.alert('✨ A note for you', result.summary, [{ text: 'Thanks' }]);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setLoadingStrengths(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Loading your dating profile...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>How you show up when you're looking to date — separate from your general Profile.</Text>

        <TouchableOpacity
          style={styles.strengthsButton}
          onPress={showStrengths}
          disabled={loadingStrengths}
          activeOpacity={0.85}
          accessibilityLabel="Generate a note about why someone would be lucky to date you"
          accessibilityRole="button"
        >
          <Text style={styles.strengthsButtonText}>{loadingStrengths ? 'Thinking...' : '✨ Why someone would be lucky to date you'}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel} accessibilityRole="header">What I'm looking for</Text>
        <View style={styles.card}>
          <View style={styles.chipsWrap}>
            {INTENTION_OPTIONS.map((option) => {
              const selected = (Array.isArray(relationshipIntention) ? relationshipIntention : []).includes(option.value);
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
          <Text style={styles.helperText}>
            Select as many as apply. Shown on your profile — meant to keep expectations honest, for you and everyone you match with.
          </Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Dating Preferences</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Age Range</Text>
          <View style={styles.ageRow}>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={minAge}
              onChangeText={setMinAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Minimum age"
            />
            <Text style={styles.ageDash}>to</Text>
            <TextInput
              style={[styles.input, styles.ageInput]}
              value={maxAge}
              onChangeText={setMaxAge}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Maximum age"
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Ethnicity Preferences</Text>
          <View style={styles.chipsWrap}>
            {ETHNICITY_OPTIONS.map((option) => {
              const selected = ethnicityPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleEthnicityPreference(option)}
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
          <Text style={styles.helperText}>Who you'd like to be matched with. Leave blank for no preference.</Text>

          <Text style={[styles.label, { marginTop: spacing.lg }]}>Hair Color Preferences</Text>
          <View style={styles.chipsWrap}>
            {HAIR_COLOR_OPTIONS.map((option) => {
              const selected = hairColorPreferences.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleHairColorPreference(option)}
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
          <Text style={styles.helperText}>A real filter, not just a Profile description — leave blank for no preference.</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={savePreferences}
            activeOpacity={0.85}
            accessibilityLabel="Save preferences"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Save Preferences</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Interests</Text>
        <View style={styles.card}>
          {interests.length > 0 ? (
            <View style={styles.chipsWrap}>
              {interests.map((interest) => (
                <View key={interest} style={styles.chipReadOnly}>
                  <Text style={styles.chipText}>{interest}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>You haven't added any interests yet.</Text>
          )}
          <TouchableOpacity
            style={{ marginTop: spacing.md }}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel="Edit your interests on Profile"
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Edit your interests on Profile →</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={{ marginTop: spacing.sm, marginBottom: spacing.xxl }}
          onPress={() => navigation.navigate('Profile', { scrollToGenderSection: true })}
          accessibilityLabel="Gender identity, ethnicity, and their visibility are managed on your Profile"
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>Gender identity, ethnicity, and their visibility are managed on your Profile →</Text>
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
