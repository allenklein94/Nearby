import React, { useState, useCallback, useRef, useEffect } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Image } from 'react-native';
import FadeInState from '../components/FadeInState';
import { NLoader, PullToRefresh } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import { getActiveOffers, getMyRedemptions, redeemOffer, followBusiness, unfollowBusiness, isFollowingBusiness, getRedemptionCounts } from '../services/brandOffers';
import { getCommunityMemberCount } from '../services/communities';
import { getApprovedAttendeeCount } from '../services/gatherings';
import LoadErrorState from '../components/LoadErrorState';
import { usePostHog } from 'posthog-react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';
import { getUserLocation } from '../services/userLocation';
import { displayDistanceAway } from '../i18n/display';

import { unlockStatus } from '../utils/unlockProgress';
export default function BrandOffersScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const { t, language } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [offers, setOffers] = useState([]);
  const [redeemedIds, setRedeemedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [redeemingId, setRedeemingId] = useState(null);
  const [followingStatus, setFollowingStatus] = useState({});
  const [redemptionCounts, setRedemptionCounts] = useState({});
  const [unlockProgress, setUnlockProgress] = useState({});

  // Optional deep-link target, e.g. from a specific offer card on Discover's
  // search results — this screen has no per-offer detail view, so we scroll
  // to and highlight the matching card in the flat list instead.
  const highlightOfferId = route?.params?.highlightOfferId ?? null;
  const scrollRef = useRef(null);
  const cardOffsets = useRef({});
  const [scrolledToHighlight, setScrolledToHighlight] = useState(false);

  const load = useCallback(async () => {
    let offersData;
    let redemptionsData;
    try {
      let myLat = null;
      let myLng = null;
      const location = await getUserLocation({ ask: false });
      if (location) {
        myLat = location.coords.latitude;
        myLng = location.coords.longitude;
      }
      [offersData, redemptionsData] = await Promise.all([getActiveOffers(myLat, myLng), getMyRedemptions()]);
      setOffers(offersData);
      setRedeemedIds(redemptionsData);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
      setLoading(false);
      return;
    }
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

  useEffect(() => {
    if (!highlightOfferId || scrolledToHighlight || loading || offers.length === 0) return;
    const timer = setTimeout(() => {
      const y = cardOffsets.current[highlightOfferId];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
      }
      setScrolledToHighlight(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [highlightOfferId, scrolledToHighlight, loading, offers]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleRedeem(offer) {
    setRedeemingId(offer.id);
    try {
      const { confirmationCode } = await redeemOffer(offer.id);
      posthog.capture('brand_offer_redeemed', { offer_id: offer.id, partner: offer.brand_partners?.name });
      Alert.alert(
        t('ui.brandOffersUi.redeemed'),
        t('ui.brandOffersUi.showStaffCode', { code: confirmationCode, instructions: offer.redemption_instructions || t('ui.brandOffersUi.checkYourAccountForDetails') }),
        [
          {
            text: t('ui.brandOffersUi.continue'),
            onPress: () => {
              // A genuine, explicit choice — not a default opt-in.
              // The business only gets access if the person actually says yes.
              Alert.alert(
                t('ui.brandOffersUi.stayConnectedWith', { name: offer.brand_partners?.name ?? t('ui.brandOffersUi.thisBusiness') }),
                t('ui.brandOffersUi.theyllBeAbleToInvite'),
                [
                  { text: t('ui.brandOffersUi.noThanks'), style: 'cancel' },
                  {
                    text: t('ui.brandOffersUi.yesStayConnected'),
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
        Alert.alert(t('ui.brandOffersUi.alreadyRedeemed'), t('ui.brandOffersUi.youveAlreadyClaimedThisOffer'));
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert(t('ui.brandOffersUi.offerFullyClaimed'), t('ui.brandOffersUi.thisOffersLimitedSpotsHave'));
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert(t('ui.brandOffersUi.notUnlockedYet'), t('ui.brandOffersUi.thisOfferNeedsMorePeople'));
      } else {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRedeem(offer) });
      }
    }
    setRedeemingId(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.brandOffersUi.findingPerksNearYou')}</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.brandOffersUi.couldntLoadPerksNearby')} onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<PullToRefresh refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle} accessibilityRole="header">{t('brandOffers.title')}</Text>
        <Text style={styles.headerSubtitle}>
          {t('brandOffers.subtitle')}
        </Text>

        {offers.length === 0 && (
          <FadeInState opportunity style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎁</Text>
            <Text style={styles.emptyText}>{t('brandOffers.noOffers')}</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Discover')}
              accessibilityLabel={t('ui.brandOffersUi.exploreWhatsHappeningNearbyA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.emptyActionText}>{t('ui.brandOffersUi.exploreWhatsNearby')}</Text>
            </TouchableOpacity>
          </FadeInState>
        )}

        {offers.map((offer) => {
          const alreadyRedeemed = redeemedIds.includes(offer.id);
          const unlock = unlockStatus(offer, unlockProgress[offer.id]);
          const isLocked = unlock?.isLocked ?? false;
          const isHighlighted = highlightOfferId === offer.id;
          return (
            <View
              key={offer.id}
              style={[styles.card, isHighlighted && styles.cardHighlighted]}
              onLayout={(e) => { cardOffsets.current[offer.id] = e.nativeEvent.layout.y; }}
            >
              <View style={styles.cardHeader}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                  onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                  accessibilityLabel={t('ui.brandOffersUi.viewSBusinessProfileA11y', { name: offer.brand_partners?.name })}
                  accessibilityRole="button"
                >
                  {offer.brand_partners?.logo_url ? (
                    <Image source={{ uri: offer.brand_partners.logo_url }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoPlaceholder]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partnerName}>{[offer.brand_partners?.name, displayDistanceAway(offer.distanceMiles, language)].filter(Boolean).join(' · ')}</Text>
                    <Text style={styles.offerTitle}>{offer.title}</Text>
                  </View>
                </TouchableOpacity>
              </View>
              {offer.description ? <Text style={styles.description}>{offer.description}</Text> : null}
              {offer.redemption_limit != null && (
                <Text style={styles.scarcityText}>
                  {t('ui.brandOffersUi.spotsLeftOf', { left: Math.max(0, offer.redemption_limit - (redemptionCounts[offer.id] ?? 0)), count: offer.redemption_limit })}
                </Text>
              )}
              {offer.unlock_scope != null && (
                <Text style={styles.scarcityText}>
                  {isLocked
                    ? unlock.label
                    : (offer.unlock_scope === 'community' ? t('ui.brandOffersUi.unlockedCommunity') : t('ui.brandOffersUi.unlockedGathering'))}
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
                    presentRecoverableError(Alert, { what: 'complete that', error: e });
                  }
                }}
                accessibilityLabel={followingStatus[offer.partner_id] ? t('ui.brandOffersUi.unfollowA11y', { name: offer.brand_partners?.name }) : t('ui.brandOffersUi.followA11y', { name: offer.brand_partners?.name })}
                accessibilityRole="button"
              >
                <Text style={styles.followLinkText}>
                  {followingStatus[offer.partner_id] ? t('ui.brandOffersUi.following') : t('ui.brandOffersUi.follow')}
                </Text>
              </TouchableOpacity>
              {alreadyRedeemed ? (
                <View style={styles.redeemedBadge}>
                  <Text style={styles.redeemedBadgeText}>{t('brandOffers.redeemed')}</Text>
                </View>
              ) : isLocked ? (
                <View style={[styles.redeemButton, styles.lockedButton]}>
                  <Text style={styles.lockedButtonText}>{t('ui.brandOffersUi.locked')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.redeemButton}
                  onPress={() => handleRedeem(offer)}
                  disabled={redeemingId === offer.id}
                  activeOpacity={0.85}
                  accessibilityLabel={t('ui.brandOffersUi.fromA11y', { value: t('brandOffers.redeem'), title: offer.title, name: offer.brand_partners?.name })}
                  accessibilityRole="button"
                >
                  <Text style={styles.redeemButtonText}>{redeemingId === offer.id ? t('ui.brandOffersUi.redeeming') : t('brandOffers.redeem')}</Text>
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
  emptyActionText: { ...typography.body, color: colors.primary, fontWeight: '700', marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  cardHighlighted: { borderColor: colors.primary, borderWidth: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  logo: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: colors.surfaceElevated },
  logoPlaceholder: {},
  partnerName: { ...typography.caption, color: colors.textTertiary },
  offerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  scarcityText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, marginBottom: spacing.sm },
  followLinkText: { color: colors.primary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  redeemButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  redeemedBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  redeemedBadgeText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  lockedButton: { backgroundColor: colors.surfaceElevated },
  lockedButtonText: { color: colors.textTertiary, fontWeight: '700', fontSize: 14 },
});