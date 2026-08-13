import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getLegacyEntries } from '../services/relationshipLegacy';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const FIELDS = [
  { key: 'what_surprised_us', label: '✨ What surprised them' },
  { key: 'what_almost_ended_us', label: '💔 What almost ended it' },
  { key: 'what_made_us_stronger', label: '💪 What made them stronger' },
  { key: 'what_we_wish_we_discussed_earlier', label: '💬 What they wish they\u2019d discussed earlier' },
];

export default function LegacyLibraryScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await getLegacyEntries();
    setEntries(data);
    setLoading(false);
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
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your legacy library...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('legacyLibrary.title')}</Text>
        <Text style={styles.headerSubtitle}>
          Real, anonymous reflections from couples who found each other here — shared to help you navigate your own relationships.
        </Text>

        {navigation && (
          <TouchableOpacity
            style={styles.contributeLink}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('RelationshipTools')}
            accessibilityRole="button"
            accessibilityLabel="Leave your own relationship wisdom for a match"
          >
            <Text style={styles.contributeLinkText}>💌 Want to add your own? Leave wisdom with a match →</Text>
          </TouchableOpacity>
        )}

        {entries.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>💌</Text>
            <Text style={styles.emptyText}>Nothing shared yet — this library grows as couples choose to leave their reflections.</Text>
          </View>
        )}

        {entries.map((entry) => {
          const filledFields = FIELDS.filter((f) => entry[f.key]);
          if (filledFields.length === 0) return null;
          return (
            <View key={entry.id} style={styles.card}>
              {filledFields.map((f) => (
                <View key={f.key} style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
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