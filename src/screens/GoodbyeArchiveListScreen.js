import React, { useState, useCallback } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, TextInput, Modal, ScrollView } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader, PullToRefresh, modalAnimation } from '../motion';
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

export default function GoodbyeArchiveListScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState('');

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
    setNameInput('');
    setNameModalVisible(true);
  }

  function proceedToEntry() {
    if (!nameInput.trim()) {
      return Alert.alert(t('ui.goodbyeArchive.addAName'), t('ui.goodbyeArchive.whoIsThisReflectionAbout'));
    }
    setNameModalVisible(false);
    posthog.capture('goodbye_archive_entry_started');
    navigation.navigate('GoodbyeArchiveEntry', { aboutDisplayName: nameInput.trim() });
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
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('goodbyeArchive.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('goodbyeArchive.subtitle')}
        </Text>

        <TouchableOpacity
          style={styles.addButton}
          onPress={startNewEntry}
          activeOpacity={0.85}
          accessibilityLabel={t('goodbyeArchive.addReflection')}
          accessibilityRole="button"
        >
          <Text style={styles.addButtonText}>{t('goodbyeArchive.addReflection')}</Text>
        </TouchableOpacity>

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

      <Modal visible={nameModalVisible} animationType={modalAnimation('slide')} transparent onRequestClose={() => setNameModalVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('goodbyeArchive.whoIsThisAbout')}</Text>
            <TextInput
              style={styles.nameInput}
              placeholder={t('ui.goodbyeArchive.firstNameOrHoweverYoud')}
              placeholderTextColor={colors.textTertiary}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              accessibilityLabel={t('ui.goodbyeArchive.nameA11y')}
            />
            <TouchableOpacity
              style={styles.sheetButton}
              onPress={proceedToEntry}
              activeOpacity={0.85}
              accessibilityLabel={t('ui.goodbyeArchive.continueA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.sheetButtonText}>{t('ui.goodbyeArchive.continue')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setNameModalVisible(false)}
              style={{ marginTop: spacing.md }}
              accessibilityLabel={t('ui.goodbyeArchive.cancelA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{t('ui.goodbyeArchive.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  nameInput: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  sheetButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  sheetButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelText: { color: colors.textTertiary, textAlign: 'center', fontSize: 13 },
});