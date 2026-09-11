import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// External UX critique item 17: real controls for the "this matches you"
// push notifications (20261004_recommended_for_you_push.sql). One
// mode-driven screen, mirroring QuickFilterCustomizeScreen's own precedent,
// since Things To Do and Nearby Opportunities each have their own real
// profile columns rather than sharing one set. Categories deliberately
// shows only the user's own already-declared interests (profiles.interests)
// as togglable chips, not the full ~75-tag catalog -- a push can only ever
// be about something the trigger already requires to be a genuine interest
// of theirs (see the migration's own p.interests @> array[...] check), so
// offering the full catalog here would let someone "select" a category that
// could never actually fire a push, a fabricated-looking control.
const FREQUENCY_OPTIONS = [
  { key: 'few_per_day', label: 'A few per day' },
  { key: 'more_often', label: 'More often' },
  { key: 'as_they_happen', label: 'As they happen' },
];
// Reuses this app's own real distance tiers (gatherings.js's
// LOCAL_TIER_MAX_MILES / WIDE_TIER_MAX_MILES) rather than inventing a new
// distance concept or a slider.
const DISTANCE_OPTIONS = [
  { key: 1, label: 'Nearby (1 mi)' },
  { key: 15, label: 'Wider area (15 mi)' },
  { key: null, label: 'Any distance' },
];
const TIME_OPTIONS = [
  { key: 'anytime', label: 'Anytime' },
  { key: 'evenings_weekends', label: 'Evenings & Weekends' },
];

const MODE_SETUP = {
  things_to_do: {
    title: 'Things To Do',
    description: 'Control how you’re notified when a gathering or community matches your interests.',
    columns: {
      frequency: 'notify_things_to_do_frequency',
      categories: 'notify_things_to_do_categories',
      distance: 'notify_things_to_do_max_distance_miles',
      timePref: 'notify_things_to_do_time_pref',
    },
  },
  nearby_opportunities: {
    title: 'Nearby Opportunities',
    description: 'Control how you’re notified when a business posting matches your interests.',
    columns: {
      frequency: 'notify_nearby_opportunities_frequency',
      categories: 'notify_nearby_opportunities_categories',
      distance: 'notify_nearby_opportunities_max_distance_miles',
      timePref: 'notify_nearby_opportunities_time_pref',
    },
  },
};

export default function RecommendationPreferencesScreen({ route }) {
  const mode = route?.params?.mode === 'nearby_opportunities' ? 'nearby_opportunities' : 'things_to_do';
  const setup = MODE_SETUP[mode];
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [userId, setUserId] = useState(null);
  const [myInterests, setMyInterests] = useState([]);
  const [frequency, setFrequency] = useState('few_per_day');
  const [selectedCategories, setSelectedCategories] = useState(null); // null = all of myInterests qualify
  const [distance, setDistance] = useState(15);
  const [timePref, setTimePref] = useState('anytime');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function load() {
    setLoading(true);
    const { columns } = setup;
    const { data: sessionData } = await supabase.auth.getSession();
    const id = sessionData?.session?.user?.id;
    setUserId(id);
    const { data } = await supabase
      .from('profiles')
      .select(`interests, ${columns.frequency}, ${columns.categories}, ${columns.distance}, ${columns.timePref}`)
      .eq('id', id)
      .single();
    if (data) {
      setMyInterests(data.interests ?? []);
      setFrequency(data[columns.frequency] ?? 'few_per_day');
      setSelectedCategories(data[columns.categories] ?? null);
      setDistance(data[columns.distance] === undefined ? 15 : data[columns.distance]);
      setTimePref(data[columns.timePref] ?? 'anytime');
    }
    setLoading(false);
  }

  async function save(column, value) {
    const { error } = await supabase.from('profiles').update({ [column]: value }).eq('id', userId);
    if (error) {
      Alert.alert('Error', error.message);
    }
  }

  function toggleCategory(tag) {
    const current = selectedCategories ?? myInterests;
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    const finalValue = next.length === myInterests.length ? null : next;
    setSelectedCategories(finalValue);
    save(setup.columns.categories, finalValue);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  const effectiveSelectedCategories = selectedCategories ?? myInterests;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.description}>{setup.description}</Text>

        <Text style={styles.sectionHeader}>Frequency</Text>
        <View style={styles.chipsWrap}>
          {FREQUENCY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, frequency === opt.key && styles.chipSelected]}
              onPress={() => { setFrequency(opt.key); save(setup.columns.frequency, opt.key); }}
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{ selected: frequency === opt.key }}
            >
              <Text style={[styles.chipText, frequency === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>Distance</Text>
        <View style={styles.chipsWrap}>
          {DISTANCE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.chip, distance === opt.key && styles.chipSelected]}
              onPress={() => { setDistance(opt.key); save(setup.columns.distance, opt.key); }}
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{ selected: distance === opt.key }}
            >
              <Text style={[styles.chipText, distance === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>Time</Text>
        <View style={styles.chipsWrap}>
          {TIME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, timePref === opt.key && styles.chipSelected]}
              onPress={() => { setTimePref(opt.key); save(setup.columns.timePref, opt.key); }}
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{ selected: timePref === opt.key }}
            >
              <Text style={[styles.chipText, timePref === opt.key && styles.chipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionHeader}>Categories</Text>
        {myInterests.length === 0 ? (
          <Text style={styles.emptyText}>Add interests to your profile to fine-tune which categories notify you.</Text>
        ) : (
          <View style={styles.chipsWrap}>
            {myInterests.map((tag) => {
              const isSelected = effectiveSelectedCategories.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => toggleCategory(tag)}
                  accessibilityLabel={tag}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.lg },
  emptyText: { ...typography.body, color: colors.textTertiary, fontStyle: 'italic' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  chipTextSelected: { color: '#fff' },
});
