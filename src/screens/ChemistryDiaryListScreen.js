import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, TextInput, Modal, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyChemistryEntries, deleteChemistryEntry } from '../services/chemistryDiary';
import { usePostHog } from 'posthog-react-native';
import LoadErrorState from '../components/LoadErrorState';
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

const MIN_ENTRIES_FOR_INSIGHTS = 3;

function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// A gentle, honest reflection of actual patterns — not a score or a
// judgment, just "here's what showed up most often." Deliberately
// avoids ranking people or comparisons; it's about the person's own
// felt experience over time, which is the whole premise of this
// feature ("a picture of what actually feels good").
function computeInsights(entries) {
  const counts = {};
  for (const signal of SIGNALS) counts[signal.key] = 0;

  for (const entry of entries) {
    for (const signal of SIGNALS) {
      if (entry[signal.key]) counts[signal.key]++;
    }
  }

  const total = entries.length;
  return SIGNALS
    .map((signal) => ({ ...signal, count: counts[signal.key], percent: total > 0 ? Math.round((counts[signal.key] / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

export default function ChemistryDiaryListScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await getMyChemistryEntries();
      setEntries(data);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

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

  function toggleInsights() {
    const opening = !showInsights;
    setShowInsights(opening);
    if (opening) posthog.capture('chemistry_diary_insights_viewed');
  }

  function startNewEntry() {
    setNameInput('');
    setNameModalVisible(true);
  }

  function proceedToEntry() {
    if (!nameInput.trim()) {
      return Alert.alert('Add a name', "Who is this entry about? First name or however you'd like to remember them.");
    }
    setNameModalVisible(false);
    posthog.capture('chemistry_diary_entry_started');
    navigation.navigate('ChemistryDiaryEntry', { aboutDisplayName: nameInput.trim() });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your check-ins...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your Chemistry Diary." onRetry={load} />
      </SafeAreaView>
    );
  }

  const insights = computeInsights(entries);
  const canShowInsights = entries.length >= MIN_ENTRIES_FOR_INSIGHTS;
  const topSignal = insights[0];

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

        <TouchableOpacity
          style={styles.addButton}
          onPress={startNewEntry}
          activeOpacity={0.85}
          accessibilityLabel="Add a chemistry check-in entry"
          accessibilityRole="button"
        >
          <Text style={styles.addButtonText}>+ Add Entry</Text>
        </TouchableOpacity>

        {canShowInsights && (
          <TouchableOpacity
            style={styles.insightsCard}
            onPress={toggleInsights}
            activeOpacity={0.85}
            accessibilityLabel={`Your patterns across ${entries.length} entries, ${showInsights ? 'tap to collapse' : 'tap to see the full picture'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: showInsights }}
          >
            <View style={styles.insightsHeaderRow}>
              <Text style={styles.insightsTitle}>✨ Your Patterns</Text>
              <Text style={styles.insightsChevron}>{showInsights ? '⌃' : '⌄'}</Text>
            </View>
            {!showInsights && topSignal.count > 0 && (
              <Text style={styles.insightsTeaser}>
                {topSignal.icon} {t(`chemistryDiary.${topSignal.labelKey}`)} showed up most — {topSignal.percent}% of the time across {entries.length} entries.
              </Text>
            )}
            {showInsights && (
              <View style={styles.insightsBody}>
                <Text style={styles.insightsBodyText}>Across {entries.length} entries, here's what actually showed up:</Text>
                {insights.map((signal) => (
                  <View key={signal.key} style={styles.insightRow}>
                    <Text style={styles.insightLabel}>{signal.icon} {t(`chemistryDiary.${signal.labelKey}`)}</Text>
                    <View style={styles.insightBarTrack}>
                      <View style={[styles.insightBarFill, { width: `${signal.percent}%` }]} />
                    </View>
                    <Text style={styles.insightPercent}>{signal.percent}%</Text>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        )}

        {!canShowInsights && entries.length > 0 && (
          <Text style={styles.insightsHint}>
            {MIN_ENTRIES_FOR_INSIGHTS - entries.length} more {MIN_ENTRIES_FOR_INSIGHTS - entries.length === 1 ? 'entry' : 'entries'} until your patterns start to show.
          </Text>
        )}

        {entries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📔</Text>
            <Text style={styles.emptyText}>Nothing here yet. Add an entry any time after spending time with someone — above, or from their profile or a chat.</Text>
          </View>
        )}

        {entries.map((entry) => {
          const filledSignals = SIGNALS.filter((s) => entry[s.key]);
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
              {filledSignals.length > 0 && (
                <View style={styles.signalsWrap}>
                  {filledSignals.map((s) => (
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

      <Modal visible={nameModalVisible} animationType="slide" transparent onRequestClose={() => setNameModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Who is this entry about?</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="First name or however you'd like to remember them"
              placeholderTextColor={colors.textTertiary}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              accessibilityLabel="Name"
            />
            <TouchableOpacity
              style={styles.sheetButton}
              onPress={proceedToEntry}
              activeOpacity={0.85}
              accessibilityLabel="Continue"
              accessibilityRole="button"
            >
              <Text style={styles.sheetButtonText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setNameModalVisible(false)}
              style={{ marginTop: spacing.md }}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  addButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  nameInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  sheetButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  sheetButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
  insightsCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.primary,
  },
  insightsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightsTitle: { ...typography.bodyBold, color: colors.primary, fontSize: 15 },
  insightsChevron: { color: colors.primary, fontSize: 16 },
  insightsTeaser: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  insightsHint: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg, fontStyle: 'italic' },
  insightsBody: { marginTop: spacing.md },
  insightsBodyText: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
  insightRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  insightLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', width: 110 },
  insightBarTrack: { flex: 1, height: 8, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  insightBarFill: { height: '100%', backgroundColor: colors.textPrimary, borderRadius: 4 },
  insightPercent: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },
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
  deleteText: { color: colors.danger, fontSize: 12, opacity: 0.7 },
  signalsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  signalChip: { backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  signalChipText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  noteText: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
});