import React, { useEffect, useState } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { NLoader } from '../motion';
import { addMemoryItem, getMemoryItems } from '../services/memoryVault';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// Placeholders: ui.matchNotes.memoryVault.placeholder.<key>.
// A section label without its leading emoji, for screen readers; letters of every script are kept (the old /[^\w\s]/
// strip removed every non-Latin letter, leaving the label empty in Russian, Chinese, Korean...).
const stripIcon = (label) => label.replace(/^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2000-\u2BFF\uFE0F\u200D])+\s*/, '').trim();

const CATEGORIES = [
  { key: 'milestone', labelKey: 'milestones' },
  { key: 'funny', labelKey: 'funnyMoments' },
  { key: 'inside_joke', labelKey: 'insideJokes' },
  { key: 'note', labelKey: 'littleThings' },
];

export default function MemoryVaultScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [memories, setMemories] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [submittingCategory, setSubmittingCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`memory-vault:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'memory_vault_items', filter: `match_id=eq.${matchId}` },
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
    const data = await getMemoryItems(matchId);
    setMemories(data);
    setLoading(false);
  }

  async function handleAdd(categoryKey) {
    const text = (drafts[categoryKey] || '').trim();
    if (!text) return;

    const check = await checkTextModeration(text);
    if (!check.safe) {
      return Alert.alert(t('ui.matchNotes.notAllowed'), t('ui.matchNotes.pleaseRevise'));
    }

    setSubmittingCategory(categoryKey);
    try {
      await addMemoryItem(matchId, categoryKey, text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      posthog.capture('memory_vault_item_added', { category: categoryKey });
      setDrafts((prev) => ({ ...prev, [categoryKey]: '' }));
      load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAdd(categoryKey) });
    }
    setSubmittingCategory(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('memoryVault.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {t('memoryVault.subtitle')}
          </Text>

          {CATEGORIES.map((category) => {
            const categoryMemories = memories.filter((m) => m.category === category.key);
            const label = t(`memoryVault.${category.labelKey}`);
            return (
              <View key={category.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{label}</Text>

                {categoryMemories.map((memory) => (
                  <View key={memory.id} style={styles.memoryCard} accessibilityLabel={t('ui.matchNotes.addedByA11y', { text: memory.memory_text, name: memory.profiles?.display_name })}>
                    <Text style={styles.memoryText}>{memory.memory_text}</Text>
                    <Text style={styles.memoryAddedBy}>— {memory.profiles?.display_name}</Text>
                  </View>
                ))}
                {categoryMemories.length === 0 && (
                  <Text style={styles.emptyText}>{t('memoryVault.nothingYet')}</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={t(`ui.matchNotes.memoryVault.placeholder.${category.key}`)}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[category.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [category.key]: v }))}
                    accessibilityLabel={t('ui.matchNotes.memoryVault.addToA11y', { section: stripIcon(label) })}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(category.key)}
                    disabled={submittingCategory === category.key}
                    accessibilityLabel={t('ui.matchNotes.memoryVault.addMemoryToA11y', { section: stripIcon(label) })}
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
  memoryCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  memoryText: { color: colors.textPrimary, fontSize: 14 },
  memoryAddedBy: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.md, width: 40, justifyContent: 'center', alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});