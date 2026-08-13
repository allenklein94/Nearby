import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyCommunities, getPublicCommunities, joinCommunity, getCommunityMemberCount } from '../services/communities';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import BusinessHostBadge from '../components/BusinessHostBadge';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function CommunitiesScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [myCommunities, setMyCommunities] = useState([]);
  const [discoverCommunities, setDiscoverCommunities] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, publicOnes] = await Promise.all([getMyCommunities(), getPublicCommunities()]);
      setMyCommunities(mine);

      const myIds = new Set(mine.map((c) => c.id));
      const toDiscover = publicOnes.filter((c) => !myIds.has(c.id));
      setDiscoverCommunities(toDiscover);

      const counts = await Promise.all(
        [...mine, ...toDiscover].map(async (c) => [c.id, await getCommunityMemberCount(c.id)])
      );
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

  async function handleJoin(communityId) {
    try {
      await joinCommunity(communityId);
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading communities...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load communities." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={discoverCommunities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Communities</Text>
              <TouchableOpacity
                style={styles.createButton}
                onPress={() => navigation.navigate('CreateCommunity')}
                accessibilityLabel="Create a new community"
                accessibilityRole="button"
              >
                <Text style={styles.createButtonText}>+ Create</Text>
              </TouchableOpacity>
            </View>

            {myCommunities.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Your Communities</Text>
                {myCommunities.map((c) => {
                  const categoryStyle = categoryStyleFor(c.interest_tag);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }]}
                      onPress={() => navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })}
                      accessibilityLabel={`${c.name}, ${memberCounts[c.id] ?? 0} members`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cardIcon}>{categoryStyle.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{c.name}</Text>
                        <Text style={styles.cardMeta}>{memberCounts[c.id] ?? 0} members</Text>
                      </View>
                      <Text style={styles.cardChevron}>›</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={styles.divider} />
              </>
            )}

            <Text style={styles.sectionHeader}>Discover</Text>
          </>
        }
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🏘️</Text>
              <Text style={styles.emptyText}>No public communities to discover right now — start your own!</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const categoryStyle = categoryStyleFor(item.interest_tag);
          return (
            <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }]}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                onPress={() => navigation.navigate('CommunityDetail', { communityId: item.id, communityName: item.name })}
                accessibilityLabel={`${item.name}, ${memberCounts[item.id] ?? 0} members`}
                accessibilityRole="button"
              >
                <Text style={styles.cardIcon}>{categoryStyle.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>{memberCounts[item.id] ?? 0} members</Text>
                  <BusinessHostBadge hostingPartnerId={item.hosting_partner_id} navigation={navigation} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.joinButton}
                onPress={() => handleJoin(item.id)}
                accessibilityLabel={`Join ${item.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.joinButtonText}>Join</Text>
              </TouchableOpacity>
            </View>
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
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card,
  },
  cardIcon: { fontSize: 24, marginRight: spacing.sm },
  cardTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  cardMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 20 },
  joinButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8 },
  joinButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
});