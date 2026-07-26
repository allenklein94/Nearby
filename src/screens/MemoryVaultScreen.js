import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addMemoryItem, getMemoryItems } from '../services/memoryVault';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const CATEGORIES = [
  { key: 'milestone', labelKey: 'milestones', placeholder: 'e.g. Our first conversation, first date' },
  { key: 'funny', labelKey: 'funnyMoments', placeholder: 'e.g. That time we got completely lost' },
  { key: 'inside_joke', labelKey: 'insideJokes', placeholder: 'e.g. Whatever only the two of you would get' },
  { key: 'note', labelKey: 'littleThings', placeholder: 'e.g. Something small worth remembering' },
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
      await addMemoryItem(matchId, categoryKey, text);
      posthog.capture('memory_vault_item_added', { category: categoryKey });
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
                  <View key={memory.id} style={styles.memoryCard} accessibilityLabel={`${memory.memory_text}, added by ${memory.profiles?.display_name}`}>
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
                    placeholder={category.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[category.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [category.key]: v }))}
                    accessibilityLabel={`Add to ${label.replace(/[^\w\s]/g, '').trim()}`}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(category.key)}
                    disabled={submittingCategory === category.key}
                    accessibilityLabel={`Add memory to ${label.replace(/[^\w\s]/g, '').trim()}`}
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