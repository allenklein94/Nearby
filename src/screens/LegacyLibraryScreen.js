import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from 'react-native';
import { getLegacyEntries } from '../services/relationshipLegacy';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

const FIELDS = [
  { key: 'what_surprised_us', label: '✨ What surprised them' },
  { key: 'what_almost_ended_us', label: '💔 What almost ended it' },
  { key: 'what_made_us_stronger', label: '💪 What made them stronger' },
  { key: 'what_we_wish_we_discussed_earlier', label: '💬 What they wish they\u2019d discussed earlier' },
];

export default function LegacyLibraryScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await getLegacyEntries();
    setEntries(data);
    setLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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
        <Text style={styles.headerTitle} accessibilityRole="header">💌 Relationship Wisdom</Text>
        <Text style={styles.headerSubtitle}>
          Real, anonymous reflections from couples who found each other here — shared to help you navigate your own relationships.
        </Text>

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
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
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