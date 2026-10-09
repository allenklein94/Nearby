import React, { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import EmptyCopy from './EmptyCopy';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import FadeInState from './FadeInState';
import { NLoader } from '../motion';
import { getMyCommunities, getCommunityMemberCount } from '../services/communities';
import { navigateKeepingTrail } from '../services/openDestination';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import LoadErrorState from './LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { placeDistanceLabel } from '../services/places';
import { spacing, radius, typography } from '../theme';

// "Boca Raton, FL" -- a community's area (member communities carry no distance; the distance part shows only when a row
// carries a real one).
function areaLine(c) {
  const area = c.area_label || [c.area_city, c.area_region].filter(Boolean).join(', ') || null;
  return [area, placeDistanceLabel(c.distanceMiles)].filter(Boolean).join(' · ') || null;
}

// The person's own communities (Your Communities + Create), shown in place under Profile > Your connections when the
// Communities tile is tapped (screen-reduction audit B8, 2026-10-09: this was its own screen, Communities). Finding and
// joining public communities lives in ONE place, Discover -> Communities; this links there and never lists public
// communities or Join buttons of its own (Rule 14).
export const DISCOVER_COMMUNITIES = { initialMode: 'things', initialTypeTab: 'communities' };

export default function MyCommunitiesSection({ navigation }) {
  const { t } = useLanguage();
  const membersLabel = (n) => (Number.isFinite(n) ? t('ui.common.count.members', { count: n }) : null);
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [myCommunities, setMyCommunities] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
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

  useEffect(() => { load(); }, [load]);

  // A fresh params object each tap so Discover re-applies it; the return trail brings Back here (item 139).
  const openDiscoverCommunities = () => navigateKeepingTrail(navigation, 'Discover', { ...DISCOVER_COMMUNITIES });

  if (loading) {
    return (
      <View style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.community.loadingCommunities')}</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState message={t('ui.community.couldntLoadCommunities')} onRetry={load} />
      </View>
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

  const createLink = (
    <TouchableOpacity
      style={styles.createButton}
      onPress={() => navigation.navigate('CreateCommunity')}
      accessibilityLabel={t('ui.community.createANewCommunityA11y')}
      accessibilityRole="button"
    >
      <Text style={styles.createButtonText}>{t('ui.community.create')}</Text>
    </TouchableOpacity>
  );

  if (myCommunities.length === 0) {
    return (
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
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionHeader}>{t('ui.community.yourCommunities')}</Text>
        {createLink}
      </View>
      {myCommunities.map((c) => {
        const categoryStyle = categoryStyleFor(c.interest_tag);
        return (
          <TouchableOpacity
            key={c.id}
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
      })}
      <View style={styles.footer}>{discoverLink}</View>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { marginTop: spacing.sm, marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
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
  emptyState: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  emptyActionText: { ...typography.body, color: colors.primary, fontWeight: '700' },
});