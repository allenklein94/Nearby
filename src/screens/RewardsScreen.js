import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { NLoader } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMyRewardStatus } from '../services/rewards';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import LoadErrorState from '../components/LoadErrorState';

export default function RewardsScreen({ navigation }) {
  const { t } = useLanguage();
  const tierName = (tier) => t(`ui.rewards.tier.${tier.name.toLowerCase()}`);
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
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.rewards.loadingYourRewards')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.rewards.couldntLoadYourRewards')} onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!status) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>{t('ui.rewards.signInToSeeYour')}</Text>
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
        <Text style={styles.subtitle}>{t('ui.rewards.yourPerkTierBasedOn')}</Text>
        <View style={styles.tierCard}>
          <Text style={styles.tierEmoji}>{status.tier?.emoji ?? '🎁'}</Text>
          <Text style={styles.tierName}>{status.tier ? t('ui.rewards.member', { name: tierName(status.tier) }) : t('ui.rewards.notAMemberYet')}</Text>
          <Text style={styles.pointsText}>
            {t('ui.rewards.pointsRedeemed', { count: status.points })}
          </Text>
          {status.nextTier ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
              <Text style={styles.progressLabel}>
                {t('ui.rewards.moreToNext', { count: status.pointsToNextTier, tier: `${status.nextTier.emoji} ${tierName(status.nextTier)}` })}
              </Text>
            </>
          ) : (
            <Text style={styles.progressLabel}>{t('ui.rewards.youveReachedTheTopTier')}</Text>
          )}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('ui.rewards.tiers')}</Text>
        <View style={styles.tierListCard}>
          {status.allTiers.map((tier) => {
            const reached = status.points >= tier.min;
            return (
              <View key={tier.name} style={styles.tierRow} accessibilityLabel={t(reached ? 'ui.rewards.tierReachedA11y' : 'ui.rewards.tierNotReachedA11y', { name: tierName(tier), count: tier.min })}>
                <Text style={[styles.tierRowEmoji, !reached && styles.tierRowDim]}>{tier.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tierRowName, !reached && styles.tierRowDim]}>{tierName(tier)}</Text>
                  <Text style={styles.tierRowThreshold}>{t('ui.rewards.offersRedeemed', { min: tier.min })}</Text>
                </View>
                {reached && <Text style={styles.tierRowCheck}>✓</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          {t('ui.rewards.pointsComeFromOffersYouve')}
        </Text>

        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('BrandOffers')}
          activeOpacity={0.85}
          accessibilityLabel={t('ui.rewards.browsePerksNearYouA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.ctaButtonText}>{t('ui.rewards.browsePerksNearYou')}</Text>
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
