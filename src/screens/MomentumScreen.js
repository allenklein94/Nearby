import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMomentumStats } from '../services/momentum';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

function deltaSymbol(current, previous) {
  if (current > previous) return '▲';
  if (current < previous) return '▼';
  return '—';
}

function weekLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MomentumScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const data = await getMomentumStats();
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your momentum...</Text>
      </SafeAreaView>
    );
  }

  if (!stats) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Sign in to see your momentum.</Text>
      </SafeAreaView>
    );
  }

  const maxWeekCount = Math.max(...stats.weeks.map((w) => w.count), 1);
  const hasAnyActivity = stats.weeks.some((w) => w.count > 0);
  const deltas = [
    { key: 'attended', label: 'Gatherings attended' },
    { key: 'friends', label: 'New friends' },
    { key: 'communities', label: 'Communities joined' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>Your activity streak, and how this month compares to last.</Text>
        <View style={styles.streakCard}>
          <Text style={styles.streakEmoji}>{stats.currentStreak > 0 ? '🔥' : '🌱'}</Text>
          <Text style={styles.streakNumber}>{stats.currentStreak}</Text>
          <Text style={styles.streakLabel}>
            {stats.currentStreak === 0
              ? 'No active streak yet — attend or host something this week to start one'
              : `week${stats.currentStreak === 1 ? '' : 's'} in a row with a gathering`}
          </Text>
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Last {stats.weeks.length} Weeks</Text>
        {hasAnyActivity ? (
          <View style={styles.chartCard}>
            <View style={styles.chartRow}>
              {stats.weeks.map((w) => (
                <View key={w.weekStart} style={styles.barColumn} accessibilityLabel={`Week of ${weekLabel(w.weekStart)}, ${w.count} gathering${w.count === 1 ? '' : 's'}`}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { height: `${Math.max((w.count / maxWeekCount) * 100, w.count > 0 ? 12 : 0)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.barWeekLabel}>{weekLabel(w.weekStart)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.chartCard}>
            <Text style={styles.emptyText}>Nothing in the last {stats.weeks.length} weeks yet — join or host a gathering to see it here.</Text>
          </View>
        )}

        <Text style={styles.sectionLabel} accessibilityRole="header">This Month vs. Last Month</Text>
        <View style={styles.deltaCard}>
          {deltas.map(({ key, label }) => {
            const current = stats.thisMonth[key];
            const previous = stats.lastMonth[key];
            const symbol = deltaSymbol(current, previous);
            return (
              <View key={key} style={styles.deltaRow} accessibilityLabel={`${label}: ${current} this month, ${previous} last month`}>
                <Text style={styles.deltaLabel}>{label}</Text>
                <View style={styles.deltaNumbers}>
                  <Text style={styles.deltaCurrent}>{current}</Text>
                  <Text style={[styles.deltaSymbol, symbol === '▲' && styles.deltaUp, symbol === '▼' && styles.deltaDown]}>{symbol}</Text>
                  <Text style={styles.deltaPrevious}>{previous} last month</Text>
                </View>
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('Gatherings')}
          activeOpacity={0.85}
          accessibilityLabel={stats.currentStreak > 0 ? 'Keep your streak going' : 'Find something to do this week'}
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>
            {stats.currentStreak > 0 ? '🔥 Keep the streak going' : '🌱 Find something to do this week'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  streakCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg,
  },
  streakEmoji: { fontSize: 32, marginBottom: spacing.xs },
  streakNumber: { ...typography.title, color: colors.textPrimary, fontSize: 32 },
  streakLabel: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: spacing.md },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  chartCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 110 },
  barColumn: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: 14, height: 80, justifyContent: 'flex-end', backgroundColor: colors.surfaceElevated, borderRadius: radius.sm, overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.sm },
  barWeekLabel: { color: colors.textTertiary, fontSize: 9, marginTop: 4 },
  deltaCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  deltaRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  deltaLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 13, marginBottom: 4 },
  deltaNumbers: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  deltaCurrent: { color: colors.textPrimary, fontWeight: '800', fontSize: 20 },
  deltaSymbol: { color: colors.textTertiary, fontSize: 14, fontWeight: '700' },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
  deltaPrevious: { color: colors.textTertiary, fontSize: 12 },
  ctaButton: {
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.md,
  },
  ctaButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
