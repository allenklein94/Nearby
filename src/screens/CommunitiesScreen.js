import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader, PullToRefresh } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getMyCommunities, getCommunityMemberCount } from '../services/communities';
import { navigateKeepingTrail } from '../services/openDestination';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { placeDistanceLabel } from '../services/places';
import { spacing, radius, typography } from '../theme';

// "Boca Raton, FL" -- a community's area (member communities carry no distance; the distance part shows only when a row
// carries a real one).
function areaLine(c) {
  const area = c.area_label || [c.area_city, c.area_region].filter(Boolean).join(', ') || null;
  return [area, placeDistanceLabel(c.distanceMiles)].filter(Boolean).join(' · ') || null;
}

// Rule 14 (owner, 2026-10-04): this screen is the person's MANAGEMENT surface for communities they belong to (Your
// Communities + Create). Finding and joining public communities lives in ONE place, Discover -> Communities; this screen
// links there ("Discover communities ->") and never lists public communities or Join buttons of its own.
export const DISCOVER_COMMUNITIES = { initialMode: 'things', initialTypeTab: 'communities' };

export default function CommunitiesScreen({ navigation }) {
  const { t } = useLanguage();
  const membersLabel = (n) => (Number.isFinite(n) ? t('ui.common.count.members', { count: n }) : null);
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [myCommunities, setMyCommunities] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await getMyCommunities();
      setMyCommunities(mine);
      const counts = await Promise.all(mine.map(async (c) => [c.id, await getCommunityMemberCount(c.id)]));
      setMemberCounts(Object.fromEntries(counts));
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
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

  // A fresh params object each tap so Discover re-applies it; the return trail brings Back here (item 139).
  const openDiscoverCommunities = () => navigateKeepingTrail(navigation, 'Discover', { ...DISCOVER_COMMUNITIES });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.community.loadingCommunities')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.community.couldntLoadCommunities')} onRetry={load} />
      </SafeAreaView>
    );
  }

  const discoverLink = (
    <TouchableOpacity
      onPress={openDiscoverCommunities}
      accessibilityLabel={t('ui.community.discoverCommunitiesA11y')}
      accessibilityRole="button"
      style={{ marginTop: spacing.md }}
    >
      <Text style={styles.emptyActionText}>{t('ui.community.discoverCommunities')}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={myCommunities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{t('ui.community.communities')}</Text>
              <TouchableOpacity
                style={styles.createButton}
                onPress={() => navigation.navigate('CreateCommunity')}
                accessibilityLabel={t('ui.community.createANewCommunityA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.createButtonText}>{t('ui.community.create')}</Text>
              </TouchableOpacity>
            </View>
            {myCommunities.length > 0 && <Text style={styles.sectionHeader}>{t('ui.community.yourCommunities')}</Text>}
          </>
        }
        ListEmptyComponent={
          <FadeInState opportunity style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏘️</Text>
            <EmptyCopy id="communities_mine" />
            {discoverLink}
            <TouchableOpacity
              onPress={() => navigation.navigate('CreateCommunity')}
              accessibilityLabel={t('ui.community.createACommunityA11y')}
              accessibilityRole="button"
              style={{ marginTop: spacing.md }}
            >
              <Text style={styles.emptyActionText}>{t('ui.community.createACommunity')}</Text>
            </TouchableOpacity>
          </FadeInState>
        }
        ListFooterComponent={myCommunities.length > 0 ? <View style={styles.footer}>{discoverLink}</View> : null}
        renderItem={({ item: c }) => {
          const categoryStyle = categoryStyleFor(c.interest_tag);
          return (
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }]}
              onPress={() => navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })}
              accessibilityLabel={`${c.name}, ${membersLabel(memberCounts[c.id]) ?? t('ui.community.communityWord')}`}
              accessibilityRole="button"
            >
              <Text style={styles.cardIcon}>{categoryStyle.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.name}</Text>
                {membersLabel(memberCounts[c.id]) ? <Text style={styles.cardMeta}>{membersLabel(memberCounts[c.id])}</Text> : null}
                {areaLine(c) ? <Text style={styles.cardArea}>📍 {areaLine(c)}</Text> : null}
              </View>
              <Text style={styles.cardChevron}>›</Text>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary },
  createButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionHeader: {
    ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  footer: { alignItems: 'center', paddingVertical: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  cardIcon: { fontSize: 24, marginRight: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  cardMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  cardArea: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  cardChevron: { color: colors.textTertiary, fontSize: 20 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  emptyActionText: { ...typography.body, color: colors.primary, fontWeight: '700' },
});