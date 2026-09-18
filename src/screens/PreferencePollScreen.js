import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator } from 'react-native';
import FadeInState from '../components/FadeInState';
import BrandedLoader from '../components/BrandedLoader';
import * as Haptics from 'expo-haptics';
import { getMyPendingPreferencePolls, answerPreferencePoll } from '../services/preferencePolls';
import { preferencePollQuestion } from '../constants/preferencePollQuestions';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Item 100 (CLAUDE.md, "Let the recipient contribute preferences without
// spoiling the surprise"), half B: the target-facing side of a real,
// disguised preference_polls question. Deliberately plain -- a bare "here's
// a quick question, pick your answer" screen with no reference to any
// occasion, since get_my_pending_preference_polls() never returns
// occasion_context in the first place (this screen has no way to show what
// it isn't given). Reached via a tap on the "💬 Quick question" push
// (notifications.js's `preference_poll_received` case), and also directly
// reachable so a real pending question is never a dead end if the push was
// missed/dismissed -- see the small entry point on HomeScreen.
export default function PreferencePollScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answeringId, setAnsweringId] = useState(null);
  const [selections, setSelections] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const data = await getMyPendingPreferencePolls();
    setPolls(data);
    setLoading(false);
  }

  function toggleOption(pollId, optionKey) {
    setSelections((prev) => {
      const current = new Set(prev[pollId] ?? []);
      if (current.has(optionKey)) current.delete(optionKey);
      else current.add(optionKey);
      return { ...prev, [pollId]: Array.from(current) };
    });
  }

  async function submit(pollId) {
    const answerKeys = selections[pollId];
    if (!answerKeys || answerKeys.length === 0) return;
    setAnsweringId(pollId);
    try {
      await answerPreferencePoll(pollId, answerKeys);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPolls((prev) => prev.filter((p) => p.id !== pollId));
    } catch (e) {
      // Best-effort UX only -- an expired/already-answered poll simply
      // disappears from the list on the next load rather than erroring loudly.
      load();
    }
    setAnsweringId(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <BrandedLoader fullScreen={false} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {polls.length === 0 && (
          <FadeInState style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No questions right now</Text>
            <Text style={styles.emptyText}>When someone you know sends a quick question, it'll show up here.</Text>
          </FadeInState>
        )}
        {polls.map((poll) => {
          const question = preferencePollQuestion(poll.questionKey);
          if (!question) return null;
          const selected = new Set(selections[poll.id] ?? []);
          return (
            <View key={poll.id} style={styles.card}>
              <Text style={styles.askerText}>{poll.askerDisplayName ?? 'Someone you know'} asked:</Text>
              <Text style={styles.questionText}>{question.questionText}</Text>
              <View style={styles.chipRow}>
                {question.options.map((o) => {
                  const isSelected = selected.has(o.key);
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => toggleOption(poll.id, o.key)}
                      activeOpacity={0.8}
                      accessibilityLabel={o.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{o.icon ? `${o.icon} ` : ''}{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.submitButton, selected.size === 0 && styles.submitButtonDisabled]}
                onPress={() => submit(poll.id)}
                disabled={selected.size === 0 || answeringId === poll.id}
                activeOpacity={0.85}
                accessibilityLabel="Send answer"
                accessibilityRole="button"
              >
                {answeringId === poll.id ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Send Answer</Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, gap: spacing.xs },
  emptyTitle: { ...typography.headline, color: colors.textPrimary },
  emptyText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13, paddingHorizontal: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  askerText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.xs },
  questionText: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
