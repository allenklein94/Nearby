import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getNearbyGatherings, getMyGatherings, getMyAttendingGatherings, expressInterest, approveInterest } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import ReportBlockModal from '../components/ReportBlockModal';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function GatheringsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [tab, setTab] = useState('nearby');
  const [nearby, setNearby] = useState([]);
  const [hosting, setHosting] = useState([]);
  const [attending, setAttending] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});
  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [reportTarget, setReportTarget] = useState(null);

  const load = useCallback(async () => {
    const [nearbyResults, hostingResults, attendingResults] = await Promise.all([
      getNearbyGatherings(),
      getMyGatherings(),
      getMyAttendingGatherings(),
    ]);
    setNearby(nearbyResults);
    setHosting(hostingResults);
    setAttending(attendingResults);

    const urlEntries = await Promise.all(
      nearbyResults.map(async (g) => {
        const path = g.host?.photo_url;
        if (!path) return [g.id, null];
        const url = await getSignedPhotoUrl(path);
        return [g.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const attendeeUrlEntries = await Promise.all(
      nearbyResults.flatMap((g) =>
        (g.approvedAttendees ?? []).map(async (a) => {
          const path = a.profiles?.photo_url;
          if (!path) return null;
          const url = await getSignedPhotoUrl(path);
          return [`${g.id}-${path}`, url];
        })
      )
    );
    setAttendeePhotoUrls(Object.fromEntries(attendeeUrlEntries.filter(Boolean)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  React.useEffect(() => {
    let channel;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`gathering-interest:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'gathering_interest' },
          () => {
            load();
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleExpressInterest(gatheringId) {
    try {
      await expressInterest(gatheringId);
      Alert.alert("You're interested!", "The host will review and let you know.");
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleApprove(interest) {
    try {
      await approveInterest(interest.id);
      Alert.alert('Approved!', 'A match was created — you can now chat with them.');
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('gatherings.title')}</Text>
        <TouchableOpacity style={styles.createButton} onPress={() => navigation.navigate('CreateGathering')}>
          <Text style={styles.createButtonText}>{t('gatherings.hostButton')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'nearby' && styles.tabActive]} onPress={() => setTab('nearby')}>
          <Text style={[styles.tabText, tab === 'nearby' && styles.tabTextActive]}>{t('gatherings.nearbyTab')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'attending' && styles.tabActive]} onPress={() => setTab('attending')}>
          <Text style={[styles.tabText, tab === 'attending' && styles.tabTextActive]}>Attending</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'hosting' && styles.tabActive]} onPress={() => setTab('hosting')}>
          <Text style={[styles.tabText, tab === 'hosting' && styles.tabTextActive]}>{t('gatherings.hostingTab')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'nearby' && (
        <FlatList
          data={nearby}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎉</Text>
              <Text style={styles.emptyText}>{t('gatherings.emptyNearby')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const categoryStyle = categoryStyleFor(item.interest_tag);
            return (
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }, item.matchesYourInterests && styles.matchCard]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
                    <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                  </View>
                  {photoUrls[item.id] && <Image source={{ uri: photoUrls[item.id] }} style={styles.hostAvatar} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.hostName}>{t('gatherings.hostedBy')} {item.host?.display_name}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.moreButton}
                    onPress={() => setReportTarget({ id: item.host_id, name: item.host?.display_name })}
                  >
                    <Text style={styles.moreButtonText}>⋯</Text>
                  </TouchableOpacity>
                </View>
                {item.matchesYourInterests && (
                  <View style={styles.matchBadge}>
                    <Text style={styles.matchBadgeText}>{t('gatherings.matchesInterests')}</Text>
                  </View>
                )}
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <View style={styles.metaRow}>
                  <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                  {item.distanceLabel && <Text style={styles.distance}>· {item.distanceLabel}</Text>}
                </View>

                {item.approvedAttendees?.length > 0 && (
                  <View style={styles.attendeesRow}>
                    <View style={styles.attendeeAvatars}>
                      {item.approvedAttendees.slice(0, 4).map((attendee, i) => {
                        const url = attendeePhotoUrls[`${item.id}-${attendee.profiles?.photo_url}`];
                        return url ? (
                          <Image
                            key={i}
                            source={{ uri: url }}
                            style={[styles.attendeeAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}
                          />
                        ) : null;
                      })}
                    </View>
                    <Text style={styles.attendeesText}>
                      {item.approvedAttendees.length === 1
                        ? `${item.approvedAttendees[0].profiles?.display_name} is attending`
                        : `${item.approvedAttendees.length} people attending`}
                    </Text>
                  </View>
                )}

                <TouchableOpacity style={[styles.interestButton, { backgroundColor: categoryStyle.color }]} onPress={() => handleExpressInterest(item.id)} activeOpacity={0.85}>
                  <Text style={styles.interestButtonText}>{t('gatherings.imInterested')}</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {tab === 'attending' && (
        <FlatList
          data={attending}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>✅</Text>
              <Text style={styles.emptyText}>You're not attending anything yet. Once a host approves your interest, it'll show up here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const categoryStyle = categoryStyleFor(item.interest_tag);
            return (
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
                    <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.hostName}>{t('gatherings.hostedBy')} {item.host?.display_name}</Text>
                  </View>
                </View>
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                <View style={styles.attendingBadge}>
                  <Text style={styles.attendingBadgeText}>✓ You're going</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {tab === 'hosting' && (
        <FlatList
          data={hosting}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>{t('gatherings.emptyHosting')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const categoryStyle = categoryStyleFor(item.interest_tag);
            return (
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
                    <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                  </View>
                  <Text style={styles.title}>{item.title}</Text>
                </View>
                <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                {item.interested?.length > 0 ? (
                  item.interested.map((interest) => (
                    <View key={interest.id} style={styles.interestRow}>
                      <Text style={styles.interestName}>{interest.profiles?.display_name}</Text>
                      {interest.status === 'pending' ? (
                        <TouchableOpacity style={styles.approveButton} onPress={() => handleApprove(interest)}>
                          <Text style={styles.approveButtonText}>{t('gatherings.approve')}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.approvedLabel}>{t('gatherings.approved')}</Text>
                      )}
                    </View>
                  ))
                ) : (
                  <Text style={styles.noInterestText}>{t('gatherings.noInterestYet')}</Text>
                )}
              </View>
            );
          }}
        />
      )}

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        onBlocked={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  createButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.xs },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  tabTextActive: { color: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  matchCard: { borderColor: colors.primary },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  categoryBadge: { width: 36, height: 36, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm },
  categoryBadgeIcon: { fontSize: 18 },
  hostAvatar: { width: 32, height: 32, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  title: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  hostName: { ...typography.small, color: colors.textTertiary },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  moreButtonText: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
  matchBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm },
  matchBadgeText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  time: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  distance: { ...typography.caption, color: colors.textTertiary },
  attendeesRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  attendeeAvatars: { flexDirection: 'row', marginRight: spacing.sm },
  attendeeAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: colors.surfaceElevated },
  attendeesText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  attendingBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm },
  attendingBadgeText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  interestButton: { borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  interestButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  interestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  interestName: { color: colors.textPrimary, fontSize: 14 },
  approveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  approveButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  approvedLabel: { color: colors.success, fontSize: 12, fontWeight: '700' },
  noInterestText: { color: colors.textTertiary, fontSize: 13 },
});