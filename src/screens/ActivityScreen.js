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
import SkeletonGridCard from '../components/SkeletonGridCard';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

// A genuinely unified feed — notices/waves, recent crossed paths,
// friend requests, and other activity all interleaved by recency
// into one chronological list, rather than scattered across
// separate places to check.
export default function ActivityScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const [items, setItems] = useState([]);
  const [premium, setPremium] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [compatScores, setCompatScores] = useState({});
  const [noticedBackIds, setNoticedBackIds] = useState({});
  const [respondedFriendIds, setRespondedFriendIds] = useState({});

  const load = useCallback(async () => {
    const premiumStatus = await isPremium().catch(() => false);
    setPremium(premiumStatus);

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) {
      supabase.from('profiles').update({ last_activity_check: new Date().toISOString() }).eq('id', myId);
    }
    const { data: myProfile } = await supabase.from('profiles').select('interests, basics').eq('id', myId).single();

    const { data: existingMatches } = await supabase
      .from('matches')
      .select('user_a, user_b')
      .or(`user_a.eq.${myId},user_b.eq.${myId}`);

    const matchedUserIds = new Set(
      (existingMatches ?? []).map((m) => (m.user_a === myId ? m.user_b : m.user_a))
    );

    const { data: blockedByMe } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', myId);
    const { data: blockedMe } = await supabase.from('blocks').select('blocker_id').eq('blocked_id', myId);
    const excludedUserIds = new Set([
      ...(blockedByMe ?? []).map((b) => b.blocked_id),
      ...(blockedMe ?? []).map((b) => b.blocker_id),
    ]);

    const { data: noticesData } = await supabase
      .from('notices')
      .select('id, from_user, created_at, is_super, profiles!notices_from_user_fkey(display_name, photo_url, interests, basics)')
      .eq('to_user', myId)
      .order('created_at', { ascending: false });

    const filteredNotices = (noticesData ?? []).filter((n) => !matchedUserIds.has(n.from_user) && !excludedUserIds.has(n.from_user));

    const noticeItems = filteredNotices.map((n) => ({
      type: 'notice',
      key: `notice-${n.id}`,
      timestamp: n.created_at,
      raw: n,
    }));

    const sightings = await getNearbyMatches().catch(() => []);
    const sightingItems = sightings.slice(0, 10).map((s) => ({
      type: 'sighting',
      key: `sighting-${s.id}`,
      timestamp: s.last_seen_at,
      raw: s,
    }));

    const pendingFriends = await getPendingFriendRequests().catch(() => []);
    const friendRequestItems = pendingFriends.map((f) => ({
      type: 'friend_request',
      key: `friend-${f.friendshipId}`,
      timestamp: new Date().toISOString(),
      raw: f,
    }));

    const businessUpdates = await getFollowedBusinessUpdates().catch(() => []);
    const businessUpdateItems = businessUpdates.map((u) => ({
      type: 'business_update',
      key: `business-${u.id}`,
      timestamp: u.created_at,
      raw: u,
    }));

    const allItems = [...noticeItems, ...sightingItems, ...friendRequestItems, ...businessUpdateItems].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    setItems(allItems);

    const urlEntries = await Promise.all(
      allItems.map(async (item) => {
        const path = item.type === 'friend_request' ? item.raw.photo_url : item.raw.profiles?.photo_url;
        if (!path) return [item.key, null];
        const url = await getSignedPhotoUrl(path);
        return [item.key, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const scoreEntries = noticeItems.map((item) => [item.key, calculateCompatibility(myProfile, item.raw.profiles)]);
    setCompatScores(Object.fromEntries(scoreEntries));

    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  function handleCardPress(item) {
    if (item.type === 'friend_request') {
      navigation.navigate('ViewProfile', { userId: item.raw.id });
      return;
    }
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
        { text: 'Send a Message', onPress: () => navigation.navigate('Matches') },
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

  async function handleFriendRespond(item, accept) {
    try {
      await respondToFriendRequest(item.raw.friendshipId, accept);
      setRespondedFriendIds((prev) => ({ ...prev, [item.key]: true }));
      load();
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">Activity</Text>
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
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🔔</Text>
              <Text style={styles.emptyText}>
                Nothing new yet — notices, crossed paths, and other activity will show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === 'friend_request') {
              const f = item.raw;
              const responded = respondedFriendIds[item.key];
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => handleCardPress(item)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${f.display_name} sent a friend request`}
                  accessibilityRole="button"
                >
                  {photoUrls[item.key] ? (
                    <Image source={{ uri: photoUrls[item.key] }} style={styles.rowAvatar} />
                  ) : (
                    <View style={[styles.rowAvatar, styles.avatarPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>🤝 {f.display_name} wants to be friends</Text>
                  </View>
                  {!responded && (
                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                      <TouchableOpacity
                        style={styles.inlineButton}
                        onPress={() => handleFriendRespond(item, true)}
                        accessibilityLabel={`Accept ${f.display_name}'s friend request`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.inlineButtonText}>✓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.inlineButton, styles.declineInlineButton]}
                        onPress={() => handleFriendRespond(item, false)}
                        accessibilityLabel={`Decline ${f.display_name}'s friend request`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.inlineButtonText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }

            if (item.type === 'business_update') {
              const u = item.raw;
              return (
                <View style={styles.row} accessibilityLabel={`${u.brand_partners?.name}: ${u.title}`}>
                  <View style={[styles.rowAvatar, styles.avatarPlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ fontSize: 20 }}>📣</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{u.brand_partners?.name}: {u.title}</Text>
                    {u.body ? <Text style={styles.rowSubtitle}>{u.body}</Text> : null}
                  </View>
                </View>
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
  inlineButton: { backgroundColor: colors.primary, borderRadius: radius.full, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  inlineButtonDone: { backgroundColor: colors.success },
  declineInlineButton: { backgroundColor: colors.surfaceElevated },
  inlineButtonText: { fontSize: 16 },
});