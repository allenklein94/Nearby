import React, { useEffect, useState, useCallback } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { TOGETHER_NOTES_KINDS, sectionA11yName } from '../constants/togetherNotesKinds';

// Notes two matched people write together, by section (screen-reduction audit B6): trip ideas, big picture, timeline,
// stress test, constitution. One screen; `kind` picks the sections, table and strings (constants/togetherNotesKinds.js).
export default function TogetherNotesScreen({ route }) {
  const { kind, matchId, matchName } = route.params;
  const cfg = TOGETHER_NOTES_KINDS[kind];
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [notes, setNotes] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingSection, setSubmittingSection] = useState(null);

  const load = useCallback(async () => {
    const data = await cfg.load(matchId);
    setNotes(data);
  }, [cfg, matchId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`${cfg.channel}:${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: cfg.table, filter: `match_id=eq.${matchId}` }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cfg, matchId, load]);

  async function handleAdd(sectionKey) {
    const text = (drafts[sectionKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      const [title, body] = cfg.notAllowed(t);
      return Alert.alert(title, body);
    }

    setSubmittingSection(sectionKey);
    try {
      await cfg.add(matchId, sectionKey, text);
      if (cfg.haptic) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture(cfg.event, { [cfg.eventProp]: sectionKey });
      setDrafts((prev) => ({ ...prev, [sectionKey]: '' }));
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd(sectionKey) });
    }
    setSubmittingSection(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{cfg.title(t)}</Text>
          <Text style={styles.headerSubtitle}>{cfg.subtitle(t, matchName)}</Text>

          {cfg.sections.map((section) => {
            const sectionNotes = notes.filter((n) => n[cfg.sectionField] === section.key);
            const label = cfg.label(t, section);
            const a11yName = sectionA11yName(cfg, t, section);
            return (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{label}</Text>

                {sectionNotes.map((note) => (
                  <View key={note.id} style={styles.noteCard} accessibilityLabel={cfg.addedByA11y(t, note[cfg.textField], note.profiles?.display_name)}>
                    <Text style={styles.noteText}>{note[cfg.textField]}</Text>
                    <Text style={styles.noteAddedBy}>— {note.profiles?.display_name}</Text>
                  </View>
                ))}
                {sectionNotes.length === 0 && (
                  cfg.empty.emptyCopyId
                    ? <EmptyCopy id={cfg.empty.emptyCopyId} />
                    : <Text style={styles.emptyText}>{t(cfg.empty.textKey)}</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={[styles.input, cfg.multiline && styles.inputMultiline]}
                    placeholder={cfg.placeholder(t, section)}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[section.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [section.key]: v }))}
                    multiline={cfg.multiline}
                    accessibilityLabel={cfg.inputA11y(t, a11yName)}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(section.key)}
                    disabled={submittingSection === section.key}
                    accessibilityLabel={cfg.buttonA11y(t, a11yName)}
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
  inputMultiline: { minHeight: 44 },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
