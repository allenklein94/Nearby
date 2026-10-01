import React, { useState, useCallback } from 'react';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader, PullToRefresh } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getLegacyEntries } from '../services/relationshipLegacy';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

// Field labels: ui.legacyLibrary.field.<key>.
const FIELDS = [
  { key: 'what_surprised_us' },
  { key: 'what_almost_ended_us' },
  { key: 'what_made_us_stronger' },
  { key: 'what_we_wish_we_discussed_earlier' },
];

export default function LegacyLibraryScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getLegacyEntries();
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.legacyLibrary.loadingYourLegacyLibrary')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.legacyLibrary.couldntLoadYourLegacyLibrary')} onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('legacyLibrary.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('ui.legacyLibrary.realAnonymousReflectionsFromCouples')}
        </Text>

        {navigation && (
          <TouchableOpacity
            style={styles.contributeLink}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('RelationshipTools')}
            accessibilityRole="button"
            accessibilityLabel={t('ui.legacyLibrary.leaveYourOwnRelationshipWisdomA11y')}
          >
            <Text style={styles.contributeLinkText}>{t('ui.legacyLibrary.wantToAddYourOwn')}</Text>
          </TouchableOpacity>
        )}

        {entries.length === 0 && (
          <FadeInState style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>💌</Text>
            <EmptyCopy id="legacy_library" />
          </FadeInState>
        )}

        {entries.map((entry) => {
          const filledFields = FIELDS.filter((f) => entry[f.key]);
          if (filledFields.length === 0) return null;
          return (
            <View key={entry.id} style={styles.card}>
              {filledFields.map((f) => (
                <View key={f.key} style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>{t(`ui.legacyLibrary.field.${f.key}`)}</Text>
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

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
  contributeLink: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  contributeLinkText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  fieldBlock: { marginBottom: spacing.sm },
  fieldLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: 2 },
  fieldText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
});