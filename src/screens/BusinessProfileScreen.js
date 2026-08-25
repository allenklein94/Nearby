import React, { useState, useCallback, useRef } from 'react';
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
  getMyManagedPartner,
  logBusinessProfileView,
  getBusinessExperiences,
} from '../services/brandOffers';
import { getBusinessLovedTags, getBusinessReputation, getSignedGatheringPhotoUrl, getApprovedAttendeeCount } from '../services/gatherings';
import { getCommunityMemberCount } from '../services/communities';
import { getPartnerAvgResponseTime, getPartnerOfferReputation, formatPartnerReliabilityLine } from '../services/businessFulfillment';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { businessAttributeLabel, cuisineLabel, availabilityPulseLabel, availabilityPulseIcon, isAvailabilityPulseFresh, experiencePriceLabel, experiencePartyTypeLabel } from '../constants/businessAttributes';
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
  // 10/10 roadmap Part 5 (see CLAUDE.md's "10/10 roadmap" plan) -- the
  // business-fulfillment request/offer reliability line, distinct from
  // `reputation` above (which is the gathering-hosting welcoming/would-
  // attend-again reputation, a different signal entirely).
  const [fulfillmentReputation, setFulfillmentReputation] = useState(null);
  const [fulfillmentResponseTime, setFulfillmentResponseTime] = useState(null);
  // "Business Story" plan, Phase 6 -- Signature Experiences.
  const [experiences, setExperiences] = useState([]);
  // Business Partner acquisition experience, Milestone 4 (see CLAUDE.md): log at most one real
  // view per screen visit (this ref is scoped to this one mounted instance -- a fresh push of
  // this screen is a fresh instance, a re-focus of the same instance, e.g. returning from
  // BusinessConversation, is not a second view), and never for the business's own owner
  // previewing their own profile -- that's not real discovery signal.
  const hasLoggedView = useRef(false);

  const load = useCallback(async () => {
    try {
      const [profile, count, isFollowing, upcomingGatherings, activeOffers, tags, rep, fulfillRep, fulfillResponseTime, myPartner, signatureExperiences] = await Promise.all([
        getBusinessProfile(partnerId),
        getBusinessFollowerCount(partnerId),
        isFollowingBusiness(partnerId),
        getBusinessPublicGatherings(partnerId),
        getBusinessActiveOffers(partnerId),
        getBusinessLovedTags(partnerId),
        getBusinessReputation(partnerId),
        getPartnerOfferReputation(partnerId),
        getPartnerAvgResponseTime(partnerId),
        getMyManagedPartner(),
        // "Business Story" plan, Phase 6 -- real RLS already filters this
        // to active experiences only for a non-owner viewer (see
        // getBusinessExperiences' own comment).
        getBusinessExperiences(partnerId),
      ]);

      if (!hasLoggedView.current && myPartner?.id !== partnerId) {
        hasLoggedView.current = true;
        logBusinessProfileView(partnerId, route.params?.source === 'deep_link' ? 'deep_link' : 'in_app');
      }

      setPartner(profile);
      setFollowerCount(count);
      setFollowing(isFollowing);
      setGatherings(upcomingGatherings);
      setOffers(activeOffers);
      setLovedTags(tags);
      setReputation(rep);
      setFulfillmentReputation(fulfillRep);
      setFulfillmentResponseTime(fulfillResponseTime);
      // Filtered client-side too, on top of RLS -- so the business's own
      // owner previewing "View Public Profile" always sees exactly what a
      // real stranger would see, never an inactive experience they've
      // hidden (RLS alone would show it to them since they're the owner).
      setExperiences((signatureExperiences ?? []).filter((e) => e.active));
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

        {formatPartnerReliabilityLine(fulfillmentReputation, fulfillmentResponseTime) && (
          <Text style={styles.reliabilityLine}>{formatPartnerReliabilityLine(fulfillmentReputation, fulfillmentResponseTime)}</Text>
        )}

        {/* "Business Story" plan, Phase 3 -- a real, self-reported
            "how's business right now" signal, hidden once stale so it
            never reads as real-time when it isn't (see CLAUDE.md). */}
        {partner.availability_pulse && isAvailabilityPulseFresh(partner.availability_pulse_updated_at) && (
          <Text style={styles.reliabilityLine}>
            {availabilityPulseIcon(partner.availability_pulse)} {availabilityPulseLabel(partner.availability_pulse)}
            {partner.availability_pulse_note ? ` — ${partner.availability_pulse_note}` : ''}
          </Text>
        )}

        {partner.description ? <Text style={styles.description}>{partner.description}</Text> : null}

        {/* Phase 1 -- Business DNA: the owner's own real, free-text "what
            makes you different" line. */}
        {partner.differentiator ? (
          <Text style={[styles.description, { fontStyle: 'italic' }]}>"{partner.differentiator}"</Text>
        ) : null}

        {((partner.attributes ?? []).length > 0 || partner.cuisine) && (
          <>
            <Text style={styles.attributeSectionHeader}>Why People Choose Us</Text>
            <View style={styles.attributeChipRow}>
              {partner.cuisine && (
                <View style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{cuisineLabel(partner.cuisine)}</Text>
                </View>
              )}
              {(partner.attributes ?? []).map((key) => (
                <View key={key} style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{businessAttributeLabel(key)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

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

        {/* Convergence pass P1 (CLAUDE.md, "Make a Plan / Business = The
            Grove") -- the real new entry point for planning something at a
            specific business that has no live standing offer right now.
            When a real active offer does exist, that offer's own row on
            the Perks section below already gets its own "Make a plan"
            treatment in the resolver-driven flow (Home's perk
            recommendation) -- this button is the honest general case,
            reachable regardless of whether a perk happens to be live. */}
        <TouchableOpacity
          style={styles.planHereButton}
          onPress={() => navigation.navigate('MakeAPlan', { partnerId })}
          activeOpacity={0.85}
          accessibilityLabel={`Make a plan at ${partner.name}`}
          accessibilityRole="button"
        >
          <Text style={styles.planHereButtonText}>📅 Make a Plan Here</Text>
        </TouchableOpacity>

        {/* "Business Story" plan, Phase 6 -- the actual consumer-facing
            payoff: real, curated things this business can be come to for,
            not a generic offer or a plain description. */}
        {experiences.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Signature Experiences</Text>
            {experiences.map((exp) => (
              <View key={exp.id} style={styles.experienceCard}>
                <Text style={styles.experienceTitle}>
                  {exp.icon ? `${exp.icon} ` : ''}{exp.title}
                </Text>
                {exp.description ? <Text style={styles.experienceDescription}>{exp.description}</Text> : null}
                {(exp.price_level || exp.party_type) && (
                  <Text style={styles.experienceMeta}>
                    {[
                      exp.price_level ? experiencePriceLabel(exp.price_level) : null,
                      exp.party_type ? experiencePartyTypeLabel(exp.party_type) : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

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
  reliabilityLine: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  attributeSectionHeader: { ...typography.small, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  attributeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.lg },
  attributeChip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border },
  attributeChipText: { ...typography.small, color: colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  followButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', ...shadow.button },
  followingButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  followingButtonText: { color: colors.textSecondary },
  messageButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  messageButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  planHereButton: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg, backgroundColor: colors.surface,
  },
  planHereButtonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  section: { marginBottom: spacing.lg },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  repLine: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.xs },
  photo: { width: 140, height: 100, borderRadius: radius.md, marginRight: spacing.sm },
  offerCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  offerTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  offerDesc: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  experienceCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  experienceTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  experienceDescription: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  experienceMeta: { color: colors.textTertiary, fontSize: 12, fontWeight: '600', marginTop: spacing.xs },
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
