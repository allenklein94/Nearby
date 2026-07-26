import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyChemistryEntries, deleteChemistryEntry } from '../services/chemistryDiary';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const SIGNALS = [
  { key: 'felt_relaxed', icon: '😌', labelKey: 'relaxed' },
  { key: 'felt_curious', icon: '🤔', labelKey: 'curious' },
  { key: 'felt_respected', icon: '🤝', labelKey: 'respected' },
  { key: 'felt_laughed', icon: '😄', labelKey: 'laughed' },
  { key: 'felt_like_myself', icon: '✨', labelKey: 'likeMyself' },
];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ChemistryDiaryListScreen() {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await getMyChemistryEntries();
    setEntries(data);
    setLoading(false);
  }, []);

  // Reload on focus, not just mount — so a new entry added from a
  // chat or profile shows up immediately on return, without needing
  // to navigate away and back to force a remount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmDelete(entryId) {
    Alert.alert(
      'Delete this entry?',
      'This is permanent and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChemistryEntry(entryId);
              posthog.capture('chemistry_diary_entry_deleted');
              load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('chemistryDiary.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('chemistryDiary.subtitle')}
        </Text>

        {entries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📔</Text>
            <Text style={styles.emptyText}>Nothing here yet. Add an entry any time after spending time with someone, from their profile or a chat.</Text>
          </View>
        )}

        {entries.map((entry) => {
          const activeSignals = SIGNALS.filter((s) => entry[s.key]);
          return (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>{entry.about_display_name || 'Someone'}</Text>
                  <Text style={styles.cardDate}>{formatDate(entry.created_at)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => confirmDelete(entry.id)}
                  accessibilityLabel={`Delete entry about ${entry.about_display_name || 'this person'}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
              {activeSignals.length > 0 && (
                <View style={styles.signalsWrap}>
                  {activeSignals.map((s) => (
                    <View key={s.key} style={styles.signalChip}>
                      <Text style={styles.signalChipText}>{s.icon} {t(`chemistryDiary.${s.labelKey}`)}</Text>
                    </View>
                  ))}
                </View>
              )}
              {entry.note_text && <Text style={styles.noteText}>{entry.note_text}</Text>}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  cardDate: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  deleteText: { color: colors.primary, fontSize: 12, opacity: 0.7 },
  signalsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  signalChip: { backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  signalChipText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  noteText: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
});