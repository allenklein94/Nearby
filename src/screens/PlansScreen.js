import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyAttendingGatherings, getMyGatherings } from '../services/gatherings';
import { getMyGroupPlans } from '../services/groupPlans';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { formatHeroDateTime } from '../utils/timeContext';
import { GATHERING_STATUS_META } from '../components/GatheringStatusBadge';
import PlanCard from '../components/PlanCard';
import { resolveGatheringPlanStatus, resolveGroupPlanStatus } from '../constants/planStatus';
import LoadErrorState from '../components/LoadErrorState';
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
//
// Explicit decision (Aug 23 2026 Product Coherence Audit P1, CLAUDE.md):
// this screen's own Upcoming/Hosting tabs *do* overlap with Gatherings'
// attending/hosting tabs — same underlying rows, real overlap, not a
// coincidence. Kept as two real, separate screens on purpose: this one is
// a pure, tap-through-only glance ("what's on my calendar," no actions at
// all); Gatherings' attending/hosting tabs are the real active-management
// surface (approve requests, edit, cancel, invite). Written down here so
// a future session doesn't have to re-derive the reasoning from scratch —
// see the "Manage your hosted gatherings" link below for the one real,
// discoverable bridge between the two.
export default function PlansScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [tab, setTab] = useState(route?.params?.initialTab ?? 'upcoming');
  const [attending, setAttending] = useState({ upcoming: [], past: [] });
  const [hosting, setHosting] = useState({ upcoming: [], past: [] });
  // Finding G.1 (Aug 15 2026 connectivity audit): group plans (real
  // jointly-owned business_requests rows) were entirely absent from this
  // screen even though it's meant to be "the caller's own complete
  // commitment calendar" — the only prior way to discover one was a push
  // notification tap.
  const [groupPlans, setGroupPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [attendingData, hostingData, groupPlanData] = await Promise.all([getMyAttendingGatherings(), getMyGatherings(), getMyGroupPlans()]);
      setAttending(attendingData);
      setHosting(hostingData);
      setGroupPlans(groupPlanData);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [attendingData, hostingData, groupPlanData] = await Promise.all([getMyAttendingGatherings(), getMyGatherings(), getMyGroupPlans()]);
          if (cancelled) return;
          setAttending(attendingData);
          setHosting(hostingData);
          setGroupPlans(groupPlanData);
          setLoadError(false);
        } catch (e) {
          if (!cancelled) setLoadError(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const openGathering = (gatheringId) => navigation.navigate('GatheringDetail', { gatheringId });
  const openGroupPlan = (proposalId) => navigation.navigate('GroupPlan', { proposalId });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const rowsFor = (activeTab) => {
    if (activeTab === 'upcoming') {
      return [
        ...attending.upcoming.map((g) => ({ gathering: g, status: 'going' })),
        ...hosting.upcoming.map((g) => ({ gathering: g, status: 'hosting' })),
      ].sort((a, b) => new Date(a.gathering.scheduled_at) - new Date(b.gathering.scheduled_at));
    }
    if (activeTab === 'hosting') {
      return [
        ...hosting.upcoming.map((g) => ({ gathering: g, status: 'hosting', section: 'Upcoming' })),
        ...hosting.past.map((g) => ({ gathering: g, status: 'hosted', section: 'Past' })),
      ];
    }
    // past
    return [
      ...attending.past.map((g) => ({ gathering: g, status: 'attended' })),
      ...hosting.past.map((g) => ({ gathering: g, status: 'hosted' })),
    ].sort((a, b) => new Date(b.gathering.scheduled_at) - new Date(a.gathering.scheduled_at));
  };

  const rows = rowsFor(tab);

  // Phase 2 of the "Build everything" plan (CLAUDE.md): PlanCard's badge
  // needs the two real signals resolveGatheringPlanStatus() takes --
  // this screen's own legacy per-row status ("going"/"hosting"/
  // "attended"/"hosted") already encodes both, just needs unpacking.
  const ROLE_STATUS_FROM_LEGACY = {
    going: { role: 'attending', isPast: false },
    hosting: { role: 'hosting', isPast: false },
    attended: { role: 'attending', isPast: true },
    hosted: { role: 'hosting', isPast: true },
  };
  // The "hosting" tab is already grouped under real Upcoming/Past section
  // headers, and every row on it is hosting -- a roleLabel there would be
  // redundant. "upcoming" and "past" both merge attending+hosting rows
  // into one sorted list with no separating header, so PlanCard's
  // subtitle needs to carry that real distinction instead.
  const needsRoleLabel = tab !== 'hosting';

  // Real people count where it's actually available -- attending.upcoming
  // rows already carry a real approvedAttendees list (attachApprovedAttendees,
  // gatherings.js), hosting rows of either timing already carry every real
  // gathering_interest row via `interested`. A past attending row has
  // neither fetched (this pass didn't add a new query for it) -- PlanCard
  // already renders correctly with peopleCount omitted.
  const peopleCountFor = (item) => {
    if (item.status === 'going') return item.gathering.approvedAttendees?.length ?? null;
    if (item.status === 'hosting' || item.status === 'hosted') {
      return Array.isArray(item.gathering.interested)
        ? item.gathering.interested.filter((i) => i.status === 'approved').length
        : null;
    }
    return null;
  };

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
  // Group plans have no scheduled_at (real, not fabricated — the shared
  // request has a date + time window, not a gathering-shaped timestamp),
  // so they render as a real, separate set of rows on the Upcoming tab
  // only, never merged into the sortable gathering list above.
  if (tab === 'upcoming') {
    for (const plan of groupPlans) {
      listData.push({ type: 'groupPlanRow', key: `group-plan-${plan.id}`, plan });
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

      {/* The one real, discoverable bridge into the actual management
          surface (see the top-of-file comment) -- this tab is tap-through
          only, so a host who wants to approve a request, edit, cancel, or
          invite someone needs a real, visible way to get there. */}
      {tab === 'hosting' && !loading && !loadError && (
        <TouchableOpacity
          style={styles.manageLink}
          onPress={() => navigation.navigate('Gatherings', { initialTab: 'hosting' })}
          activeOpacity={0.85}
          accessibilityLabel="Manage your hosted gatherings — approve requests, edit, cancel, or invite"
          accessibilityRole="button"
        >
          <Text style={styles.manageLinkText}>⚙️ Manage your hosted gatherings →</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View>
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
          <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your plans...</Text>
        </View>
      ) : loadError ? (
        <LoadErrorState message="Couldn't load your plans." onRetry={load} />
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
            if (item.type === 'groupPlanRow') {
              const plan = item.plan;
              return (
                <PlanCard
                  icon={categoryStyleFor(plan.category).icon}
                  iconColor={categoryStyleFor(plan.category).color}
                  title={plan.raw_text}
                  roleLabel="Group plan"
                  dateTimeText={plan.date ? formatHeroDateTime(plan.date) : null}
                  peopleCount={plan.party_size}
                  status={resolveGroupPlanStatus(plan.status)}
                  onPress={() => openGroupPlan(plan.group_plan_id)}
                  style={styles.planCardSpacing}
                />
              );
            }
            const g = item.gathering;
            const legacy = ROLE_STATUS_FROM_LEGACY[item.status] ?? { role: 'attending', isPast: false };
            return (
              <PlanCard
                icon={categoryStyleFor(g.interest_tag).icon}
                iconColor={categoryStyleFor(g.interest_tag).color}
                title={g.title}
                roleLabel={needsRoleLabel ? GATHERING_STATUS_META[item.status]?.label : null}
                dateTimeText={formatHeroDateTime(g.scheduled_at)}
                peopleCount={peopleCountFor(item)}
                hostingPartnerId={g.hosting_partner_id}
                status={resolveGatheringPlanStatus(legacy)}
                onPress={() => openGathering(g.id)}
                style={styles.planCardSpacing}
              />
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
  manageLink: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  manageLinkText: { color: colors.primary, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  // PlanCard (Phase 2 of the "Build everything" plan) renders its own
  // icon/title/subtitle/badge internally -- this screen only supplies the
  // outer card chrome its old bespoke rows used to have, via PlanCard's
  // own `style` override.
  planCardSpacing: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl ?? 48 },
  emptyEmoji: { fontSize: 32, marginBottom: spacing.sm },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.lg },
});
