import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getIntentFunnelStats, getMarketValidationStats } from '../services/marketValidation';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

// 10/10 roadmap Part 9 (see CLAUDE.md's "10/10 roadmap" plan): market
// validation dashboard. Admin-only (reuses the exact same isAdmin-gated
// Settings pattern already used for Business Dashboard/Review Reports --
// see SettingsScreen.js's own "Business (Admin)" group), reachable from a
// new "Market Validation (Admin)" row there. Every number on this screen
// is a real query result from get_intent_funnel_stats()/
// get_market_validation_stats() -- both already admin-gated server-side,
// so a non-admin who somehow lands here (there is no client entry point
// for one) gets a real error, not a fabricated empty dashboard.
//
// Explicitly NOT claimed as "10/10 on market validation" anywhere on this
// screen -- this app is young with little real usage, so most numbers
// here will honestly read as zero or near-zero for a long while. That's
// the correct, honest state per the plan's own framing, not a bug to
// hide -- this screen's whole job is making sure the *numbers exist and
// are real* the moment there's real usage to measure, not manufacturing
// usage that doesn't exist yet.
function formatPct(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function formatCount(value) {
  return value === null || value === undefined ? '—' : String(value);
}

function StatRow({ label, value, sublabel }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.statRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.statLabel}>{label}</Text>
        {sublabel ? <Text style={styles.statSublabel}>{sublabel}</Text> : null}
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export default function MarketValidationScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [funnel, setFunnel] = useState(null);
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const [funnelStats, marketStats] = await Promise.all([getIntentFunnelStats(), getMarketValidationStats()]);
        if (!cancelled) {
          setFunnel(funnelStats);
          setMarket(marketStats);
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
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading market validation stats...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load market validation stats." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.subtitle}>
          Every number below is a real query result — no placeholders, no targets. This app is
          young, so most of these will honestly read as low or zero for a while. That's expected,
          not a bug.
        </Text>

        <Text style={styles.groupHeader} accessibilityRole="header">Intent Funnel</Text>
        <View style={[styles.card, shadow.card]}>
          <StatRow label="Total submissions" value={formatCount(funnel?.total_submissions)} />
          <View style={styles.divider} />
          <StatRow
            label="Got any resolver result"
            value={formatPct(funnel?.pct_with_any_result)}
            sublabel={`${formatCount(funnel?.submissions_with_result)} of ${formatCount(funnel?.total_submissions)}`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Reached business fallback"
            value={formatPct(funnel?.pct_reaching_business_fallback)}
            sublabel={`${formatCount(funnel?.submissions_reaching_business_fallback)} of ${formatCount(funnel?.total_submissions)}`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Results actually tapped through"
            value={formatPct(funnel?.pct_results_selected)}
            sublabel={`${formatCount(funnel?.results_selected)} selections`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Answered outcomes that were positive"
            value={formatPct(funnel?.pct_positive_outcome)}
            sublabel={`${formatCount(funnel?.outcomes_positive)} of ${formatCount(funnel?.outcomes_answered)} answered`}
          />
          <View style={styles.divider} />
          <StatRow
            label="30-day repeat submitters"
            value={formatPct(funnel?.pct_repeat_submitters)}
            sublabel={`${formatCount(funnel?.repeat_submitters)} of ${formatCount(funnel?.distinct_submitters)} people`}
          />
        </View>

        <Text style={styles.groupHeader} accessibilityRole="header">Return Rate</Text>
        <View style={[styles.card, shadow.card]}>
          <StatRow
            label="Returned within 7 days"
            value={formatPct(market?.return_rate_7d)}
            sublabel={`${formatCount(market?.returned_7d)} of ${formatCount(market?.distinct_submitters)} people`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Returned within 30 days"
            value={formatPct(market?.return_rate_30d)}
            sublabel={`${formatCount(market?.returned_30d)} of ${formatCount(market?.distinct_submitters)} people`}
          />
        </View>

        <Text style={styles.groupHeader} accessibilityRole="header">Marketplace Reliability</Text>
        <View style={[styles.card, shadow.card]}>
          <StatRow
            label="Response rate"
            value={formatPct(market?.response_rate)}
            sublabel={`${formatCount(market?.responded_count)} of ${formatCount(market?.total_opportunities)} opportunities`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Acceptance rate"
            value={formatPct(market?.acceptance_rate)}
            sublabel={`${formatCount(market?.accepted_count)} of ${formatCount(market?.responded_count)} responded`}
          />
          <View style={styles.divider} />
          <StatRow
            label="Completion rate"
            value={formatPct(market?.completion_rate)}
            sublabel={`${formatCount(market?.completed_count)} of ${formatCount(market?.accepted_count)} accepted`}
          />
          <View style={styles.divider} />
          <StatRow label="Businesses with real opportunities" value={formatCount(market?.partners_with_opportunities)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getStyles(colors, shadow) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    subtitle: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
    groupHeader: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.lg, textTransform: 'uppercase', letterSpacing: 0.5 },
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
    statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
    statLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
    statSublabel: { ...typography.small, color: colors.textTertiary, marginTop: 2 },
    statValue: { ...typography.headline, color: colors.primary, fontWeight: '700' },
    divider: { height: 1, backgroundColor: colors.border },
  });
}
