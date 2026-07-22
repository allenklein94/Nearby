import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addSharedDecisionNote, getSharedDecisionNotes } from '../services/sharedDecisions';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const CATEGORIES = [
  { key: 'living', label: '🏡 Where to Live', placeholder: 'e.g. Open to relocating for the right reason' },
  { key: 'finances', label: '💵 Finances', placeholder: 'e.g. Prefer to keep things separate at first' },
  { key: 'family', label: '👶 Family & Parenting', placeholder: 'e.g. Want kids someday, not sure when' },
  { key: 'future', label: '🌅 Long-Term Future', placeholder: 'e.g. Would love to slow down in my 50s' },
];

export default function SharedDecisionsScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [notes, setNotes] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingCategory, setSubmittingCategory] = useState(null);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`shared-decisions:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shared_decisions', filter: `match_id=eq.${matchId}` },
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
    const data = await getSharedDecisionNotes(matchId);
    setNotes(data);
  }

  async function handleAdd(categoryKey) {
    const text = (drafts[categoryKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert('Not allowed', 'Please revise this and try again.');
    }

    setSubmittingCategory(categoryKey);
    try {
      await addSharedDecisionNote(matchId, categoryKey, text);
      setDrafts((prev) => ({ ...prev, [categoryKey]: '' }));
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmittingCategory(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle}>🧭 Big Picture Conversations</Text>
          <Text style={styles.headerSubtitle}>
            Not about finding "correct" answers — just surfacing conversations with {matchName} earlier rather than later.
          </Text>

          {CATEGORIES.map((category) => {
            const categoryNotes = notes.filter((n) => n.category === category.key);
            return (
              <View key={category.key} style={styles.section}>
                <Text style={styles.sectionLabel}>{category.label}</Text>

                {categoryNotes.map((note) => (
                  <View key={note.id} style={styles.noteCard}>
                    <Text style={styles.noteText}>{note.note_text}</Text>
                    <Text style={styles.noteAddedBy}>— {note.profiles?.display_name}</Text>
                  </View>
                ))}
                {categoryNotes.length === 0 && (
                  <Text style={styles.emptyText}>No thoughts shared yet.</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={category.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[category.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [category.key]: v }))}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(category.key)}
                    disabled={submittingCategory === category.key}
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