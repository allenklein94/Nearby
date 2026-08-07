import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyRewardStatus } from '../services/rewards';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

export default function RewardsScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const data = await getMyRewardStatus();
        if (!cancelled) {
          setStatus(data);
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

  const progressPct = status.nextTier
    ? Math.min(100, Math.round((status.points / status.nextTier.min) * 100))
    : 100;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  tierCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg,
  },
  tierEmoji: { fontSize: 36, marginBottom: spacing.xs },
  tierName: { ...typography.title, color: colors.textPrimary, fontSize: 20 },
  pointsText: { color: colors.textTertiary, fontSize: 13, marginTop: 4, marginBottom: spacing.md },
  progressTrack: { width: '100%', height: 8, backgroundColor: colors.surfaceElevated, borderRadius: radius.full, overflow: 'hidden' },
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
});
