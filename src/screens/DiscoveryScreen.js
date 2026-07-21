import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert } from 'react-native';
import { getNearbyMatches, reportPresence } from '../services/proximity';
import { supabase } from '../services/supabase';
import { getSignedPhotoUrl } from '../services/photos';
import ReportBlockModal from '../components/ReportBlockModal';
import SkeletonCard from '../components/SkeletonCard';
import { usePostHog } from 'posthog-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function showRadiusInfo() {
    Alert.alert(t('discovery.radiusInfoTitle'), t('discovery.radiusInfoText'), [{ text: 'OK' }]);
  }

  async function sendNotice(toUserId, isWave = false) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data: sessionData } = await supabase.auth.getSession();
    const fromUserId = sessionData?.session?.user?.id;

    const { error: insertError } = await supabase
      .from('notices')
      .insert({ from_user: fromUserId, to_user: toUserId, is_super: isWave });

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
          Alert.alert('Wave sent! 👋', "They'll be notified right away.");
          return;
        }

        Alert.alert('Already sent', "You've already noticed this person.");
        return;
      }

      Alert.alert(isWave ? 'Wave not sent' : 'Notice not sent', insertError.message);
      return;
    }

    posthog.capture(isWave ? 'wave_sent' : 'notice_sent');
    if (isWave) {
      Alert.alert('Wave sent! 👋', "They'll be notified right away.");
    }
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{t('discovery.title')}</Text>
          <TouchableOpacity onPress={showRadiusInfo} style={styles.infoButton}>
            <Text style={styles.infoButtonText}>ⓘ</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerSubtitle}>{t('discovery.subtitle')}</Text>
      </View>

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
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Image
                source={{ uri: photoUrls[item.id] || 'https://placehold.co/100' }}
                style={styles.avatar}
              />
              <View style={styles.cardInfo}>
                <Text style={styles.name}>{item.profiles?.display_name}</Text>
                <Text style={styles.bio} numberOfLines={2}>{item.profiles?.bio}</Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.noticeButton} onPress={() => sendNotice(item.otherUserId)} activeOpacity={0.85}>
                  <Text style={styles.noticeButtonText}>{t('discovery.notice')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.waveButton} onPress={() => confirmWave(item.otherUserId)} activeOpacity={0.85}>
                  <Text style={styles.waveButtonText}>👋 {t('discovery.wave')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() => setReportTarget({ id: item.otherUserId, name: item.profiles?.display_name })}
                >
                  <Text style={styles.moreButtonText}>⋯</Text>
                </TouchableOpacity>
              </View>
            </View>
            {item.sharedInterests?.length > 0 && (
              <View style={styles.sharedRow}>
                <Text style={styles.sharedText}>
                  ✨ You both like {item.sharedInterests.slice(0, 3).join(', ')}
                  {item.sharedInterests.length > 3 ? ` +${item.sharedInterests.length - 3} more` : ''}
                </Text>
              </View>
            )}
          </View>
        )}
      />
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
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 60, height: 60, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  cardInfo: { flex: 1 },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  bio: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardActions: { alignItems: 'center', gap: spacing.xs },
  noticeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  waveButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  waveButtonText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  moreButtonText: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
  sharedRow: {
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  sharedText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
});