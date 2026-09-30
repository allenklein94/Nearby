import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addTripIdea, getTripIdeas } from '../services/tripPlanning';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Section names and placeholders: ui.tripPlanning.section.<key> / ui.tripPlanning.placeholder.<key>.
const CATEGORIES = [
  { key: 'destination', icon: '📍' },
  { key: 'activity', icon: '🎒' },
  { key: 'budget', icon: '💰' },
];

export default function TripPlanningScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [ideas, setIdeas] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingCategory, setSubmittingCategory] = useState(null);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`trip-ideas:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_ideas', filter: `match_id=eq.${matchId}` },
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
    const data = await getTripIdeas(matchId);
    setIdeas(data);
  }

  async function handleAdd(categoryKey) {
    const text = (drafts[categoryKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert(t('ui.tripPlanning.notAllowed'), t('ui.tripPlanning.pleaseReviseThisAndTry'));
    }

    setSubmittingCategory(categoryKey);
    try {
      await addTripIdea(matchId, categoryKey, text);
      posthog.capture('trip_idea_added', { category: categoryKey });
      setDrafts((prev) => ({ ...prev, [categoryKey]: '' }));
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd(categoryKey) });
    }
    setSubmittingCategory(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('together.planTrip')}</Text>
          <Text style={styles.headerSubtitle}>{t('ui.tripPlanning.hypotheticallyOfCourseBrainstormWith', { matchName: matchName })}</Text>

          {CATEGORIES.map((category) => {
            const categoryIdeas = ideas.filter((i) => i.category === category.key);
            return (
              <View key={category.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{category.icon} {t(`ui.tripPlanning.section.${category.key}`)}</Text>

                {categoryIdeas.map((idea) => (
                  <View key={idea.id} style={styles.ideaCard} accessibilityLabel={t('ui.tripPlanning.addedByA11y', { ideaText: idea.idea_text, name: idea.profiles?.display_name })}>
                    <Text style={styles.ideaText}>{idea.idea_text}</Text>
                    <Text style={styles.ideaAddedBy}>— {idea.profiles?.display_name}</Text>
                  </View>
                ))}
                {categoryIdeas.length === 0 && (
                  <EmptyCopy id="trip_ideas" />
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={t(`ui.tripPlanning.placeholder.${category.key}`)}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[category.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [category.key]: v }))}
                    accessibilityLabel={t('ui.tripPlanning.addIdeaA11y', { section: t(`ui.tripPlanning.section.${category.key}`) })}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(category.key)}
                    disabled={submittingCategory === category.key}
                    accessibilityLabel={t('ui.tripPlanning.addIdeaToA11y', { section: t(`ui.tripPlanning.section.${category.key}`) })}
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
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg },
  section: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.sm },
  ideaCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  ideaText: { color: colors.textPrimary, fontSize: 14 },
  ideaAddedBy: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});