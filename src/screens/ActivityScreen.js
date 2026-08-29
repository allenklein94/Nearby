import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Image, RefreshControl, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import { isPremium } from '../services/purchases';
import { calculateCompatibility } from '../services/compatibility';
import { sendNoticeTo } from '../services/noticeActions';
import { getNearbyMatches } from '../services/proximity';
import { getPendingFriendRequests, respondToFriendRequest } from '../services/friends';
import { getFollowedBusinessUpdates } from '../services/brandOffers';
import { getMyBusinessEcosystemActivity, formatOfferSummary } from '../services/businessFulfillment';
import { getAllPendingRequests, approveInterest, getUpcomingReminders } from '../services/gatherings';
import { getMyReceivedInvites, respondToInvite } from '../services/invites';
import { getMyPendingGroupPlanInvites } from '../services/groupPlans';
import SkeletonGridCard from '../components/SkeletonGridCard';
import LoadErrorState from '../components/LoadErrorState';
import TabHeaderActions from '../components/TabHeaderActions';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// A genuinely unified feed — notices/waves, recent crossed paths,
// and other activity all interleaved by recency into one
// chronological list, rather than scattered across separate places
// to check.
// IA restructure round 3, Phase 2: three real top-level clusters —
// "Needs Your Attention" (Connection Requests + Invitations, each keeping
// its own sub-label), "Today" (the same-day gathering nudge, unchanged
// content/behavior), and "Earlier" (the existing chronological notices/
// sightings/business-update feed, now with a real header instead of none).
// Business-update notices deliberately stay in "Earlier", not folded into
// "Needs Your Attention" — business_updates has no urgency/actionable flag
// anywhere in its schema (just title/body/created_at), so there's no real
// signal to sort on; scoping "Needs Your Attention" to requests/invitations
// only is what the data actually supports, not an invented distinction.
// Phase 6 ("Build everything" plan, CLAUDE.md): "Earlier" also carries real
// business-request/offer ecosystem events (a business's own reply, an
// accepted offer, a confirmed reservation) — see getMyBusinessEcosystemActivity()
// — interleaved by the same real timestamp as everything else here, not a
// separate section.
// `initialSubSection` (e.g. Home's pending-invites banner deep-linking into
// the real Activity tab) still brings the requested content to the front —
// either promoting the whole Today cluster ahead of Needs Your Attention,
// or reordering which sub-group leads inside it — without
// hiding anything else.

