import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addTimelineNote, getTimelineNotes } from '../services/timelinePlanner';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Placeholders: ui.matchNotes.timelinePlanner.placeholder.<key>.
// A section label without its leading emoji, for screen readers; letters of every script are kept (the old /[^\w\s]/
// strip removed every non-Latin letter, leaving the label empty in Russian, Chinese, Korean...).
const stripIcon = (label) => label.replace(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2000-\u2BFF\uFE0F\u200D])+\s*/, '').trim();

const PERIODS = [
  { key: 'month_1', labelKey: 'month1' },
  { key: 'month_6', labelKey: 'month6' },
  { key: 'year_1', labelKey: 'year1' },
  { key: 'year_3', labelKey: 'year3' },
];

export default function TimelinePlannerScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
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
      return Alert.alert(t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise'));
    }

    setSubmittingPeriod(periodKey);
    try {
     await addTimelineNote(matchId, periodKey, text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('timeline_note_added', { period: periodKey });
      setDrafts((prev) => ({ ...prev, [periodKey]: '' }));
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd(periodKey) });
    }
    setSubmittingPeriod(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('timeline.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {t('timeline.subtitle')}
          </Text>

          {PERIODS.map((period) => {
            const periodNotes = notes.filter((n) => n.period === period.key);
            const label = t(`timeline.${period.labelKey}`);
            return (
              <View key={period.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{label}</Text>

                {periodNotes.map((note) => (
                  <View key={note.id} style={styles.noteCard} accessibilityLabel={t('ui.matchNotes.addedByA11y', { text: note.note_text, name: note.profiles?.display_name })}>
                    <Text style={styles.noteText}>{note.note_text}</Text>
                    <Text style={styles.noteAddedBy}>— {note.profiles?.display_name}</Text>
                  </View>
                ))}
                {periodNotes.length === 0 && (
                  <Text style={styles.emptyText}>{t('timeline.noThoughtsYet')}</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={t(`ui.matchNotes.timelinePlanner.placeholder.${period.key}`)}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[period.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [period.key]: v }))}
                    accessibilityLabel={t('ui.matchNotes.timelinePlanner.addThoughtForA11y', { section: stripIcon(label) })}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(period.key)}
                    disabled={submittingPeriod === period.key}
                    accessibilityLabel={t('ui.matchNotes.timelinePlanner.addThoughtToA11y', { section: stripIcon(label) })}
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