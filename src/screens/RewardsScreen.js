import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyRewardStatus } from '../services/rewards';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

export default function RewardsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const data = await getMyRewardStatus();
        if (!cancelled) {
          setStatus(data);
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
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your rewards...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your rewards." onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!status) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Sign in to see your rewards.</Text>
      </SafeAreaView>
    );
  }

  // Real bug fix (flagged, never resolved, in CLAUDE.md's Aug 15 2026 bug-hunt
  // section): this used to measure raw points against the next tier's own
  // absolute threshold (points / nextTier.min), so once past the first tier
  // the bar read further along than "progress toward next tier" actually
  // implies -- e.g. 20 points with Silver(15)/Gold(30) showed 66% (20/30)
  // instead of the honest 33% through the Silver-to-Gold range. Fixed to
  // measure relative to the current tier's own range (0 when no tier has
  // been reached yet, matching the old behavior exactly for that one case).
  const tierFloor = status.tier?.min ?? 0;
  const progressPct = status.nextTier
    ? Math.min(100, Math.max(0, Math.round(((status.points - tierFloor) / (status.nextTier.min - tierFloor)) * 100)))
    : 100;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.subtitle}>Your perk tier — based on how many perks you've redeemed.</Text>
        <View style={styles.tierCard}>
          <Text style={styles.tierEmoji}>{status.tier?.emoji ?? '🎁'}</Text>
          <Text style={styles.tierName}>{status.tier ? `${status.tier.name} Member` : 'Not a member yet'}</Text>
          <Text style={styles.pointsText}>
            {status.points} offer{status.points === 1 ? '' : 's'} redeemed
          </Text>
          {status.nextTier ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
              <Text style={styles.progressLabel}>
                {status.pointsToNextTier} more redemption{status.pointsToNextTier === 1 ? '' : 's'} to {status.nextTier.emoji} {status.nextTier.name}
              </Text>
            </>
          ) : (
            <Text style={styles.progressLabel}>You've reached the top tier</Text>
          )}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">Tiers</Text>
        <View style={styles.tierListCard}>
          {status.allTiers.map((t) => {
            const reached = status.points >= t.min;
            return (
              <View key={t.name} style={styles.tierRow} accessibilityLabel={`${t.name}, ${t.min} redemptions, ${reached ? 'reached' : 'not reached yet'}`}>
                <Text style={[styles.tierRowEmoji, !reached && styles.tierRowDim]}>{t.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tierRowName, !reached && styles.tierRowDim]}>{t.name}</Text>
                  <Text style={styles.tierRowThreshold}>{t.min}+ offers redeemed</Text>
                </View>
                {reached && <Text style={styles.tierRowCheck}>✓</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Points come from offers you've actually redeemed — no separate points to track or spend, just a badge for how much you've used what's nearby.
        </Text>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('BrandOffers')}
          activeOpacity={0.85}
          accessibilityLabel="Browse perks near you"
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>🎁 Browse perks near you</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  tierCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg,
  },
  tierEmoji: { fontSize: 36, marginBottom: spacing.xs },
  tierName: { ...typography.title, color: colors.textPrimary, fontSize: 20 },
  pointsText: { color: colors.textTertiary, fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  progressTrack: { width: '100%', height: 8, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, overflow: 'hidden' },
  // Kept coral deliberately, per the locked "coral = action, not decoration"
  // rule's own carve-out: a progress/achievement fill isn't pretending to be
  // an interactive control, it's a data visualization of real earned
  // progress -- reverted here after an earlier pass had swept it into the
  // same neutral treatment as every other progress bar in the app.
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  progressLabel: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.sm, textAlign: 'center' },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  tierListCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  tierRowEmoji: { fontSize: 22 },
  tierRowDim: { opacity: 0.4 },
  tierRowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  tierRowThreshold: { color: colors.textTertiary, fontSize: 12 },
  tierRowCheck: { color: colors.success, fontSize: 16, fontWeight: '700' },
  footnote: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing.md },
  ctaButton: {
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md,
    alignItems: 'center', marginTop: spacing.lg,
  },
  ctaButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