export default function ActivityScreen({ navigation, route, initialSubSection: initialSubSectionProp }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  // Reached two ways: as the real bottom-tab route (name 'Activity',
  // Phase 5's bottom-nav restructuring) and as the standalone pushed
  // 'Notices' route (e.g. a cold-start push tap) -- initialSubSection
  // falls back to route.params for the direct-navigation case, and the
  // header's Messages/Profile icons only render for the real tab, not
  // a pushed 'Notices' screen that already has its own back chevron.
  const initialSubSection = initialSubSectionProp ?? route?.params?.initialSubSection;
  const showHeaderActions = route?.name === 'Activity';
  const [items, setItems] = useState([]);
  const [premium, setPremium] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [compatScores, setCompatScores] = useState({});
  const [noticedBackIds, setNoticedBackIds] = useState({});
  const [respondedFriendIds, setRespondedFriendIds] = useState({});

  // Connection Requests — pending gathering_interest rows for
  // gatherings the caller hosts (formerly Inbox's "Requests" tab).
  const [connectionRequests, setConnectionRequests] = useState([]);
  const [requestPhotoUrls, setRequestPhotoUrls] = useState({});

  // Invitations — pending friend requests + pending gathering/community
  // invites, combined (formerly Inbox's "Invites" tab). Group plan
  // invites joined the same combined list per Finding G.1 (Aug 15 2026
  // connectivity audit) — previously only reachable via a push tap.
  const [friendRequests, setFriendRequests] = useState([]);
  const [friendRequestPhotoUrls, setFriendRequestPhotoUrls] = useState({});
  const [socialInvites, setSocialInvites] = useState([]);
  const [groupPlanInvites, setGroupPlanInvites] = useState([]);

  // Upcoming — a same-day nudge, not a second calendar. Home's own
  // "Your Plans" section is the canonical place for every upcoming
  // commitment regardless of when it is; this group only ever shows
  // gatherings starting within the next ~12h (see getUpcomingReminders'
  // own comment) and renders nothing at all when there's nothing that
  // near-term — an attention surface, not a duplicate of Home's list.
  const [reminders, setReminders] = useState([]);

  // Within the "Needs Your Attention" cluster: which sub-group leads.
  const attentionSubOrder = initialSubSection === 'invitations' ? ['invitations', 'requests'] : ['requests', 'invitations'];
  // Top-level cluster order: deep-linking to "reminders" promotes the whole
  // "Today" cluster ahead of "Needs Your Attention".
  const clusterOrder = initialSubSection === 'reminders' ? ['today', 'needsAttention'] : ['needsAttention', 'today'];

  const load = useCallback(async () => {
    try {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) {
      supabase.from('profiles').update({ last_activity_check: new Date().toISOString() }).eq('id', myId);
    }

    // Every one of these only needs myId, not each other's result -- they
    // were only ever chained one after another, which meant this screen's
    // own loading spinner stayed up for the sum of ~8 round trips instead
    // of the slowest one (the same bug already found and fixed on Home).
    // Fired together instead; the filtering/scoring/sorting that combines
    // their results stays as synchronous logic below, once they've all
    // resolved.
    const [
      premiumStatus,
      { data: myProfile },
      { data: existingMatches },
      { data: blockedByMe },
      { data: blockedMe },
      { data: noticesData },
      sightings,
      businessUpdates,
      businessEcosystemItems,
    ] = await Promise.all([
      isPremium().catch(() => false),
      supabase.from('profiles').select('interests, basics, relationship_intention').eq('id', myId).single(),
      supabase.from('matches').select('user_a, user_b').or(`user_a.eq.${myId},user_b.eq.${myId}`),
      supabase.from('blocks').select('blocked_id').eq('blocker_id', myId),
      supabase.from('blocks').select('blocker_id').eq('blocked_id', myId),
      // Scalability audit step 10: was unbounded. Same plain-cap treatment
      // as getCommunityMembers()/getPublicCommunities() (locked decision
      // 6) — no "load more" UI exists or is demanded today for this feed.
      supabase
        .from('notices')
        .select('id, from_user, created_at, is_super, profiles!notices_from_user_fkey(display_name, photo_url, interests, basics, relationship_intention)')
        .eq('to_user', myId)
        .order('created_at', { ascending: false })
        .limit(200),
      getNearbyMatches().catch(() => []),
      getFollowedBusinessUpdates().catch(() => []),
      // Phase 6 of the "build everything" plan (CLAUDE.md): "Activity as
      // ecosystem memory" — real business-request/offer status-change
      // events (a business's own reply, an accepted offer, a confirmed
      // reservation), interleaved into the same chronological feed as
      // every other real signal here, not a separate section.
      getMyBusinessEcosystemActivity(myId).catch(() => []),
    ]);
    setPremium(premiumStatus);

    const matchedUserIds = new Set(
      (existingMatches ?? []).map((m) => (m.user_a === myId ? m.user_b : m.user_a))
    );
    const excludedUserIds = new Set([
      ...(blockedByMe ?? []).map((b) => b.blocked_id),
      ...(blockedMe ?? []).map((b) => b.blocker_id),
    ]);

    const filteredNotices = (noticesData ?? []).filter((n) => !matchedUserIds.has(n.from_user) && !excludedUserIds.has(n.from_user));

    const noticeItems = filteredNotices.map((n) => ({
      type: 'notice',
      key: `notice-${n.id}`,
      timestamp: n.created_at,
      raw: n,
    }));

    const sightingItems = sightings.slice(0, 10).map((s) => ({
      type: 'sighting',
      key: `sighting-${s.id}`,
      timestamp: s.last_seen_at,
      raw: s,
    }));

    const businessUpdateItems = businessUpdates.map((u) => ({
      type: 'business_update',
      key: `business-${u.id}`,
      timestamp: u.created_at,
      raw: u,
    }));

    // Friend requests are no longer interleaved into this chronological
    // feed — they now render in the "Invitations" group below instead,
    // alongside gathering/community invites, so they aren't shown twice.
    const allItems = [...noticeItems, ...sightingItems, ...businessUpdateItems, ...businessEcosystemItems].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    setItems(allItems);

    const urlEntries = await Promise.all(
      allItems.map(async (item) => {
        const path = item.raw.profiles?.photo_url;
        if (!path) return [item.key, null];
        const url = await getSignedPhotoUrl(path);
        return [item.key, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const scoreEntries = noticeItems.map((item) => [item.key, calculateCompatibility(myProfile, item.raw.profiles)]);
    setCompatScores(Object.fromEntries(scoreEntries));

    setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConnectionRequests = useCallback(async () => {
    try {
      const results = await getAllPendingRequests();
      setConnectionRequests(results);
      const urlEntries = await Promise.all(
        results.map(async (r) => {
          const path = r.profiles?.photo_url;
          if (!path) return [r.id, null];
          const url = await getSignedPhotoUrl(path);
          return [r.id, url];
        })
      );
      setRequestPhotoUrls(Object.fromEntries(urlEntries));
    } catch (e) {
      console.error('loadConnectionRequests failed', e);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    try {
      const [friends, invites, groupPlans] = await Promise.all([getPendingFriendRequests(), getMyReceivedInvites(), getMyPendingGroupPlanInvites()]);
      setFriendRequests(friends);
      setSocialInvites(invites);
      setGroupPlanInvites(groupPlans);
      const urlEntries = await Promise.all(
        friends.map(async (f) => {
          if (!f.photo_url) return [f.friendshipId, null];
          const url = await getSignedPhotoUrl(f.photo_url);
          return [f.friendshipId, url];
        })
      );
      setFriendRequestPhotoUrls(Object.fromEntries(urlEntries));
    } catch (e) {
      console.error('loadInvitations failed', e);
    }
  }, []);

  const loadReminders = useCallback(async () => {
    try {
      const results = await getUpcomingReminders();
      setReminders(results);
    } catch (e) {
      console.error('loadReminders failed', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadConnectionRequests();
      loadInvitations();
      loadReminders();
    }, [load, loadConnectionRequests, loadInvitations, loadReminders])
  );

  async function onRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await Promise.all([load(), loadConnectionRequests(), loadInvitations(), loadReminders()]);
    setRefreshing(false);
  }

  function formatTimeUntil(iso) {
    const diffMs = new Date(iso).getTime() - Date.now();
    const diffHours = Math.round(diffMs / (60 * 60 * 1000));
    if (diffHours < 1) return 'starting soon';
    if (diffHours === 1) return 'in 1 hour';
    return `in ${diffHours} hours`;
  }

  async function handleApproveConnectionRequest(request) {
    try {
      const result = await approveInterest(request.id);
      if (result?.status === 'waitlisted') {
        Alert.alert('Gathering full', "This gathering is already at capacity — they've been added to the waitlist instead.");
      }
      loadConnectionRequests();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleRespondSocialInvite(invite, accept) {
    try {
      await respondToInvite(invite.id, accept);
      loadInvitations();
      if (accept) {
        const screen = invite.inviteType === 'gathering' ? 'GatheringDetail' : 'CommunityDetail';
        const params = invite.inviteType === 'gathering'
          ? { gatheringId: invite.targetId }
          : { communityId: invite.targetId, communityName: invite.targetTitle };
        navigation.navigate(screen, params);
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  // Unlike MatchesScreen's identical-looking badge (a real TouchableOpacity
  // opening the compatibility report), this text is a passive stat inside an
  // already-tappable row, not its own tap target — so it never uses brand
  // coral, only the "great match" success color when it applies.
  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    return colors.textSecondary;
  }

  function handleCardPress(item) {
    const userId = item.type === 'notice' ? item.raw.from_user : item.raw.otherUserId;
    if (premium || item.type === 'sighting') {
      navigation.navigate('ViewProfile', { userId });
    } else {
      navigation.navigate('Paywall');
    }
  }

  async function handleNoticeBack(item) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await sendNoticeTo(item.raw.from_user, false);
      setNoticedBackIds((prev) => ({ ...prev, [item.key]: true }));
      Alert.alert("It's a Match! 🎉", `You and ${item.raw.profiles?.display_name} noticed each other.`, [
        { text: 'Keep Browsing', style: 'cancel' },
        { text: 'Send a Message', onPress: () => navigation.navigate('Messages') },
      ]);
      load();
    } catch (e) {
      if (e.message === 'ALREADY_SENT') {
        load();
      } else {
        Alert.alert('Error', e.message);
      }
    }
  }

  async function handleFriendRespond(friendReq, accept) {
    try {
      await respondToFriendRequest(friendReq.friendshipId, accept);
      setRespondedFriendIds((prev) => ({ ...prev, [friendReq.friendshipId]: true }));
      loadInvitations();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function formatTimeAgo(iso) {
    const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }

  // Combined so "Invitations" reflects real invites of every kind this
  // app actually has (friend requests + gathering/community invites +,
  // per Finding G.1, group-plan invites).
  const combinedInvites = [
    ...friendRequests.filter((f) => !respondedFriendIds[f.friendshipId]).map((f) => ({ kind: 'friend', ...f })),
    ...socialInvites.map((i) => ({ kind: 'social', ...i })),
    ...groupPlanInvites.map((g) => ({ kind: 'groupPlan', ...g })),
  ];

  function renderGroup(groupName) {
    if (groupName === 'requests' && connectionRequests.length > 0) {
      return (
        <View key="requests" style={styles.group}>
          <Text style={styles.groupHeader}>🙋 Connection Requests ({connectionRequests.length})</Text>
          {connectionRequests.map((item) => (
            <View key={item.id} style={styles.row}>
              {requestPhotoUrls[item.id] ? (
                <Image source={{ uri: requestPhotoUrls[item.id] }} style={styles.rowAvatar} />
              ) : (
                <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.profiles?.display_name}</Text>
                <Text style={styles.rowSubtitle}>wants to join {item.gatherings?.title}</Text>
              </View>
              <TouchableOpacity
                style={styles.textButton}
                onPress={() => handleApproveConnectionRequest(item)}
                accessibilityLabel={`Approve ${item.profiles?.display_name}'s request`}
                accessibilityRole="button"
              >
                <Text style={styles.textButtonLabel}>Approve</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      );
    }

    if (groupName === 'invitations' && combinedInvites.length > 0) {
      return (
        <View key="invitations" style={styles.group}>
          <Text style={styles.groupHeader}>🤝 Invitations ({combinedInvites.length})</Text>
          {combinedInvites.map((item) => item.kind === 'groupPlan' ? (
            <TouchableOpacity
              key={`group-plan-${item.proposalId}`}
              style={styles.row}
              onPress={() => navigation.navigate('GroupPlan', { proposalId: item.proposalId })}
              accessibilityLabel={`${item.initiatorName} wants to make a group plan with you`}
              accessibilityRole="button"
            >
              <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.initiatorName}</Text>
                <Text style={styles.rowSubtitle}>wants to make your {item.category} request a group plan</Text>
              </View>
              <Text style={styles.textButtonLabel}>View & Respond →</Text>
            </TouchableOpacity>
          ) : item.kind === 'friend' ? (
            <View key={`friend-${item.friendshipId}`} style={styles.row}>
              {friendRequestPhotoUrls[item.friendshipId] ? (
                <Image source={{ uri: friendRequestPhotoUrls[item.friendshipId] }} style={styles.rowAvatar} />
              ) : (
                <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.display_name}</Text>
                <Text style={styles.rowSubtitle}>wants to be friends</Text>
              </View>
              <TouchableOpacity
                style={styles.textButton}
                onPress={() => handleFriendRespond(item, true)}
                accessibilityLabel={`Accept ${item.display_name}'s friend request`}
                accessibilityRole="button"
              >
                <Text style={styles.textButtonLabel}>Accept</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View key={`social-${item.id}`} style={styles.row}>
              <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.inviterName}</Text>
                <Text style={styles.rowSubtitle}>
                  invited you to {item.inviteType === 'gathering' ? 'a gathering' : 'a community'}: {item.targetTitle}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.textButton, styles.declineTextButton]}
                onPress={() => handleRespondSocialInvite(item, false)}
                accessibilityLabel={`Decline invite to ${item.targetTitle}`}
                accessibilityRole="button"
              >
                <Text style={styles.declineTextButtonLabel}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.textButton}
                onPress={() => handleRespondSocialInvite(item, true)}
                accessibilityLabel={`Accept invite to ${item.targetTitle}`}
                accessibilityRole="button"
              >
                <Text style={styles.textButtonLabel}>Accept</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      );
    }

    if (groupName === 'reminders' && reminders.length > 0) {
      return (
        <View key="reminders" style={styles.group}>
          {reminders.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.row}
              onPress={() => navigation.navigate('GatheringDetail', { gatheringId: item.id })}
              accessibilityLabel={`${item.title}, ${formatTimeUntil(item.scheduledAt)}`}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSubtitle}>{item.role} · {formatTimeUntil(item.scheduledAt)}</Text>
                <Text style={styles.viewLink}>View gathering →</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    return null;
  }

  function renderNeedsAttentionCluster() {
    if (connectionRequests.length === 0 && combinedInvites.length === 0) return null;
    return (
      <View key="needsAttention" style={styles.cluster}>
        <Text style={styles.clusterHeader}>🎯 Needs Your Attention</Text>
        {attentionSubOrder.map((groupName) => renderGroup(groupName))}
      </View>
    );
  }

  function renderTodayCluster() {
    if (reminders.length === 0) return null;
    return (
      <View key="today" style={styles.cluster}>
        <Text style={styles.clusterHeader}>📅 Today ({reminders.length})</Text>
        {renderGroup('reminders')}
      </View>
    );
  }

  const hasAnyGroupContent = connectionRequests.length > 0 || combinedInvites.length > 0 || reminders.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { flex: 1 }]} accessibilityRole="header">Activity</Text>
          {showHeaderActions && <TabHeaderActions navigation={navigation} />}
        </View>
      </View>

      {!premium && (
        <TouchableOpacity
          style={styles.upsell}
          onPress={() => navigation.navigate('Paywall')}
          activeOpacity={0.85}
          accessibilityLabel={`${t('notices.unlockPremium')}. ${t('notices.unlockPremiumText')}`}
          accessibilityRole="button"
        >
          <Text style={styles.upsellIcon}>✨</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.upsellTitle}>{t('notices.unlockPremium')}</Text>
            <Text style={styles.upsellText}>{t('notices.unlockPremiumText')}</Text>
          </View>
          <Text style={styles.upsellArrow}>›</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.skeletonGrid}>
          {[...Array(4)].map((_, i) => <SkeletonGridCard key={i} />)}
        </View>
      ) : loadError ? (
        <LoadErrorState message="Couldn't load your activity." onRetry={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={(hasAnyGroupContent || items.length > 0) ? (
            <View style={{ marginBottom: spacing.md }}>
              {clusterOrder.map((cluster) => cluster === 'needsAttention' ? renderNeedsAttentionCluster() : renderTodayCluster())}
              {items.length > 0 && <Text style={styles.clusterHeader}>🕰️ Earlier</Text>}
            </View>
          ) : null}
          ListEmptyComponent={hasAnyGroupContent ? null : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🔔</Text>
              <Text style={styles.emptyText}>
                Nothing new yet — notices, crossed paths, and other activity will show up here.
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            if (item.type === 'business_update') {
              const u = item.raw;
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => navigation.navigate('BusinessProfile', { partnerId: u.partner_id })}
                  accessibilityLabel={`${u.brand_partners?.name}: ${u.title}`}
                  accessibilityRole="button"
                >
                  <View style={[styles.rowAvatar, styles.avatarPlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ fontSize: 20 }}>📣</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{u.brand_partners?.name}: {u.title}</Text>
                    {u.body ? <Text style={styles.rowSubtitle}>{u.body}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            }

            if (item.type === 'business_reply' || item.type === 'business_offer_accepted' || item.type === 'business_reservation_confirmed') {
              const { offer, request, partnerName } = item.raw;
              const icon = item.type === 'business_reply' ? '💬' : item.type === 'business_offer_accepted' ? '✅' : '📅';
              const title = item.type === 'business_reply'
                ? `${partnerName} responded to your request`
                : item.type === 'business_offer_accepted'
                  ? `You accepted ${partnerName}'s offer`
                  : `${partnerName} confirmed your reservation`;
              const subtitleParts = [formatOfferSummary(offer), request?.raw_text].filter(Boolean);
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => request?.id && navigation.navigate('BusinessRequestDetail', { requestId: request.id })}
                  accessibilityLabel={`${title}${subtitleParts.length > 0 ? `, ${subtitleParts.join(', ')}` : ''}`}
                  accessibilityRole="button"
                >
                  <View style={[styles.rowAvatar, styles.avatarPlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ fontSize: 20 }}>{icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{title}</Text>
                    {subtitleParts.length > 0 && <Text style={styles.rowSubtitle}>{subtitleParts.join(' · ')}</Text>}
                  </View>
                </TouchableOpacity>
              );
            }

            if (item.type === 'notice') {
              const n = item.raw;
              const score = compatScores[item.key];
              const hasScore = score !== null && score !== undefined;
              const alreadyNoticedBack = noticedBackIds[item.key];
              return (
                <TouchableOpacity
                  style={[styles.row, n.is_super && styles.waveRow]}
                  onPress={() => handleCardPress(item)}
                  activeOpacity={0.85}
                  accessibilityLabel={premium ? `${n.profiles?.display_name} ${n.is_super ? 'sent you a Wave' : 'noticed you'}` : `Someone ${n.is_super ? 'sent you a Wave' : 'noticed you'}, unlock Premium to see who`}
                  accessibilityRole="button"
                >
                  {photoUrls[item.key] ? (
                    <Image source={{ uri: photoUrls[item.key] }} style={styles.rowAvatar} blurRadius={premium ? 0 : 20} />
                  ) : (
                    <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
                  )}
                  {!premium && <Text style={styles.lockIconSmall}>🔒</Text>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {premium ? n.profiles?.display_name : 'Someone'} {n.is_super ? '👋 sent you a Wave' : 'noticed you'}
                    </Text>
                    <Text style={styles.rowSubtitle}>
                      {formatTimeAgo(item.timestamp)}
                      {hasScore && (
                        <Text> · <Text style={{ color: compatibilityColor(score), fontWeight: '700' }}>{score}% compatible</Text></Text>
                      )}
                    </Text>
                  </View>
                  {premium && (
                    <TouchableOpacity
                      style={[styles.inlineButton, alreadyNoticedBack && styles.inlineButtonDone]}
                      onPress={() => handleNoticeBack(item)}
                      disabled={alreadyNoticedBack}
                      accessibilityLabel={alreadyNoticedBack ? 'Already noticed back' : `Notice ${n.profiles?.display_name} back`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.inlineButtonText}>{alreadyNoticedBack ? '✓' : '👋'}</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            }

            const s = item.raw;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => handleCardPress(item)}
                activeOpacity={0.85}
                accessibilityLabel={`Crossed paths with ${s.profiles?.display_name}`}
                accessibilityRole="button"
              >
                {photoUrls[item.key] ? (
                  <Image source={{ uri: photoUrls[item.key] }} style={styles.rowAvatar} />
                ) : (
                  <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>📍 Crossed paths with {s.profiles?.display_name}</Text>
                  <Text style={styles.rowSubtitle}>{formatTimeAgo(item.timestamp)}</Text>
                </View>
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  upsell: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary,
    borderRadius: radius.lg, padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.lg, ...shadow.button,
  },
  upsellIcon: { fontSize: 24, marginRight: spacing.md },
  upsellTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  upsellText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  upsellArrow: { color: '#fff', fontSize: 22, fontWeight: '700' },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, width: '100%', paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginBottom: spacing.sm, ...shadow.card,
  },
  waveRow: { borderColor: colors.primary, borderWidth: 2 },
  rowAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  lockIconSmall: { position: 'absolute', left: 16, top: 16, fontSize: 18 },
  rowTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14 },
  rowSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  viewLink: { color: colors.primary, fontWeight: '700', fontSize: 12, marginTop: 4 },
  inlineButton: { backgroundColor: colors.primary, borderRadius: radius.full, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  inlineButtonDone: { backgroundColor: colors.success },
  declineInlineButton: { backgroundColor: colors.surfaceElevated },
  inlineButtonText: { fontSize: 16 },
  cluster: { marginBottom: spacing.lg },
  clusterHeader: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm,
  },
  group: { marginBottom: spacing.md },
  groupHeader: {
    ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  textButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  textButtonLabel: { color: '#fff', fontWeight: '700', fontSize: 12 },
  declineTextButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginRight: spacing.xs },
  declineTextButtonLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
});