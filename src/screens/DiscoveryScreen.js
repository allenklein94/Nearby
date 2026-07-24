import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getNearbyMatches, reportPresence } from '../services/proximity';
import { getOnlineStatuses } from '../services/presenceStatus';
import { generateCompatibilityReport } from '../services/compatibility';
import { shouldOfferBreak, dismissBreakSuggestion } from '../services/confidenceMode';
import { isPremium } from '../services/purchases';
import { checkNoticeLimit, checkWaveLimit } from '../services/noticeLimits';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import CompatibilityReportModal from '../components/CompatibilityReportModal';
import ConfidenceModeBanner from '../components/ConfidenceModeBanner';
import SkeletonCard from '../components/SkeletonCard';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const UNDO_WINDOW_SECONDS = 5;

function formatCrossedPathsTime(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dateTimeStamp = then.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let relative;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  else if (diffHours < 24) relative = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else if (diffDays < 7) relative = `${diffDays} days ago`;
  else relative = null;

  return relative ? `${relative} (${dateTimeStamp})` : dateTimeStamp;
}

export default function DiscoveryScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const styles = getStyles(colors, shadow);
  const posthog = usePostHog();
  const [nearby, setNearby] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [onlineStatuses, setOnlineStatuses] = useState({});
  const [undoState, setUndoState] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [isUserPremium, setIsUserPremium] = useState(false);
  const [compatModalReport, setCompatModalReport] = useState(null);
  const [compatModalName, setCompatModalName] = useState('');
  const [showConfidenceBanner, setShowConfidenceBanner] = useState(false);
  const undoTimeoutRef = useRef(null);
  const undoOpacity = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    await reportPresence();
    const results = await getNearbyMatches();
    setNearby(results);
    setInitialLoading(false);

    const urlEntries = await Promise.all(
      results.map(async (item) => {
        const path = item.profiles?.photo_url;
        if (!path) return [item.id, null];
        const url = await getSignedPhotoUrl(path);
        return [item.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const otherUserIds = results.map((item) => item.otherUserId);
    const statuses = await getOnlineStatuses(otherUserIds);
    setOnlineStatuses(statuses);

    isPremium().then(setIsUserPremium).catch(() => setIsUserPremium(false));

    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    setMyUserId(myId);
    if (myId) {
      const { data: mine } = await supabase.from('profiles').select('interests, basics').eq('id', myId).single();
      setMyProfile(mine);

      const offerBreak = await shouldOfferBreak(myId);
      setShowConfidenceBanner(offerBreak);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleDismissConfidenceBanner() {
    setShowConfidenceBanner(false);
    if (myUserId) await dismissBreakSuggestion(myUserId);
  }

  function showRadiusInfo() {
    Alert.alert(t('discovery.radiusInfoTitle'), t('discovery.radiusInfoText'), [{ text: 'OK' }]);
  }

  function showCompatibilityReport(item) {
    const report = generateCompatibilityReport(myProfile, item.profiles);
    setCompatModalReport(report);
    setCompatModalName(item.profiles?.display_name || '');
  }

  function showUndoBanner(noticeId, isWave, otherUserId) {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoState({ noticeId, isWave, otherUserId });
    Animated.timing(undoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    undoTimeoutRef.current = setTimeout(() => {
      Animated.timing(undoOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setUndoState(null);
      });
    }, UNDO_WINDOW_SECONDS * 1000);
  }

  async function handleUndo() {
    if (!undoState) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    await supabase.from('notices').delete().eq('id', undoState.noticeId);

    if (myUserId && undoState.otherUserId) {
      await supabase
        .from('matches')
        .delete()
        .or(`and(user_a.eq.${myUserId},user_b.eq.${undoState.otherUserId}),and(user_a.eq.${undoState.otherUserId},user_b.eq.${myUserId})`);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.timing(undoOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setUndoState(null);
    });
    load();
  }

  async function sendNotice(toUserId, isWave = false) {
    const limitCheck = isWave ? await checkWaveLimit(isUserPremium) : await checkNoticeLimit(isUserPremium);
    if (!limitCheck.allowed) {
      Alert.alert(
        isWave ? 'Weekly Wave used' : 'Daily limit reached',
        limitCheck.reason,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data: sessionData } = await supabase.auth.getSession();
    const fromUserId = sessionData?.session?.user?.id;

    const { data: inserted, error: insertError } = await supabase
      .from('notices')
      .insert({ from_user: fromUserId, to_user: toUserId, is_super: isWave })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('notices')
          .select('id, is_super')
          .eq('from_user', fromUserId)
          .eq('to_user', toUserId)
          .maybeSingle();

        if (existing && isWave && !existing.is_super) {
          const { error: updateError } = await supabase
            .from('notices')
            .update({ is_super: true })
            .eq('id', existing.id);

          if (updateError) {
            Alert.alert('Wave not sent', updateError.message);
            return;
          }
          posthog.capture('wave_sent');
          showUndoBanner(existing.id, true, toUserId);
          return;
        }

        Alert.alert('Already sent', "You've already noticed this person.");
        return;
      }

      Alert.alert(isWave ? 'Wave not sent' : 'Notice not sent', insertError.message);
      return;
    }

    posthog.capture(isWave ? 'wave_sent' : 'notice_sent');
    showUndoBanner(inserted.id, isWave, toUserId);
  }

  function confirmWave(toUserId) {
    Alert.alert(
      'Send a Wave? 👋',
      "Unlike a regular Notice, they'll be told right away that you noticed them — before it's mutual. Free users get 1 per week.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send Wave', onPress: () => sendNotice(toUserId, true) },
      ]
    );
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function compatibilityColor(score) {
    if (score >= 70) return colors.success;
    if (score >= 40) return colors.primary;
    return colors.textTertiary;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle} accessibilityRole="header">{t('discovery.title')}</Text>
          <TouchableOpacity
            onPress={showRadiusInfo}
            style={styles.infoButton}
            accessibilityLabel="Learn how Crossed Paths works"
            accessibilityRole="button"
          >
            <Text style={styles.infoButtonText}>ⓘ</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSubtitle}>{t('discovery.subtitle')}</Text>
      </View>

      {showConfidenceBanner && <ConfidenceModeBanner onDismiss={handleDismissConfidenceBanner} />}

      {initialLoading ? (
        <View>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
      <FlatList
        data={nearby}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📍</Text>
            <Text style={styles.emptyTitle}>{t('discovery.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('discovery.emptyText')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const crossedPathsTime = formatCrossedPathsTime(item.last_seen_at);
          return (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.tappableProfileArea}
              onPress={() => navigation.navigate('ViewProfile', { userId: item.otherUserId })}
              activeOpacity={0.9}
              accessibilityLabel={`View ${item.profiles?.display_name}'s profile${onlineStatuses[item.otherUserId] ? ', online now' : ''}`}
              accessibilityRole="button"
            >
              <View>
                <Image
                  source={{ uri: photoUrls[item.id] || 'https://placehold.co/200' }}
                  style={styles.avatar}
                />
                {onlineStatuses[item.otherUserId] && <View style={styles.onlineDot} />}
              </View>
            </TouchableOpacity>
            <View style={styles.cardBody}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{item.profiles?.display_name}</Text>
                {item.compatibilityScore !== null && (
                  <TouchableOpacity
                    style={[styles.compatBadge, { borderColor: compatibilityColor(item.compatibilityScore) }]}
                    onPress={() => showCompatibilityReport(item)}
                    accessibilityLabel={`${item.compatibilityScore} percent compatible, view details`}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.compatText, { color: compatibilityColor(item.compatibilityScore) }]}>
                      {item.compatibilityScore}% · Why?
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.proximityRow}>
                <Text style={styles.proximityText}>
                  📍 Within about 35 feet{crossedPathsTime ? ` · Crossed paths ${crossedPathsTime}` : ''}
                </Text>
              </View>
              <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
              {item.sharedInterests?.length > 0 && (
                <Text style={styles.sharedText}>
                  ✨ {t('discovery.youBothLike')} {item.sharedInterests.slice(0, 3).join(', ')}
                  {item.sharedInterests.length > 3 ? ` +${item.sharedInterests.length - 3} ${t('discovery.moreCount')}` : ''}
                </Text>
              )}
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.noticeButton}
                  onPress={() => sendNotice(item.otherUserId)}
                  activeOpacity={0.85}
                  accessibilityLabel={`Send a Notice to ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.noticeButtonText}>{t('discovery.notice')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.waveButton}
                  onPress={() => confirmWave(item.otherUserId)}
                  activeOpacity={0.85}
                  accessibilityLabel={`Send a Wave to ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.waveButtonText}>👋 {t('discovery.wave')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() => setReportTarget({ id: item.otherUserId, name: item.profiles?.display_name })}
                  accessibilityLabel={`Report or block ${item.profiles?.display_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.moreButtonText}>⋯</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
        }}
      />
      )}

      {undoState && (
        <Animated.View
          style={[styles.undoBanner, { opacity: undoOpacity }]}
          accessible={true}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.undoText}>{undoState.isWave ? 'Wave' : 'Notice'} sent</Text>
          <TouchableOpacity
            onPress={handleUndo}
            accessibilityLabel={`Undo sending ${undoState.isWave ? 'Wave' : 'Notice'}`}
            accessibilityRole="button"
          >
            <Text style={styles.undoButton}>Undo</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />

      <CompatibilityReportModal
        visible={!!compatModalReport}
        onClose={() => setCompatModalReport(null)}
        report={compatModalReport}
        theirName={compatModalName}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  infoButton: { marginLeft: spacing.sm, padding: spacing.xs },
  infoButtonText: { color: colors.textTertiary, fontSize: 18 },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  tappableProfileArea: { width: '100%' },
  avatar: { width: '100%', height: 280, backgroundColor: colors.surfaceElevated },
  onlineDot: {
    position: 'absolute', top: spacing.md, right: spacing.md,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.success, borderWidth: 2.5, borderColor: colors.surface,
  },
  cardBody: { padding: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  name: { ...typography.headline, color: colors.textPrimary },
  compatBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontSize: 11, fontWeight: '700' },
  proximityRow: { marginBottom: spacing.xs },
  proximityText: { ...typography.small, color: colors.textTertiary },
  bio: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  sharedText: { color: colors.primary, fontSize: 12, fontWeight: '600', marginBottom: spacing.md },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noticeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flex: 1,
    alignItems: 'center',
  },
  noticeButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  waveButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    flex: 1,
    alignItems: 'center',
  },
  waveButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  moreButtonText: { color: colors.textTertiary, fontSize: 20, fontWeight: '700' },
  undoBanner: {
    position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.textPrimary, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  undoText: { color: colors.background, fontSize: 14, fontWeight: '600' },
  undoButton: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});