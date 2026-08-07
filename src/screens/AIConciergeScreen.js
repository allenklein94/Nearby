import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { askConcierge } from '../services/aiConcierge';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const SUGGESTIONS = ['Something fun tonight', 'A quiet coffee this weekend', 'Somewhere to meet new people', 'A deal nearby'];

const TYPE_META = {
  gathering: { icon: '📅', label: 'Gathering' },
  community: { icon: '🏘️', label: 'Community' },
  perk: { icon: '🎁', label: 'Perk' },
};

export default function AIConciergeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  async function handleAsk(text) {
    const q = (text ?? query).trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const picks = await askConcierge(q);
      setResults(picks);
    } catch (e) {
      setError(e.message || 'The Concierge is unavailable right now.');
    }
    setLoading(false);
  }

  function handleSelect(item) {
    if (item.conciergeType === 'gathering') {
      navigation.navigate('GatheringDetail', { gatheringId: item.id });
    } else if (item.conciergeType === 'community') {
      navigation.navigate('CommunityDetail', { communityId: item.id, communityName: item.name });
    } else {
      navigation.navigate('BrandOffers');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Text style={styles.subtitle}>Tell me what you're in the mood for, and I'll look through what's actually happening nearby.</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="e.g. something low-key tonight"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => handleAsk()}
              returnKeyType="search"
              accessibilityLabel="Ask the Concierge what you're looking for"
            />
            <TouchableOpacity style={styles.askButton} onPress={() => handleAsk()} disabled={loading} accessibilityLabel="Ask" accessibilityRole="button">
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.askButtonText}>Ask</Text>}
            </TouchableOpacity>
          </View>

          {results === null && !loading && (
            <View style={styles.suggestionsRow}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => { setQuery(s); handleAsk(s); }} accessibilityRole="button">
                  <Text style={styles.suggestionChipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        <FlatList
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm }}
          data={results ?? []}
          keyExtractor={(item) => `${item.conciergeType}-${item.id}`}
          ListEmptyComponent={
            results !== null && !loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>🤔</Text>
                <Text style={styles.emptyText}>Nothing quite fit that — try a different way of describing what you're after.</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const meta = TYPE_META[item.conciergeType];
            const catStyle = item.interest_tag ? categoryStyleFor(item.interest_tag) : null;
            return (
              <TouchableOpacity style={styles.resultCard} onPress={() => handleSelect(item)} activeOpacity={0.85} accessibilityLabel={`${item.title ?? item.name}, ${item.conciergeReason}`} accessibilityRole="button">
                <Text style={styles.resultIcon}>{catStyle?.icon ?? meta.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTypeLabel}>{meta.label}</Text>
                  <Text style={styles.resultTitle}>{item.title ?? item.name}</Text>
                  <Text style={styles.resultReason}>{item.conciergeReason}</Text>
                </View>
                <Text style={styles.resultChevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  inputWrap: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  askButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  askButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  suggestionChip: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  suggestionChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.md, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.lg },
  resultCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  resultIcon: { fontSize: 24, marginRight: spacing.sm },
  resultTypeLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 },
  resultReason: { color: colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  resultChevron: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
});
