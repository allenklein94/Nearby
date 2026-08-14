import React, { useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBusinessProfile,
  getBusinessFollowerCount,
  getBusinessPublicGatherings,
  getBusinessActiveOffers,
  isFollowingBusiness,
  followBusiness,
  unfollowBusiness,
  getRedemptionCounts,
  redeemOffer,
} from '../services/brandOffers';
import { getBusinessLovedTags, getBusinessReputation, getSignedGatheringPhotoUrl, getApprovedAttendeeCount } from '../services/gatherings';
import { getCommunityMemberCount } from '../services/communities';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function BusinessProfileScreen({ route, navigation }) {
  const { partnerId } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [gatherings, setGatherings] = useState([]);
  const [offers, setOffers] = useState([]);
  const [redemptionCounts, setRedemptionCounts] = useState({});
  const [unlockProgress, setUnlockProgress] = useState({});
  const [redeemingId, setRedeemingId] = useState(null);
  const [lovedTags, setLovedTags] = useState([]);
  const [reputation, setReputation] = useState(null);
  const [photoUrls, setPhotoUrls] = useState([]);

  const load = useCallback(async () => {
    try {
      const [profile, count, isFollowing, upcomingGatherings, activeOffers, tags, rep] = await Promise.all([
        getBusinessProfile(partnerId),
        getBusinessFollowerCount(partnerId),
        isFollowingBusiness(partnerId),
        getBusinessPublicGatherings(partnerId),
        getBusinessActiveOffers(partnerId),
        getBusinessLovedTags(partnerId),
        getBusinessReputation(partnerId),
      ]);

      setPartner(profile);
      setFollowerCount(count);
      setFollowing(isFollowing);
      setGatherings(upcomingGatherings);
      setOffers(activeOffers);
      setLovedTags(tags);
      setReputation(rep);
      setLoadError(false);

      if (activeOffers.length > 0) {
        getRedemptionCounts(activeOffers.map((o) => o.id)).then(setRedemptionCounts);
      }

      const lockedOffers = activeOffers.filter((o) => o.unlock_scope != null);
      if (lockedOffers.length > 0) {
        Promise.all(
          lockedOffers.map(async (o) => [
            o.id,
            o.unlock_scope === 'community' ? await getCommunityMemberCount(o.unlock_community_id) : await getApprovedAttendeeCount(o.gathering_id),
          ])
        ).then((entries) => setUnlockProgress(Object.fromEntries(entries)));
      }

      const withCovers = upcomingGatherings.filter((g) => g.cover_photo_path).slice(0, 6);
      if (withCovers.length > 0) {
        Promise.all(withCovers.map((g) => getSignedGatheringPhotoUrl(g.cover_photo_path))).then((urls) =>
          setPhotoUrls(urls.filter(Boolean))
        );
      }
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleToggleFollow() {
    try {
      if (following) {
        await unfollowBusiness(partnerId);
        setFollowerCount((c) => Math.max(0, c - 1));
      } else {
        await followBusiness(partnerId);
        setFollowerCount((c) => c + 1);
      }
      setFollowing(!following);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleRedeem(offer) {
    setRedeemingId(offer.id);
    try {
      const { confirmationCode } = await redeemOffer(offer.id);
      setRedemptionCounts((prev) => ({ ...prev, [offer.id]: (prev[offer.id] ?? 0) + 1 }));
      Alert.alert('Redeemed!', `Show staff at ${partner?.name} this code to confirm: ${confirmationCode}`);
    } catch (e) {
      if (e.message === 'ALREADY_REDEEMED') {
        Alert.alert("You've already redeemed this");
      } else if (e.message === 'REDEMPTION_LIMIT_REACHED') {
        Alert.alert('Sorry, this offer is fully claimed');
      } else if (e.message === 'OFFER_LOCKED') {
        Alert.alert('Not unlocked yet', 'This offer needs more people to join first — check back soon.');
      } else {
        Alert.alert('Error', e.message);
      }
    } finally {
      setRedeemingId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  if (loadError || !partner) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this business." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={styles.headerRow}>
          {partner.logo_url ? (
            <Image source={{ uri: partner.logo_url }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoPlaceholder]}>
              <Text style={styles.logoPlaceholderText}>🏪</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{partner.name}</Text>
            <Text style={styles.meta}>
              {followerCount} follower{followerCount === 1 ? '' : 's'}
              {partner.address ? ` · ${partner.address}` : ''}
            </Text>
          </View>
        </View>

        {partner.description ? <Text style={styles.description}>{partner.description}</Text> : null}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.followButton, following && styles.followingButton]}
            onPress={handleToggleFollow}
            activeOpacity={0.85}
            accessibilityLabel={following ? `Unfollow ${partner.name}` : `Follow ${partner.name}`}
            accessibilityRole="button"
          >
            <Text style={[styles.followButtonText, following && styles.followingButtonText]}>
              {following ? '✓ Following' : '+ Follow'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => navigation.navigate('BusinessConversation', { partnerId, partnerName: partner.name })}
            activeOpacity={0.85}
            accessibilityLabel={`Message ${partner.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.messageButtonText}>💬 Message</Text>
          </TouchableOpacity>
        </View>

        {reputation && reputation.feedbackCount > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>What People Say</Text>
            {reputation.welcomingPct != null && reputation.wouldReturnPct != null && (
              <Text style={styles.repLine}>
                ⭐ {reputation.welcomingPct}% said welcoming · {reputation.wouldReturnPct}% would attend again ({reputation.feedbackCount} review{reputation.feedbackCount === 1 ? '' : 's'})
              </Text>
            )}
            {lovedTags.length > 0 && <Text style={styles.repLine}>💛 What people loved: {lovedTags.join(' · ')}</Text>}
          </View>
        )}

        {photoUrls.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {photoUrls.map((url, i) => (
                <Image key={i} source={{ uri: url }} style={styles.photo} />
              ))}
            </ScrollView>
          </View>
        )}

        {offers.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Perks</Text>
            {offers.map((offer) => {
              const isLocked = offer.unlock_scope != null && (unlockProgress[offer.id] ?? 0) < offer.unlock_min_members;
              return (
                <View key={offer.id} style={styles.offerCard}>
                  <Text style={styles.offerTitle}>{offer.title}</Text>
                  {offer.description ? <Text style={styles.offerDesc}>{offer.description}</Text> : null}
                  {offer.redemption_limit != null && (
                    <Text style={styles.scarcityText}>
                      {Math.max(0, offer.redemption_limit - (redemptionCounts[offer.id] ?? 0))} of {offer.redemption_limit} spots left
                    </Text>
                  )}
                  {offer.unlock_scope != null && (
                    <Text style={styles.scarcityText}>
                      {isLocked
                        ? `🔒 Unlocks at ${offer.unlock_min_members} ${offer.unlock_scope === 'community' ? 'community members' : 'attendees'} (${unlockProgress[offer.id] ?? 0}/${offer.unlock_min_members} so far)`
                        : '🔓 Unlocked'}
                    </Text>
                  )}
                  {isLocked ? (
                    <View style={[styles.redeemButton, styles.lockedButton]}>
                      <Text style={styles.lockedButtonText}>Locked</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.redeemButton}
                      onPress={() => handleRedeem(offer)}
                      disabled={redeemingId === offer.id}
                      activeOpacity={0.85}
                      accessibilityLabel={`Redeem ${offer.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.redeemButtonText}>{redeemingId === offer.id ? 'Redeeming...' : 'Redeem'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {gatherings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Upcoming Gatherings</Text>
            {gatherings.map((g) => {
              const categoryStyle = categoryStyleFor(g.interest_tag);
              return (
                <TouchableOpacity
                  key={g.id}
                  style={styles.gatheringCard}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`View ${g.title}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.gatheringIcon}>{categoryStyle.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gatheringTitle}>{g.title}</Text>
                    <Text style={styles.gatheringMeta}>{formatDate(g.scheduled_at)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  logo: { width: 64, height: 64, borderRadius: radius.lg, marginRight: spacing.md },
  logoPlaceholder: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  logoPlaceholderText: { fontSize: 28 },
  title: { ...typography.title, color: colors.textPrimary },
  meta: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  followButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', ...shadow.button },
  followingButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  followingButtonText: { color: colors.textSecondary },
  messageButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  messageButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  section: { marginBottom: spacing.lg },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  repLine: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs },
  photo: { width: 140, height: 100, borderRadius: radius.md, marginRight: spacing.sm },
  offerCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  offerTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  offerDesc: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  scarcityText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.xs },
  redeemButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  redeemButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  lockedButton: { backgroundColor: colors.surfaceElevated },
  lockedButtonText: { color: colors.textTertiary, fontWeight: '700', fontSize: 13 },
  gatheringCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  gatheringIcon: { fontSize: 22, marginRight: spacing.sm },
  gatheringTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  gatheringMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
});
