import React, { useState, useCallback, useEffect, useRef } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, ScrollView } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader, PullToRefresh } from '../motion';
import GoodbyeEntryComposer from '../components/GoodbyeEntryComposer';
import { useFocusEffect } from '@react-navigation/native';
import { getMyGoodbyeEntries, deleteGoodbyeEntry } from '../services/goodbyeArchive';
import LoadErrorState from '../components/LoadErrorState';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const FIELDS = [
  { key: 'what_was_beautiful', labelKey: 'whatWasBeautiful' },
  { key: 'what_was_difficult', labelKey: 'whatWasDifficult' },
  { key: 'what_you_learned', labelKey: 'whatYouLearned' },
  { key: 'what_you_want_next_time', labelKey: 'whatYouWant' },
];

export default function GoodbyeArchiveListScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Audit B9: adding an entry happens IN PLACE (the composer at the top of this list), never on a second screen. A match's chat
  // or profile opens this list with composeFor = that person's name; saving there returns to where they started.
  const [composer, setComposer] = useState(() => (route?.params?.composeFor != null ? { name: route.params.composeFor } : null));
  const scrollRef = useRef(null);
  const appliedParams = useRef(route?.params);
  useEffect(() => {
    const p = route?.params;
    if (!p || p === appliedParams.current) return;
    appliedParams.current = p;
    if (p.composeFor != null) setComposer({ name: p.composeFor });
  }, [route?.params]);

  const load = useCallback(async () => {
    try {
      const data = await getMyGoodbyeEntries();
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
      t('ui.goodbyeArchive.deleteThisReflection'),
      t('ui.goodbyeArchive.thisIsPermanentAndCannot'),
      [
        { text: t('ui.goodbyeArchive.cancel'), style: 'cancel' },
        {
          text: t('ui.goodbyeArchive.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGoodbyeEntry(entryId);
              load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmDelete(entryId) });
            }
          },
        },
      ]
    );
  }

  function startNewEntry() {
    posthog.capture('goodbye_archive_entry_started');
    setComposer({ name: '' });
    scrollRef.current?.scrollTo?.({ y: 0, animated: true });
  }

  function onComposerSaved() {
    setComposer(null);
    if (route?.params?.returnAfterSave && navigation.canGoBack()) { navigation.goBack(); return; }
    load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.goodbyeArchive.loadingYourReflections')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.goodbyeArchive.couldntLoadYourReflections')} onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('goodbyeArchive.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('goodbyeArchive.subtitle')}
        </Text>

        {composer ? (
          <GoodbyeEntryComposer
            key={composer.name}
            initialName={composer.name}
            onSaved={onComposerSaved}
            onCancel={() => setComposer(null)}
          />
        ) : (
        <TouchableOpacity
          style={styles.addButton}
          onPress={startNewEntry}
          activeOpacity={0.85}
          accessibilityLabel={t('goodbyeArchive.addReflection')}
          accessibilityRole="button"
        >
          <Text style={styles.addButtonText}>{t('goodbyeArchive.addReflection')}</Text>
        </TouchableOpacity>
        )}

        {entries.length === 0 && (
          <FadeInState style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🌙</Text>
            <Text style={styles.emptyText}>{t('goodbyeArchive.nothingYet')}</Text>
          </FadeInState>
        )}

        {entries.map((entry) => {
          const filledFields = FIELDS.filter((f) => entry[f.key]);
          return (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{entry.about_display_name || t('ui.goodbyeArchive.someone')}</Text>
                <TouchableOpacity
                  onPress={() => confirmDelete(entry.id)}
                  accessibilityLabel={t('ui.goodbyeArchive.deleteReflectionAboutA11y', { aboutDisplayName: entry.about_display_name || t('ui.goodbyeArchive.thisPersonA11y') })}
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteText}>{t('ui.goodbyeArchive.delete')}</Text>
                </TouchableOpacity>
              </View>
              {filledFields.map((f) => (
                <View key={f.key} style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>{t(`goodbyeArchive.${f.labelKey}`)}</Text>
                  <Text style={styles.fieldText}>{entry[f.key]}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  addButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg, ...shadow.button,
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  deleteText: { color: colors.danger, fontSize: 12, opacity: 0.7 },
  fieldBlock: { marginBottom: spacing.sm },
  fieldLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: 2 },
  fieldText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
});