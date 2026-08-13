import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, Share } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import {
  getGatheringById,
  getGatheringMeetupPoint,
  setGatheringOnMyWay,
  checkInToGathering,
  getFirstTimerAttendeeIds,
  hasSubmittedFeedback,
  getHostStats,
  isFirstGatheringJoin,
} from '../services/gatherings';
import { getSocialForecast } from '../services/homeDashboard';
import { getSignedPhotoUrl } from '../services/photos';
import { iceBreakersFor, prepTipsFor } from '../constants/gatheringHubContent';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import GatheringFeedbackModal from '../components/GatheringFeedbackModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import * as Haptics from 'expo-haptics';

// The live, day-of screen for people who already joined — distinct from
// GatheringDetailScreen (which is the persuade-you-to-join page). Built
// against the Aug 7 "Gathering Hub" vision doc; see the migration comment
// in 20260807_gathering_hub.sql for what was deliberately left out
// (live GPS/ETA tracking, GPS-verified arrivals) and why.
const HOURS_CONSIDERED_OVER = 3;

function getCountdownLabel(scheduledAt) {
  const diffMs = new Date(scheduledAt).getTime() - Date.now();
  if (diffMs > 0) {
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `Starts in ${mins} min`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `Starts in ${hours}h ${remMins}m` : `Starts in ${hours}h`;
  }
  const hoursPast = -diffMs / (1000 * 60 * 60);
  if (hoursPast < HOURS_CONSIDERED_OVER) return 'Happening now';
  return null;
}

