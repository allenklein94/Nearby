import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyAttendingGatherings, getMyGatherings } from '../services/gatherings';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { formatHeroDateTime } from '../utils/timeContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'hosting', label: 'My Hosting' },
  { key: 'past', label: 'Past' },
];

// This is the caller's own complete commitment calendar — every upcoming/
// hosted/past gathering, regardless of timing — distinct from Home's "Your
// Plans" (the next 1-3 things) and from Gatherings' "nearby" tab (browse,
// not commitments).
export default function PlansScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [tab, setTab] = useState(route?.params?.initialTab ?? 'upcoming');
  const [attending, setAttending] = useState({ upcoming: [], past: [] });
  const [hosting, setHosting] = useState({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [attendingData, hostingData] = await Promise.all([getMyAttendingGatherings(), getMyGatherings()]);
    setAttending(attendingData);
    setHosting(hostingData);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [attendingData, hostingData] = await Promise.all([getMyAttendingGatherings(), getMyGatherings()]);
        if (cancelled) return;
        setAttending(attendingData);
        setHosting(hostingData);
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const openGathering = (gatheringId) => navigation.navigate('GatheringDetail', { gatheringId });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const rowsFor = (activeTab) => {
    if (activeTab === 'upcoming') {
      return [
        ...attending.upcoming.map((g) => ({ gathering: g, role: 'Going' })),
        ...hosting.upcoming.map((g) => ({ gathering: g, role: 'Hosting' })),
      ].sort((a, b) => new Date(a.gathering.scheduled_at) - new Date(b.gathering.scheduled_at));
    }
    if (activeTab === 'hosting') {
      return [
        ...hosting.upcoming.map((g) => ({ gathering: g, role: 'Hosting', section: 'Upcoming' })),
        ...hosting.past.map((g) => ({ gathering: g, role: 'Hosting', section: 'Past' })),
      ];
    }
    // past
    return [
      ...attending.past.map((g) => ({ gathering: g, role: 'Went' })),
      ...hosting.past.map((g) => ({ gathering: g, role: 'Hosted' })),
    ].sort((a, b) => new Date(b.gathering.scheduled_at) - new Date(a.gathering.scheduled_at));
  };

  const rows = rowsFor(tab);

  const emptyCopy = {
    upcoming: "Nothing on your calendar yet — join or host something to see it here.",
    hosting: "You're not hosting anything yet.",
    past: "No past gatherings yet.",
  }[tab];

  const listData = [];
  if (tab === 'hosting') {
    let currentSection = null;
    for (const row of rows) {
      if (row.section !== currentSection) {
        currentSection = row.section;
        listData.push({ type: 'header', key: `header-${currentSection}`, label: currentSection });
      }
      listData.push({ type: 'row', key: row.gathering.id, ...row });
    }
  } else {
    for (const row of rows) {
      listData.push({ type: 'row', key: row.gathering.id, ...row });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.subtitle}>Everything you're going to, hosting, or have been to.</Text>

      <View style={styles.tabRow}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(row) => `${row.type}-${row.key}`}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>{emptyCopy}</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionHeader}>{item.label}</Text>;
            }
            const g = item.gathering;
            const categoryStyle = categoryStyleFor(g.interest_tag);
            return (
              <TouchableOpacity
                style={styles.planRow}
                onPress={() => openGathering(g.id)}
                activeOpacity={0.85}
                accessibilityLabel={`${g.title}, ${formatHeroDateTime(g.scheduled_at)}, ${item.role}`}
                accessibilityRole="button"
              >
                <View style={[styles.planIconWrap, { backgroundColor: categoryStyle.color + '30' }]}>
                  <Text style={styles.planIcon}>{categoryStyle.icon}</Text>
                </View>
                <View style={styles.planInfo}>
                  <Text style={styles.planTitle}>{g.title}</Text>
                  <Text style={styles.planMeta}>{formatHeroDateTime(g.scheduled_at)} · {item.role}</Text>
                </View>
                <Text style={styles.planChevron}>›</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  subtitle: { color: colors.textTertiary, fontSize: 13, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.xs },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  tabTextActive: { color: '#fff' },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  planRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  planIconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  planIcon: { fontSize: 18 },
  planInfo: { flex: 1 },
  planTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  planMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  planChevron: { color: colors.textTertiary, fontSize: 20, marginLeft: spacing.sm },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl ?? 48 },
  emptyEmoji: { fontSize: 32, marginBottom: spacing.sm },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.lg },
});
