import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addTimelineNote, getTimelineNotes } from '../services/timelinePlanner';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const PERIODS = [
  { key: 'month_1', label: '📅 Month 1', placeholder: 'e.g. Getting to know each other, no pressure' },
  { key: 'month_6', label: '📅 Month 6', placeholder: 'e.g. When exclusivity feels right to discuss' },
  { key: 'year_1', label: '📅 Year 1', placeholder: 'e.g. Thoughts on living arrangements' },
  { key: 'year_3', label: '📅 Year 3+', placeholder: 'e.g. Marriage, family, long-term plans' },
];

export default function TimelinePlannerScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [notes, setNotes] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingPeriod, setSubmittingPeriod] = useState(null);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`timeline:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'timeline_notes', filter: `match_id=eq.${matchId}` },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const data = await getTimelineNotes(matchId);
    setNotes(data);
  }

  async function handleAdd(periodKey) {
    const text = (drafts[periodKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert('Not allowed', 'Please revise this and try again.');
    }

    setSubmittingPeriod(periodKey);
    try {
      await addTimelineNote(matchId, periodKey, text);
      setDrafts((prev) => ({ ...prev, [periodKey]: '' }));
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmittingPeriod(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">🗓️ Timeline Thoughts</Text>
          <Text style={styles.headerSubtitle}>
            Not a rulebook — just a space with {matchName} to surface expectations around timing before mismatches turn into friction. Skip whatever doesn't apply.
          </Text>

          {PERIODS.map((period) => {
            const periodNotes = notes.filter((n) => n.period === period.key);
            return (
              <View key={period.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{period.label}</Text>

                {periodNotes.map((note) => (
                  <View key={note.id} style={styles.noteCard} accessibilityLabel={`${note.note_text}, added by ${note.profiles?.display_name}`}>
                    <Text style={styles.noteText}>{note.note_text}</Text>
                    <Text style={styles.noteAddedBy}>— {note.profiles?.display_name}</Text>
                  </View>
                ))}
                {periodNotes.length === 0 && (
                  <Text style={styles.emptyText}>No thoughts shared yet.</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={period.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[period.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [period.key]: v }))}
                    accessibilityLabel={`Add a thought for ${period.label}`}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(period.key)}
                    disabled={submittingPeriod === period.key}
                    accessibilityLabel={`Add thought to ${period.label}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  section: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.sm },
  noteCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  noteText: { color: colors.textPrimary, fontSize: 14 },
  noteAddedBy: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});