export default function GatheringHubScreen({ route, navigation }) {
  const { gatheringId, justJoined } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [gathering, setGathering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [firstTimerIds, setFirstTimerIds] = useState(new Set());
  const [meetupPoint, setMeetupPoint] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [onMyWayBusy, setOnMyWayBusy] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [showJoinedBanner, setShowJoinedBanner] = useState(!!justJoined);
  const [isFirstJoin, setIsFirstJoin] = useState(false);
  const [showGrowthPrompt, setShowGrowthPrompt] = useState(false);
  const [growthInviteModalVisible, setGrowthInviteModalVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [hostStats, setHostStats] = useState(null);

  const load = useCallback(async () => {
    const g = await getGatheringById(gatheringId);
    setGathering(g);
    setLoading(false);
    if (!g) return;

    const others = g.approvedAttendees.filter((a) => a.user_id !== g.myAttendee?.user_id);
    if (others.length > 0) {
      Promise.all(
        others.map(async (a) => {
          const path = a.profiles?.photo_url;
          if (!path) return null;
          return [a.user_id, await getSignedPhotoUrl(path)];
        })
      ).then((entries) => setAttendeePhotoUrls(Object.fromEntries(entries.filter(Boolean))));

      getFirstTimerAttendeeIds(gatheringId, others.map((a) => a.user_id)).then((ids) => setFirstTimerIds(new Set(ids)));
    }

    if (g.host_id) {
      getHostStats(g.host_id).then(setHostStats);
    }

    if (g.isHost || g.myStatus === 'approved') {
      getGatheringMeetupPoint(gatheringId).then(setMeetupPoint);
    }

    if (g.latitude != null && g.longitude != null) {
      getSocialForecast(g.latitude, g.longitude).then(setForecast);
    }

    const countdown = getCountdownLabel(g.scheduled_at);
    if (!g.isHost && countdown === null) {
      hasSubmittedFeedback(gatheringId).then((already) => setFeedbackVisible(!already));
    }
  }, [gatheringId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (justJoined) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      isFirstGatheringJoin().then(setIsFirstJoin);
    }
  }, [justJoined]);

  useEffect(() => {
    if (!showJoinedBanner) return;
    const t = setTimeout(() => {
      setShowJoinedBanner(false);
      // Shown once, right after a public (auto-join) join succeeds --
      // justJoined is only ever passed for that case (GatheringDetailScreen
      // only navigates here with it after an is_public join), so it's
      // never shown for host-approval (nothing to celebrate yet, still
      // pending) or invite_only (came in via a direct invite already).
      setShowGrowthPrompt(true);
    }, 2200);
    return () => clearTimeout(t);
  }, [showJoinedBanner]);

  async function handleGrowthShareLink() {
    try {
      await Share.share({
        message: `Join me: ${gathering?.title ?? 'this gathering'} — nearby://gathering/${gatheringId}`,
        url: `nearby://gathering/${gatheringId}`,
      });
    } catch (e) {
      // Share sheet cancellation isn't an error worth surfacing.
    }
    setShowGrowthPrompt(false);
  }

  async function handleOnMyWay() {
    setOnMyWayBusy(true);
    try {
      await setGatheringOnMyWay(gatheringId);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setOnMyWayBusy(false);
  }

  async function handleCheckIn() {
    setCheckInBusy(true);
    try {
      await checkInToGathering(gatheringId);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setCheckInBusy(false);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading the gathering hub...</Text>
      </View>
    );
  }

  if (!gathering || (!gathering.isHost && gathering.myStatus !== 'approved')) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.notFoundText}>
          {gathering ? "You'll see the Gathering Hub once you've joined." : "This gathering isn't available anymore."}
        </Text>
        {gathering && (
          <TouchableOpacity
            onPress={() => navigation.replace('GatheringDetail', { gatheringId })}
            style={{ marginTop: spacing.md }}
            accessibilityLabel="View gathering"
            accessibilityRole="button"
          >
            <Text style={{ color: colors.primary, fontWeight: '700' }}>View gathering →</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const categoryStyle = categoryStyleFor(gathering.interest_tag);
  const others = gathering.approvedAttendees.filter((a) => a.user_id !== gathering.myAttendee?.user_id);
  const onTheWay = gathering.approvedAttendees.filter((a) => a.on_my_way_at);
  const checkedIn = gathering.approvedAttendees.filter((a) => a.checked_in_at);
  const iAmCheckedIn = !!gathering.myAttendee?.checked_in_at;
  const iAmOnMyWay = !!gathering.myAttendee?.on_my_way_at;
  const countdown = getCountdownLabel(gathering.scheduled_at);
  const isOver = countdown === null;

  // Every true fact stacks (matches the vision doc's own example, where
  // Sarah gets both a shared-interest line and "First time here" at
  // once) — this only ever picks from real signals already fetched
  // above, never a single best-guess line.
  function meetPersonLines(attendee) {
    const lines = [];
    if (attendee.user_id === gathering.host_id) {
      lines.push('Organizer');
      if (hostStats?.gatherings_hosted > 0) {
        lines.push(`Hosted ${hostStats.gatherings_hosted} gathering${hostStats.gatherings_hosted === 1 ? '' : 's'}`);
      }
      return lines;
    }
    const theirInterests = attendee.profiles?.interests ?? [];
    const shared = (gathering.myInterests ?? []).filter((i) => theirInterests.includes(i));
    if (shared.length > 0) lines.push(`Also into ${shared.slice(0, 2).join(' and ')}`);
    if (firstTimerIds.has(attendee.user_id)) lines.push('First time here');
    if (lines.length === 0) lines.push(`Going to ${gathering.title}`);
    return lines;
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}>
        {showJoinedBanner && (
          <View style={[styles.joinedBanner, { borderColor: categoryStyle.color, backgroundColor: categoryStyle.color + '20' }]}>
            <Text style={styles.joinedBannerTitle}>{isFirstJoin ? 'Your First Gathering! 🎉🌟' : "You're In! 🎉"}</Text>
            <Text style={styles.joinedBannerSub}>{gathering.title}</Text>
            {countdown && <Text style={styles.joinedBannerSub}>{countdown}</Text>}
            <Text style={styles.joinedBannerFoot}>
              {isFirstJoin ? "This is the start of something great — welcome to Nearby gatherings." : "We'll help you have a great time."}
            </Text>
          </View>
        )}

        {showGrowthPrompt && (
          <View style={[styles.growthPrompt, { borderColor: categoryStyle.color }]}>
            <Text style={styles.growthPromptTitle}>Want to bring someone?</Text>
            <TouchableOpacity
              style={[styles.growthAction, { backgroundColor: categoryStyle.color }]}
              onPress={() => setGrowthInviteModalVisible(true)}
              activeOpacity={0.85}
              accessibilityLabel="Invite a Friend"
              accessibilityRole="button"
            >
              <Text style={styles.growthActionText}>🤝 Invite a Friend</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.growthAction, styles.growthActionSecondary]}
              onPress={handleGrowthShareLink}
              activeOpacity={0.85}
              accessibilityLabel="Share Link"
              accessibilityRole="button"
            >
              <Text style={[styles.growthActionText, styles.growthActionTextSecondary]}>🔗 Share Link</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowGrowthPrompt(false)} style={{ marginTop: spacing.xs }} accessibilityLabel="Skip" accessibilityRole="button">
              <Text style={styles.growthSkip}>Skip</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.headerRow}>
          <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
            <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{gathering.title}</Text>
            <Text style={styles.metaLine}>
              {countdown ?? 'This gathering has wrapped up'} · {gathering.approvedAttendees.length} attending
            </Text>
          </View>
        </View>

        {gathering.isHost && (
          <View style={styles.hostBanner}>
            <Text style={styles.hostBannerText}>You're hosting — attendees below can see this hub too.</Text>
          </View>
        )}

        {iAmCheckedIn ? (
          <View style={styles.duringPanel}>
            <Text style={styles.duringTitle}>Have fun! 🎉</Text>
            <Text style={styles.duringSub}>We'll see you afterwards.</Text>

            {checkedIn.length > 0 && (
              <View style={styles.whosHereRow}>
                <Text style={styles.sectionLabel}>Who's Here</Text>
                <Text style={styles.whosHereText}>
                  {checkedIn.length} {checkedIn.length === 1 ? 'person has' : 'people have'} checked in
                </Text>
              </View>
            )}

            <View style={styles.duringActionsRow}>
              <TouchableOpacity
                style={styles.duringAction}
                onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
                accessibilityLabel="Say hi in group chat"
                accessibilityRole="button"
              >
                <Text style={styles.duringActionText}>💬 Say Hi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.duringAction}
                onPress={() => navigation.navigate('GatheringDetail', { gatheringId })}
                accessibilityLabel="Questions"
                accessibilityRole="button"
              >
                <Text style={styles.duringActionText}>❓ Questions</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.duringAction}
                onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
                accessibilityLabel="Share a photo"
                accessibilityRole="button"
              >
                <Text style={styles.duringActionText}>📸 Photos</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {others.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Who You'll Meet</Text>
                {others.slice(0, 5).map((a) => (
                  <TouchableOpacity
                    key={a.user_id}
                    style={styles.meetRow}
                    onPress={() => navigation.navigate('ViewProfile', { userId: a.user_id })}
                    accessibilityLabel={`View ${a.profiles?.display_name}'s profile`}
                    accessibilityRole="button"
                  >
                    {attendeePhotoUrls[a.user_id] ? (
                      <Image source={{ uri: attendeePhotoUrls[a.user_id] }} style={styles.meetAvatar} />
                    ) : (
                      <View style={[styles.meetAvatar, styles.meetAvatarPlaceholder]} />
                    )}
                    <View>
                      <Text style={styles.meetName}>{a.profiles?.display_name}</Text>
                      {meetPersonLines(a).map((line, i) => (
                        <Text key={i} style={styles.meetLine}>{line}</Text>
                      ))}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Ice Breakers</Text>
              <View style={styles.chipsWrap}>
                {iceBreakersFor(gathering.interest_tag).map((starter) => (
                  <TouchableOpacity
                    key={starter}
                    style={styles.iceChip}
                    onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title, draftText: starter })}
                    accessibilityLabel={`Send conversation starter: ${starter}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.iceChipText}>{starter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.chatButton, { backgroundColor: categoryStyle.color }]}
              onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
              activeOpacity={0.85}
              accessibilityLabel="Open group chat"
              accessibilityRole="button"
            >
              <Text style={styles.chatButtonText}>💬 Group Chat</Text>
            </TouchableOpacity>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Before You Go</Text>
              {forecast && (
                <Text style={styles.checklistItem}>☀️ {forecast.forecast_label}{forecast.forecast_detail ? ` — ${forecast.forecast_detail}` : ''}</Text>
              )}
              {prepTipsFor(gathering.interest_tag).map((tip) => (
                <Text key={tip} style={styles.checklistItem}>✓ {tip}</Text>
              ))}
            </View>

            {meetupPoint && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Meet-Up Point</Text>
                <MapView
                  style={styles.map}
                  initialRegion={{ latitude: meetupPoint.latitude, longitude: meetupPoint.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                >
                  <Marker coordinate={meetupPoint} pinColor={categoryStyle.color} />
                </MapView>
              </View>
            )}

            {!gathering.isHost && !isOver && (
              <View style={styles.section}>
                {onTheWay.length > 0 && (
                  <Text style={styles.onTheWayText}>
                    🚗 {onTheWay.length} {onTheWay.length === 1 ? 'person is' : 'people are'} on the way
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.bigButton, { backgroundColor: iAmOnMyWay ? colors.surface : categoryStyle.color, borderWidth: iAmOnMyWay ? 1 : 0, borderColor: colors.border }, shadow.button]}
                  onPress={handleOnMyWay}
                  disabled={onMyWayBusy || iAmOnMyWay}
                  activeOpacity={0.85}
                  accessibilityLabel={iAmOnMyWay ? "You're on your way" : "I'm On My Way"}
                  accessibilityRole="button"
                >
                  <Text style={[styles.bigButtonText, iAmOnMyWay && { color: colors.textSecondary }]}>
                    {iAmOnMyWay ? "You're On Your Way" : "I'M ON MY WAY"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.checkInLink}
                  onPress={handleCheckIn}
                  disabled={checkInBusy}
                  accessibilityLabel="I'm here, check in"
                  accessibilityRole="button"
                >
                  <Text style={styles.checkInLinkText}>I'm here — check in</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <GatheringFeedbackModal
        visible={feedbackVisible}
        gatheringId={gatheringId}
        navigation={navigation}
        onClose={() => setFeedbackVisible(false)}
      />

      <InviteFriendsModal
        visible={growthInviteModalVisible}
        onClose={() => {
          setGrowthInviteModalVisible(false);
          setShowGrowthPrompt(false);
        }}
        gatheringId={gatheringId}
        gatheringTitle={gathering.title}
      />
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  notFoundText: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  joinedBanner: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  joinedBannerTitle: { ...typography.title, color: colors.textPrimary },
  joinedBannerSub: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 2 },
  joinedBannerFoot: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm },
  growthPrompt: {
    borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, alignItems: 'center',
    marginBottom: spacing.lg, backgroundColor: colors.surface,
  },
  growthPromptTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  growthAction: { width: '100%', borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm },
  growthActionSecondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  growthActionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  growthActionTextSecondary: { color: colors.textPrimary },
  growthSkip: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryBadge: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  categoryBadgeIcon: { fontSize: 20 },
  title: { ...typography.title, color: colors.textPrimary },
  metaLine: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  hostBanner: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  hostBannerText: { color: colors.textSecondary, fontSize: 13 },
  section: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  sectionLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  meetAvatar: { width: 44, height: 44, borderRadius: 22 },
  meetAvatarPlaceholder: { backgroundColor: colors.border },
  meetName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  meetLine: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iceChip: { backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iceChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chatButton: { marginTop: spacing.lg, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center' },
  chatButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  checklistItem: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.xs },
  map: { width: '100%', height: 180, borderRadius: radius.lg },
  onTheWayText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  bigButton: { borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center' },
  bigButtonText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  checkInLink: { marginTop: spacing.md, alignItems: 'center' },
  checkInLinkText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  duringPanel: { marginTop: spacing.xl, alignItems: 'center', padding: spacing.lg },
  duringTitle: { ...typography.title, color: colors.textPrimary },
  duringSub: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  whosHereRow: { marginTop: spacing.xl, alignItems: 'center' },
  whosHereText: { color: colors.textSecondary, fontSize: 13 },
  duringActionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  duringAction: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  duringActionText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
