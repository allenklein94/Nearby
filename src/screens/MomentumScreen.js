import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMomentumStats } from '../services/momentum';
import { getInsightsStats } from '../services/insights';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';
import { NearbyMark } from '../components/brand';
import { parseDate } from '../utils/timeLabels';
import { displayDay } from '../i18n/display';
import { translate } from '../i18n/translate';

import { displayCount } from '../i18n/display';
import { vocabValue } from '../i18n/format';
import { categoryName } from '../i18n/categoryNames';
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

function weekLabel(iso, language) {
  return displayDay(iso, language) ?? '';
}

// "September 2026" in English (unchanged); other languages read their own month name and order.
function formatMemberSince(iso, language) {
  const d = parseDate(iso);
  if (!d) return null;
  if (!language || language === 'en') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return translate(language, 'ui.momentum.monthYear', { month: vocabValue(language, 'date.months')[d.getMonth()], year: d.getFullYear() });
}

export default function MomentumScreen({ navigation }) {
  const { t, language } = useLanguage();
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
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.momentum.loadingYourActivity')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.momentum.couldntLoadYourActivity')} onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!momentum && !insights) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>{t('ui.momentum.signInToSeeYour')}</Text>
      </SafeAreaView>
    );
  }

  const maxWeekCount = momentum ? Math.max(...momentum.weeks.map((w) => w.count), 1) : 1;
  const hasAnyActivity = momentum ? momentum.weeks.some((w) => w.count > 0) : false;
  const deltas = [
    { key: 'attended', label: t('ui.momentum.gatheringsAttended') },
    { key: 'friends', label: t('ui.momentum.newFriends') },
    { key: 'communities', label: t('ui.momentum.communitiesJoined') },
  ];
  const maxVibeCount = insights?.vibeBreakdown[0]?.count ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>
          {insights?.memberSince && formatMemberSince(insights.memberSince, language)
            ? t('ui.momentum.subtitleWithSince', { since: formatMemberSince(insights.memberSince, language) })
            : t('ui.momentum.yourActivityStreakLifetimeStats')}
        </Text>

        {momentum && (
          <>
            <View style={styles.streakCard}>
              <Text style={styles.streakEmoji}>{momentum.currentStreak > 0 ? '🔥' : '🌱'}</Text>
              <Text style={styles.streakNumber}>{momentum.currentStreak}</Text>
              <Text style={styles.streakLabel}>
                {momentum.currentStreak === 0
                  ? t('ui.momentum.noActiveStreakYetAttend')
                  : t('ui.momentum.weeksInARow', { count: momentum.currentStreak })}
              </Text>
            </View>

            <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.momentum.lastWeeks', { length: momentum.weeks.length })}</Text>
            {hasAnyActivity ? (
              <View style={styles.chartCard}>
                <View style={styles.chartRow}>
                  {momentum.weeks.map((w) => (
                    <View key={w.weekStart} style={styles.barColumn} accessibilityLabel={t('ui.momentum.weekOfA11y', { week: weekLabel(w.weekStart, language), count: w.count })}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            { height: `${Math.max((w.count / maxWeekCount) * 100, w.count > 0 ? 12 : 0)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.barWeekLabel}>{weekLabel(w.weekStart, language)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.chartCard}>
                {/* Item 57 ("N mark as product language, but don't overdo
                    it"): a small muted mark on this one real, self-
                    contained empty-state card. */}
                <NearbyMark size={24} style={{ opacity: 0.3, alignSelf: 'center', marginBottom: spacing.xs }} />
                <EmptyCopy id="momentum_empty" vars={{ weeks: momentum.weeks.length }} />
                {/* Item 56 ("no dead ends"): a real next action, same
                    destination ActivityScreen's own empty state already uses. */}
                <TouchableOpacity onPress={() => navigation.navigate('Discover')} accessibilityLabel={t('ui.momentum.exploreThingsToDoA11y')} accessibilityRole="button" style={{ marginTop: spacing.md }}>
                  <Text style={styles.emptyActionText}>{t('ui.momentum.exploreThingsToDo')}</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.momentum.thisMonthVsLastMonth')}</Text>
            <View style={styles.deltaCard}>
              {deltas.map(({ key, label }) => {
                const current = momentum.thisMonth[key];
                const previous = momentum.lastMonth[key];
                const symbol = deltaSymbol(current, previous);
                return (
                  <View key={key} style={styles.deltaRow} accessibilityLabel={t('ui.momentum.thisMonthLastMonthA11y', { label: label, current: current, previous: previous })}>
                    <Text style={styles.deltaLabel}>{label}</Text>
                    <View style={styles.deltaNumbers}>
                      <Text style={styles.deltaCurrent}>{current}</Text>
                      <Text style={[styles.deltaSymbol, symbol === '▲' && styles.deltaUp, symbol === '▼' && styles.deltaDown]}>{symbol}</Text>
                      <Text style={styles.deltaPrevious}>{t('ui.momentum.lastMonth', { previous: previous })}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {insights && (
          <>
            <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.momentum.lifetimeStats')}</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.pastGatherings}</Text>
                <Text style={styles.statLabel}>{t('ui.momentum.gatheringsAttended')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.hostedCount}</Text>
                <Text style={styles.statLabel}>{t('ui.momentum.gatheringsHosted')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.communities}</Text>
                <Text style={styles.statLabel}>{t('ui.momentum.communitiesJoined')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{insights.friends}</Text>
                <Text style={styles.statLabel}>{t('ui.momentum.friendsMade')}</Text>
              </View>
            </View>

            {insights.communitiesCreated > 0 && (
              <View style={styles.inlineStatRow}>
                <Text style={styles.inlineStatText}>
                  {t('ui.momentum.communitiesStarted', { count: insights.communitiesCreated })}
                </Text>
              </View>
            )}

            {(insights.favoriteVibe || insights.usuallyActive) && (
              <View style={styles.earnedStatsRow}>
                {insights.favoriteVibe && (
                  <View style={styles.earnedStat}>
                    <Text style={styles.earnedStatLabel}>{t('ui.momentum.favoriteVibe')}</Text>
                    <Text style={styles.earnedStatValue}>{categoryName(insights.favoriteVibe, language)}</Text>
                  </View>
                )}
                {insights.usuallyActive && (
                  <View style={styles.earnedStat}>
                    <Text style={styles.earnedStatLabel}>{t('ui.momentum.usuallyActive')}</Text>
                    <Text style={styles.earnedStatValue}>{insights.usuallyActiveDay != null ? t(`ui.momentum.activeDay.${insights.usuallyActiveDay}`) : `${insights.usuallyActive}s`}</Text>
                  </View>
                )}
              </View>
            )}

            {insights.vibeBreakdown.length > 0 && (
              <>
                <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.momentum.whatYouveBeenUpTo')}</Text>
                <View style={styles.vibeSection}>
                  {insights.vibeBreakdown.map(({ tag, count }) => {
                    const style = categoryStyleFor(tag);
                    const pct = maxVibeCount > 0 ? count / maxVibeCount : 0;
                    return (
                      <View key={tag} style={styles.vibeRow} accessibilityLabel={`${categoryName(tag, language)}, ${displayCount(count, 'gatherings', language)}`}>
                        <Text style={styles.vibeIcon}>{style.icon}</Text>
                        <View style={styles.vibeBarTrack}>
                          <View style={[styles.vibeBarFill, { width: `${Math.max(pct * 100, 8)}%`, backgroundColor: style.color }]} />
                          <Text style={styles.vibeTag}>{categoryName(tag, language)}</Text>
                        </View>
                        <Text style={styles.vibeCount}>{count}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.momentum.achievements', { achievementsEarned: insights.achievementsEarned, achievementsTotal: insights.achievementsTotal })}</Text>
            <View style={styles.achievementsGrid}>
              {insights.achievements.map((a) => (
                <View
                  key={a.label}
                  style={[styles.achievementBadge, !a.earned && styles.achievementBadgeLocked]}
                  accessibilityLabel={`${t(`ui.momentum.achievement.${a.key}.label`)}: ${t(`ui.momentum.achievement.${a.key}.description`)}${a.earned ? '' : t('ui.momentum.notYetEarnedA11y')}`}
                >
                  <Text style={[styles.achievementIcon, !a.earned && styles.achievementIconLocked]}>{a.icon}</Text>
                  <Text style={styles.achievementLabel}>{t(`ui.momentum.achievement.${a.key}.label`)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('Gatherings')}
          activeOpacity={0.85}
          accessibilityLabel={momentum?.currentStreak > 0 ? t('ui.momentum.keepYourStreakGoingA11y') : t('ui.momentum.findSomethingToDoThisA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>
            {momentum?.currentStreak > 0 ? t('ui.momentum.keepTheStreakGoing') : t('ui.momentum.findSomethingToDoThis')}
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
  emptyActionText: { color: colors.primary, fontWeight: '700', fontSize: 13, textAlign: 'center' },
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
