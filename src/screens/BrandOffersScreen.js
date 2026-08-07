import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image, RefreshControl } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { getActiveOffers, getMyRedemptions, redeemOffer, followBusiness, unfollowBusiness, isFollowingBusiness, getRedemptionCounts } from '../services/brandOffers';
import { getCommunityMemberCount } from '../services/communities';
import { getApprovedAttendeeCount } from '../services/gatherings';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

export default function BrandOffersScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [offers, setOffers] = useState([]);
  const [redeemedIds, setRedeemedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [redeemingId, setRedeemingId] = useState(null);
  const [followingStatus, setFollowingStatus] = useState({});
  const [redemptionCounts, setRedemptionCounts] = useState({});
  const [unlockProgress, setUnlockProgress] = useState({});

  const load = useCallback(async () => {
    let myLat = null;
    let myLng = null;
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (location) {
        myLat = location.coords.latitude;
        myLng = location.coords.longitude;
      }
    }
    const [offersData, redemptionsData] = await Promise.all([getActiveOffers(myLat, myLng), getMyRedemptions()]);
    setOffers(offersData);
    setRedeemedIds(redemptionsData);
    setLoading(false);
    const uniquePartnerIds = [...new Set(offersData.map((o) => o.partner_id))];
    const followEntries = await Promise.all(
      uniquePartnerIds.map(async (id) => [id, await isFollowingBusiness(id)])
    );
    setFollowingStatus(Object.fromEntries(followEntries));
    const limitedOfferIds = offersData.filter((o) => o.redemption_limit != null).map((o) => o.id);
    const counts = await getRedemptionCounts(limitedOfferIds);
    setRedemptionCounts(counts);

    const lockedOffers = offersData.filter((o) => o.unlock_scope != null);
    const progressEntries = await Promise.all(
      lockedOffers.map(async (o) => [
        o.id,
        o.unlock_scope === 'community' ? await getCommunityMemberCount(o.unlock_community_id) : await getApprovedAttendeeCount(o.gathering_id),
      ])
    );
    setUnlockProgress(Object.fromEntries(progressEntries));
  }, []);

  // Reload on focus, not just mount — offers can change (new ones
  // added, others expiring) between visits to this screen.
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

  async function handleRedeem(offer) {
    setRedeemingId(offer.id);
    try {
      await redeemOffer(offer.id);
      posthog.capture('brand_offer_redeemed', { offer_id: offer.id, partner: offer.brand_partners?.name });
      Alert.alert(
        'Redeemed!',
        offer.redemption_instructions || 'Check your account for details on how to use this.',
        [
          {
            text: 'Continue',
            onPress: () => {
              // A genuine, explicit choice — not a default opt-in.
              // The business only gets access if the person actually says yes.
              Alert.alert(
                `Stay connected with ${offer.brand_partners?.name ?? 'this business'}?`,
                "They'll be able to invite you to future events and offers.",
                [
                  { text: 'No thanks', style: 'cancel' },
                  {
                    text: 'Yes, stay connected',
                    onPress: () => followBusiness(offer.partner_id).catch(() => {}),
                  },
                ]
              );
            },
          },
        ]
      );
      load();
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert('Already redeemed', "You've already claimed this offer.");
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert('Offer fully claimed', "This offer's limited spots have all been claimed.");
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert('Not unlocked yet', "This offer needs more people to join first — check back soon.");
      } else {
        Alert.alert('Error', e.message);
      }
    }
    setRedeemingId(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('brandOffers.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('brandOffers.subtitle')}
        </Text>

        {offers.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎁</Text>
            <Text style={styles.emptyText}>{t('brandOffers.noOffers')}</Text>
          </View>
        )}

        {offers.map((offer) => {
          const alreadyRedeemed = redeemedIds.includes(offer.id);
          const isLocked = offer.unlock_scope != null && (unlockProgress[offer.id] ?? 0) < offer.unlock_min_members;
          return (
            <View key={offer.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                  onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                  accessibilityLabel={`View ${offer.brand_partners?.name}'s business profile`}
                  accessibilityRole="button"
                >
                  {offer.brand_partners?.logo_url ? (
                    <Image source={{ uri: offer.brand_partners.logo_url }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partnerName}>{offer.brand_partners?.name}</Text>
                    <Text style={styles.offerTitle}>{offer.title}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate('BusinessConversation', { partnerId: offer.partner_id, partnerName: offer.brand_partners?.name })}
                  accessibilityLabel={`Message ${offer.brand_partners?.name}`}
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 20 }}>💬</Text>
                </TouchableOpacity>
              </View>
              {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}
              {offer.redemption_limit != null && (
                <Text style={styles.scarcityText}>
                  {Math.max(0, offer.redemption_limit - (redemptionCounts[offer.id] ?? 0))} of {offer.redemption_limit} spots left
                </Text>
              )}
              {offer.unlock_scope != null && (
                <Text style={styles.scarcityText}>
                  {isLocked
                    ? `🔒 Unlocks at ${offer.unlock_min_members} ${offer.unlock_scope === 'community' ? 'community members' : 'attendees'} (${unlockProgress[offer.id] ?? 0}/${offer.unlock_min_members} so far)`
                    : `🔓 Unlocked — ${offer.unlock_scope === 'community' ? 'community' : 'gathering'} goal reached`}
                </Text>
              )}
              <TouchableOpacity
                onPress={async () => {
                  const currentlyFollowing = followingStatus[offer.partner_id];
                  try {
                    if (currentlyFollowing) {
                      await unfollowBusiness(offer.partner_id);
                    } else {
                      await followBusiness(offer.partner_id);
                    }
                    setFollowingStatus((prev) => ({ ...prev, [offer.partner_id]: !currentlyFollowing }));
                  } catch (e) {
                    Alert.alert('Error', e.message);
                  }
                }}
                accessibilityLabel={followingStatus[offer.partner_id] ? `Unfollow ${offer.brand_partners?.name}` : `Follow ${offer.brand_partners?.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.followLinkText}>
                  {followingStatus[offer.partner_id] ? '✓ Following' : '+ Follow'}
                </Text>
              </TouchableOpacity>
              {alreadyRedeemed ? (
                <View style={styles.redeemedBadge}>
                  <Text style={styles.redeemedBadgeText}>{t('brandOffers.redeemed')}</Text>
                </View>
              ) : isLocked ? (
                <View style={[styles.redeemButton, styles.lockedButton]}>
                  <Text style={styles.lockedButtonText}>Locked</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.redeemButton}
                  onPress={() => handleRedeem(offer)}
                  disabled={redeemingId === offer.id}
                  activeOpacity={0.85}
                  accessibilityLabel={`${t('brandOffers.redeem')}: ${offer.title}, from ${offer.brand_partners?.name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.redeemButtonText}>{redeemingId === offer.id ? 'Redeeming...' : t('brandOffers.redeem')}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  logo: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  logoPlaceholder: {},
  partnerName: { ...typography.caption, color: colors.textTertiary },
  offerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  scarcityText: { color: colors.primary, fontWeight: '700', fontSize: 12, marginBottom: spacing.sm },
  followLinkText: { color: colors.primary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  redeemButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  redeemedBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  redeemedBadgeText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  lockedButton: { backgroundColor: colors.surfaceElevated },
  lockedButtonText: { color: colors.textTertiary, fontWeight: '700', fontSize: 14 },
});