import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getInsightsStats } from '../services/insights';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

function formatMemberSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function InsightsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const data = await getInsightsStats();
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
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your insights...</Text>
      </SafeAreaView>
    );
  }

  if (!stats) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Sign in to see your insights.</Text>
      </SafeAreaView>
    );
  }

  const maxVibeCount = stats.vibeBreakdown[0]?.count ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>
          Your lifetime stats and achievements{stats.memberSince ? ` — member since ${formatMemberSince(stats.memberSince)}` : ''}.
        </Text>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.pastGatherings}</Text>
            <Text style={styles.statLabel}>Gatherings attended</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.hostedCount}</Text>
            <Text style={styles.statLabel}>Gatherings hosted</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.communities}</Text>
            <Text style={styles.statLabel}>Communities joined</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.friends}</Text>
            <Text style={styles.statLabel}>Friends made</Text>
          </View>
        </View>

        {stats.communitiesCreated > 0 && (
          <View style={styles.inlineStatRow}>
            <Text style={styles.inlineStatText}>
              🏘️ You've started {stats.communitiesCreated} communit{stats.communitiesCreated === 1 ? 'y' : 'ies'}
            </Text>
          </View>
        )}

        {(stats.favoriteVibe || stats.usuallyActive) && (
          <View style={styles.earnedStatsRow}>
            {stats.favoriteVibe && (
              <View style={styles.earnedStat}>
                <Text style={styles.earnedStatLabel}>Favorite vibe</Text>
                <Text style={styles.earnedStatValue}>{stats.favoriteVibe}</Text>
              </View>
            )}
            {stats.usuallyActive && (
              <View style={styles.earnedStat}>
                <Text style={styles.earnedStatLabel}>Usually active</Text>
                <Text style={styles.earnedStatValue}>{stats.usuallyActive}s</Text>
              </View>
            )}
          </View>
        )}

        {stats.vibeBreakdown.length > 0 && (
          <>
            <Text style={styles.sectionLabel} accessibilityRole="header">What you've been up to</Text>
            <View style={styles.vibeSection}>
              {stats.vibeBreakdown.map(({ tag, count }) => {
                const style = categoryStyleFor(tag);
                const pct = maxVibeCount > 0 ? count / maxVibeCount : 0;
                return (
                  <View key={tag} style={styles.vibeRow} accessibilityLabel={`${tag}, ${count} gatherings`}>
                    <Text style={styles.vibeIcon}>{style.icon}</Text>
                    <View style={styles.vibeBarTrack}>
                      <View style={[styles.vibeBarFill, { width: `${Math.max(pct * 100, 8)}%`, backgroundColor: style.color }]} />
                      <Text style={styles.vibeTag}>{tag}</Text>
                    </View>
                    <Text style={styles.vibeCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel} accessibilityRole="header">
          Achievements ({stats.achievementsEarned}/{stats.achievementsTotal})
        </Text>
        <View style={styles.achievementsGrid}>
          {stats.achievements.map((a) => (
            <View
              key={a.label}
              style={[styles.achievementBadge, !a.earned && styles.achievementBadgeLocked]}
              accessibilityLabel={`${a.label}: ${a.description}${a.earned ? '' : ', not yet earned'}`}
            >
              <Text style={[styles.achievementIcon, !a.earned && styles.achievementIconLocked]}>{a.icon}</Text>
              <Text style={styles.achievementLabel}>{a.label}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('Gatherings')}
          activeOpacity={0.85}
          accessibilityLabel="Find a gathering near you"
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>🔎 Find a gathering near you</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyText: { color: colors.textTertiary, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statCard: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  statNumber: { ...typography.title, color: colors.textPrimary, fontSize: 28 },
  statLabel: { color: colors.textTertiary, fontSize: 12, marginTop: 4, textAlign: 'center' },
  inlineStatRow: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  inlineStatText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  earnedStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  earnedStat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  earnedStatLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  earnedStatValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
  vibeSection: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  vibeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  vibeIcon: { fontSize: 16, width: 24 },
  vibeBarTrack: { flex: 1, height: 22, backgroundColor: colors.surfaceElevated, borderRadius: radius.sm, justifyContent: 'center', overflow: 'hidden', marginHorizontal: spacing.sm },
  vibeBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.sm, opacity: 0.35 },
  vibeTag: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', paddingLeft: spacing.sm },
  vibeCount: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', width: 20, textAlign: 'right' },
  achievementsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  achievementBadge: {
    width: 84, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, alignItems: 'center',
  },
  achievementBadgeLocked: { opacity: 0.4 },
  achievementIcon: { fontSize: 24, marginBottom: 4 },
  achievementIconLocked: { opacity: 0.5 },
  achievementLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  ctaButton: {
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.lg,
  },
  ctaButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
