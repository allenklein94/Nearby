import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addConstitutionEntry, getConstitutionEntries } from '../services/relationshipConstitution';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const ARTICLES = [
  { key: 'conflict', label: '⚖️ How We Handle Conflict', placeholder: 'e.g. We take a break if things get heated, then come back to it' },
  { key: 'decisions', label: '🤝 How We Make Big Decisions', placeholder: 'e.g. We talk it through together before deciding, always' },
  { key: 'support', label: '🌱 How We Support Each Other\'s Dreams', placeholder: 'e.g. We show up for the things that matter to the other person' },
  { key: 'never_forget', label: '💎 What We Never Want to Take for Granted', placeholder: 'e.g. Saying thank you, even for small things' },
  { key: 'feel_loved', label: '❤️ What Makes Each of Us Feel Loved', placeholder: 'e.g. Being listened to without being interrupted' },
];

export default function RelationshipConstitutionScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [entries, setEntries] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingArticle, setSubmittingArticle] = useState(null);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`constitution:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'constitution_entries', filter: `match_id=eq.${matchId}` },
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
    const data = await getConstitutionEntries(matchId);
    setEntries(data);
  }

  async function handleAdd(articleKey) {
    const text = (drafts[articleKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert('Not allowed', 'Please revise this and try again.');
    }

    setSubmittingArticle(articleKey);
    try {
      await addConstitutionEntry(matchId, articleKey, text);
      setDrafts((prev) => ({ ...prev, [articleKey]: '' }));
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSubmittingArticle(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">📜 Our Constitution</Text>
          <Text style={styles.headerSubtitle}>
            A living agreement with {matchName} — not legal, just human. The invisible rules every relationship eventually creates anyway, written down together instead of left unspoken.
          </Text>

          {ARTICLES.map((article) => {
            const articleEntries = entries.filter((e) => e.article === article.key);
            return (
              <View key={article.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{article.label}</Text>

                {articleEntries.map((entry) => (
                  <View key={entry.id} style={styles.entryCard} accessibilityLabel={`${entry.entry_text}, added by ${entry.profiles?.display_name}`}>
                    <Text style={styles.entryText}>{entry.entry_text}</Text>
                    <Text style={styles.entryAddedBy}>— {entry.profiles?.display_name}</Text>
                  </View>
                ))}
                {articleEntries.length === 0 && (
                  <Text style={styles.emptyText}>Nothing written yet.</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={article.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[article.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [article.key]: v }))}
                    multiline
                    accessibilityLabel={`Add to ${article.label.replace(/[^\w\s]/g, '').trim()}`}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(article.key)}
                    disabled={submittingArticle === article.key}
                    accessibilityLabel={`Add entry to ${article.label.replace(/[^\w\s]/g, '').trim()}`}
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
  entryCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  entryText: { color: colors.textPrimary, fontSize: 14 },
  entryAddedBy: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 44 },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});