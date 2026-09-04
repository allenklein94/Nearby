import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getMyOccasions, addOccasion, deleteOccasion } from '../services/occasions';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
// plan, Phase H) -- a real Occasions CRUD screen, same shape/scope as
// EmergencyContactsScreen.js (a personal-record table, plain owner-scoped
// RLS, no RPC needed for create/delete). Birthdays stay owned by the
// already-real, already-live profiles.birthdate + Home nudge -- not one
// of the 6 chip options here, since there's nothing new to record for a
// signal this app already has.
const OCCASION_TYPES = [
  { key: 'anniversary', label: 'Anniversary', icon: '💑' },
  { key: 'graduation', label: 'Graduation', icon: '🎓' },
  { key: 'milestone', label: 'Milestone', icon: '🏆' },
  { key: 'life_event', label: 'Life Event', icon: '🌟' },
  { key: 'other', label: 'Other', icon: '📅' },
];

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function OccasionsScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const [occasions, setOccasions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [occasionType, setOccasionType] = useState('anniversary');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [recursAnnually, setRecursAnnually] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getMyOccasions();
      setOccasions(data);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleAdd() {
    if (!title.trim()) {
      Alert.alert('Missing info', 'Give this occasion a title.');
      return;
    }
    setSubmitting(true);
    const isoDate = date.toISOString().slice(0, 10);
    const result = await addOccasion({ occasionType, title: title.trim(), occasionDate: isoDate, recursAnnually });
    setSubmitting(false);
    if (result.error) {
      Alert.alert('Error', result.error);
      return;
    }
    setTitle('');
    setDate(new Date());
    load();
  }

  function confirmDelete(occasion) {
    Alert.alert(
      `Remove "${occasion.title}"?`,
      'This removes it for you. Nearby will no longer suggest planning something around it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(occasion.id);
            await deleteOccasion(occasion.id);
            setDeletingId(null);
            load();
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your occasions...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your occasions." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">Occasions</Text>
          <Text style={styles.headerSubtitle}>
            Anniversaries, graduations, and other real dates worth planning around. Birthdays are
            already handled automatically on Home — this is for everything else.
          </Text>

          {occasions.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>No occasions saved yet.</Text>
            </View>
          )}

          {occasions.map((occasion) => {
            const meta = OCCASION_TYPES.find((t) => t.key === occasion.occasion_type);
            return (
              <View key={occasion.id} style={styles.card}>
                <Text style={{ fontSize: 22, marginRight: spacing.sm }}>{meta?.icon ?? '📅'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{occasion.title}</Text>
                  <Text style={styles.detail}>
                    {formatDate(new Date(occasion.occasion_date + 'T00:00:00'))}
                    {occasion.recurs_annually ? ' · Repeats every year' : ' · One time'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => confirmDelete(occasion)}
                  disabled={deletingId === occasion.id}
                  accessibilityLabel={`Remove ${occasion.title}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.removeButtonText}>{deletingId === occasion.id ? '...' : 'Remove'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}

          <Text style={styles.sectionLabel} accessibilityRole="header">Add an occasion</Text>
          <View style={styles.form}>
            <View style={styles.chipRow}>
              {OCCASION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.chip, occasionType === t.key && styles.chipSelected]}
                  onPress={() => setOccasionType(t.key)}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                >
                  <Text style={[styles.chipText, occasionType === t.key && styles.chipTextSelected]}>{t.icon} {t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Title (e.g. Our Anniversary)"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Occasion title"
            />
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel="Occasion date">
              <Text style={{ color: colors.textPrimary }}>{formatDate(date)}</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={(event, selectedDate) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (selectedDate) setDate(selectedDate);
                }}
              />
            )}
            <TouchableOpacity
              style={styles.recurRow}
              onPress={() => setRecursAnnually((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Repeats every year"
            >
              <View style={[styles.checkbox, recursAnnually && styles.checkboxChecked]}>
                {recursAnnually && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={{ color: colors.textPrimary }}>Repeats every year</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addButton} onPress={handleAdd} disabled={submitting} activeOpacity={0.85}>
              <Text style={styles.addButtonText}>{submitting ? 'Adding...' : 'Add Occasion'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  detail: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  removeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  removeButtonText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  form: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  chipSelected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextSelected: { color: colors.primary, fontWeight: '700' },
  input: {
    backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    justifyContent: 'center', minHeight: 44,
  },
  recurRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, paddingVertical: spacing.xs },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
