import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMomentumStats } from '../services/momentum';
import { getInsightsStats } from '../services/insights';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

// Convergence pass P2 (CLAUDE.md, "Insights vs. Momentum -- one user-facing
// 'how am I doing?' concept"): this screen used to be Momentum-only (the
// streak/weekly-chart/month-deltas content below); InsightsScreen.js used
// to be a separate destination for lifetime stats/vibe breakdown/
// achievements. Both answered the identical real question from two
// different angles and were both reachable from Profile's own "Your
// Activity" group as two competing rows -- merged here into one screen,
// per the user's own direct instruction: "put the useful signals together"
// rather than making a user learn which of two destinations has which
// numbers. The route name stays `Momentum` (so the one real momentum-nudge
// push notification and Home's Weekly Recap link both keep working
// unchanged -- neither needed to know this screen got bigger), but the
// on-screen title/header now reads "Your Activity," matching the merged
// scope honestly. `services/insights.js`'s `getInsightsStats()` is
// unchanged and still real -- this screen just also calls it now, in
// parallel with `getMomentumStats()`, rather than a second screen owning a
// second network round trip for a fact the user experiences as one page.
function deltaSymbol(current, previous) {
  if (current > previous) return '▲';
  if (current < previous) return '▼';
  return '—';
}

function weekLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMemberSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function MomentumScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [momentum, setMomentum] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const [momentumData, insightsData] = await Promise.all([getMomentumStats(), getInsightsStats()]);
        if (!cancelled) {
          setMomentum(momentumData);
          setInsights(insightsData);
        }
      } catch (e) {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your activity...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your activity." onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!momentum && !insights) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Sign in to see your activity.</Text>
      </SafeAreaView>
    );
  }

  const maxWeekCount = momentum ? Math.max(...momentum.weeks.map((w) => w.count), 1) : 1;
  const hasAnyActivity = momentum ? momentum.weeks.some((w) => w.count > 0) : false;
  const deltas = [
    { key: 'attended', label: 'Gatherings attended' },
    { key: 'friends', label: 'New friends' },
    { key: 'communities', label: 'Communities joined' },
  ];
  const maxVibeCount = insights?.vibeBreakdown[0]?.count ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>
          Your activity streak, lifetime stats, and achievements
          {insights?.memberSince ? ` — member since ${formatMemberSince(insights.memberSince)}` : ''}.
        </Text>

        {momentum && (
          <>
            <View style={styles.streakCard}>
              <Text style={styles.streakEmoji}>{momentum.currentStreak > 0 ? '🔥' : '🌱'}</Text>
              <Text style={styles.streakNumber}>{momentum.currentStreak}</Text>
              <Text style={styles.streakLabel}>
                {momentum.currentStreak === 0
                  ? 'No active streak yet — attend or host something this week to start one'
                  : `week${momentum.currentStreak === 1 ? '' : 's'} in a row with a gathering`}
              </Text>
            </View>

            <Text style={styles.sectionLabel} accessibilityRole="header">Last {momentum.weeks.length} Weeks</Text>
            {hasAnyActivity ? (
              <View style={styles.chartCard}>
                <View style={styles.chartRow}>
                  {momentum.weeks.map((w) => (
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
                <Text style={styles.emptyText}>Nothing in the last {momentum.weeks.length} weeks yet — join or host a gathering to see it here.</Text>
              </View>
            )}

            <Text style={styles.sectionLabel} accessibilityRole="header">This Month vs. Last Month</Text>
            <View style={styles.deltaCard}>
              {deltas.map(({ key, label }) => {
                const current = momentum.thisMonth[key];
                const previous = momentum.lastMonth[key];
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
          </>
        )}

        {insights && (
          <>
            <Text style={styles.sectionLabel} accessibilityRole="header">Lifetime Stats</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.pastGatherings}</Text>
                <Text style={styles.statLabel}>Gatherings attended</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.hostedCount}</Text>
                <Text style={styles.statLabel}>Gatherings hosted</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.communities}</Text>
                <Text style={styles.statLabel}>Communities joined</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.friends}</Text>
                <Text style={styles.statLabel}>Friends made</Text>
              </View>
            </View>

            {insights.communitiesCreated > 0 && (
              <View style={styles.inlineStatRow}>
                <Text style={styles.inlineStatText}>
                  🏘️ You've started {insights.communitiesCreated} communit{insights.communitiesCreated === 1 ? 'y' : 'ies'}
                </Text>
              </View>
            )}

            {(insights.favoriteVibe || insights.usuallyActive) && (
              <View style={styles.earnedStatsRow}>
                {insights.favoriteVibe && (
                  <View style={styles.earnedStat}>
                    <Text style={styles.earnedStatLabel}>Favorite vibe</Text>
                    <Text style={styles.earnedStatValue}>{insights.favoriteVibe}</Text>
                  </View>
                )}
                {insights.usuallyActive && (
                  <View style={styles.earnedStat}>
                    <Text style={styles.earnedStatLabel}>Usually active</Text>
                    <Text style={styles.earnedStatValue}>{insights.usuallyActive}s</Text>
                  </View>
                )}
              </View>
            )}

            {insights.vibeBreakdown.length > 0 && (
              <>
                <Text style={styles.sectionLabel} accessibilityRole="header">What you've been up to</Text>
                <View style={styles.vibeSection}>
                  {insights.vibeBreakdown.map(({ tag, count }) => {
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
              Achievements ({insights.achievementsEarned}/{insights.achievementsTotal})
            </Text>
            <View style={styles.achievementsGrid}>
              {insights.achievements.map((a) => (
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
          </>
        )}

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('Gatherings')}
          activeOpacity={0.85}
          accessibilityLabel={momentum?.currentStreak > 0 ? 'Keep your streak going' : 'Find something to do this week'}
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>
            {momentum?.currentStreak > 0 ? '🔥 Keep the streak going' : '🌱 Find something to do this week'}
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
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
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
    alignItems: 'center', marginTop: spacing.md,
  },
  ctaButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
