import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addStressTestNote, getStressTestNotes } from '../services/stressTest';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Placeholders: ui.matchNotes.stressTest.placeholder.<key>.
// A section label without its leading emoji, for screen readers; letters of every script are kept (the old /[^\w\s]/
// strip removed every non-Latin letter, leaving the label empty in Russian, Chinese, Korean...).
const stripIcon = (label) => label.replace(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2000-\u2BFF\uFE0F\u200D])+\s*/, '').trim();

const SCENARIOS = [
  { key: 'dream_opportunity', labelKey: 'dreamOpportunity' },
  { key: 'financial_setback', labelKey: 'financialSetback' },
  { key: 'family_conflict', labelKey: 'familyConflict' },
  { key: 'lifestyle_difference', labelKey: 'lifestyleDifference' },
];

export default function StressTestScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [notes, setNotes] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingScenario, setSubmittingScenario] = useState(null);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`stress-test:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'stress_test_notes', filter: `match_id=eq.${matchId}` },
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
    const data = await getStressTestNotes(matchId);
    setNotes(data);
  }

  async function handleAdd(scenarioKey) {
    const text = (drafts[scenarioKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert(t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise'));
    }

    setSubmittingScenario(scenarioKey);
    try {
      await addStressTestNote(matchId, scenarioKey, text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('stress_test_note_added', { scenario: scenarioKey });
      setDrafts((prev) => ({ ...prev, [scenarioKey]: '' }));
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd(scenarioKey) });
    }
    setSubmittingScenario(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('stressTest.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {t('stressTest.subtitle')}
          </Text>

          {SCENARIOS.map((scenario) => {
            const scenarioNotes = notes.filter((n) => n.scenario === scenario.key);
            const label = t(`stressTest.${scenario.labelKey}`);
            return (
              <View key={scenario.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{label}</Text>

                {scenarioNotes.map((note) => (
                  <View key={note.id} style={styles.noteCard} accessibilityLabel={t('ui.matchNotes.addedByA11y', { text: note.note_text, name: note.profiles?.display_name })}>
                    <Text style={styles.noteText}>{note.note_text}</Text>
                    <Text style={styles.noteAddedBy}>— {note.profiles?.display_name}</Text>
                  </View>
                ))}
                {scenarioNotes.length === 0 && (
                  <Text style={styles.emptyText}>{t('timeline.noThoughtsYet')}</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={t(`ui.matchNotes.stressTest.placeholder.${scenario.key}`)}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[scenario.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [scenario.key]: v }))}
                    multiline
                    accessibilityLabel={t('ui.matchNotes.stressTest.addThoughtForA11y', { section: stripIcon(label) })}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(scenario.key)}
                    disabled={submittingScenario === scenario.key}
                    accessibilityLabel={t('ui.matchNotes.stressTest.addThoughtToA11y', { section: stripIcon(label) })}
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
  input: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, minHeight: 44 },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});