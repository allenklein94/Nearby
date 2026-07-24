import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { addMemoryItem, getMemoryItems } from '../services/memoryVault';
import { checkTextModeration } from '../services/textModeration';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const CATEGORIES = [
  { key: 'milestone', label: '🎉 Milestones', placeholder: 'e.g. Our first conversation, first date' },
  { key: 'funny', label: '😂 Funny Moments', placeholder: 'e.g. That time we got completely lost' },
  { key: 'inside_joke', label: '🤫 Inside Jokes', placeholder: 'e.g. Whatever only the two of you would get' },
  { key: 'note', label: '💭 Little Things', placeholder: 'e.g. Something small worth remembering' },
];

export default function MemoryVaultScreen({ route }) {
  const { matchId, matchName } = route.params;
  const { colors, shadow } = useTheme();
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
          <Text style={styles.headerTitle} accessibilityRole="header">💫 Memory Vault</Text>
          <Text style={styles.headerSubtitle}>
            A shared space with {matchName} to preserve the small stuff — the things worth looking back on later.
          </Text>

          {CATEGORIES.map((category) => {
            const categoryMemories = memories.filter((m) => m.category === category.key);
            return (
              <View key={category.key} style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">{category.label}</Text>

                {categoryMemories.map((memory) => (
                  <View key={memory.id} style={styles.memoryCard} accessibilityLabel={`${memory.memory_text}, added by ${memory.profiles?.display_name}`}>
                    <Text style={styles.memoryText}>{memory.memory_text}</Text>
                    <Text style={styles.memoryAddedBy}>— {memory.profiles?.display_name}</Text>
                  </View>
                ))}
                {categoryMemories.length === 0 && (
                  <Text style={styles.emptyText}>Nothing here yet.</Text>
                )}

                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder={category.placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={drafts[category.key] || ''}
                    onChangeText={(v) => setDrafts((prev) => ({ ...prev, [category.key]: v }))}
                    accessibilityLabel={`Add to ${category.label.replace(/[^\w\s]/g, '').trim()}`}
                  />
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAdd(category.key)}
                    disabled={submittingCategory === category.key}
                    accessibilityLabel={`Add memory to ${category.label.replace(/[^\w\s]/g, '').trim()}`}
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