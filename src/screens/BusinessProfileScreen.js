import React, { useState, useEffect, useCallback, useRef } from 'react';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator, Alert, Linking } from 'react-native';
import { NLoader } from '../motion';
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
  getBusinessMessagesPage,
} from '../services/brandOffers';
import { getBusinessLovedTags, getBusinessReputation, getSignedGatheringPhotoUrl, getApprovedAttendeeCount } from '../services/gatherings';
import { getCommunityMemberCount } from '../services/communities';
import { businessHoursLabel, weekHoursLines } from '../utils/operatingStatus';
import { businessPrimaryAction } from '../utils/primaryAction';
import { bookingModeOf, bookingModeOption, LEGACY_RESERVATION_ATTRIBUTE } from '../constants/bookingMode';
import { maxGroupLine } from '../constants/businessCapabilities';
import { businessActionRoute } from '../utils/businessAction';
import { getPartnerAvgResponseTime, getPartnerOfferReputation, formatPartnerReliabilityLine, getSignedBusinessOfferMediaUrl } from '../services/businessFulfillment';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { businessAttributeLabel, cuisineLabel, availabilityPulseLabel, availabilityPulseIcon, isAvailabilityPulseFresh, experiencePriceLabel, experiencePartyTypeLabel } from '../constants/businessAttributes';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { formatDateTime } from '../utils/timeLabels';
import { spacing, radius, typography } from '../theme';

import { unlockStatus } from '../utils/unlockProgress';
import { thingsToDoHere } from '../constants/activityLayer';
import { ageRangeLabel } from '../utils/suitedAges';
function formatDate(iso) {
  return formatDateTime(iso);
}

// Phase 4 (media upload, CLAUDE.md) -- a Signature Experience's own real
// uploaded creative, rendered INSIDE its existing experience card, never
// as a standalone card. Video shown as an honest label, not a fabricated
// inline player -- no video player component exists elsewhere in this
// codebase to mirror.
function ExperienceMediaPreview({ path, type, colors }) {
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (path) {
      getSignedBusinessOfferMediaUrl(path).then((url) => {
        if (!cancelled) setSignedUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  if (type === 'video') {
    return <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>🎬 Video attached</Text>;
  }
  if (!signedUrl) return null;
  return (
    <Image
      source={{ uri: signedUrl }}
      style={{ width: '100%', height: 140, borderRadius: radius.md, marginTop: spacing.xs }}
      resizeMode="cover"
    />
  );
}

export default function BusinessProfileScreen({ route, navigation }) {
  const { partnerId } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [partner, setPartner] = useState(null);
  const thingsToDo = partner ? thingsToDoHere(partner) : [];
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
  // An existing thread stays reachable (a business may have replied); starting one is no longer offered here.
  const [hasThread, setHasThread] = useState(false);
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
      getBusinessMessagesPage(partnerId, null, { limit: 1 }).then((rows) => setHasThread(rows.length > 0)).catch(() => {});

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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleToggleFollow() });
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
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleRedeem(offer) });
      }
    } finally {
      setRedeemingId(null);
    }
  }

  // Item 72: the booking CTA. Go now / directions open maps; Reserve / Book / Request open the request addressed to just this
  // business, whose accepted offer is the booking.
  function runBookingAction(action) {
    const route = businessActionRoute(action, { partner, partnerId, prefill: { prefillCategory: partner?.subcategory ?? null } });
    if (route?.kind === 'url') {
      if (route.url) Linking.openURL(route.url);
    } else if (route) {
      navigation.navigate(route.screen, route.params);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
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

  const bookingAction = businessPrimaryAction(partner);

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

        {/* Hours (item 71): only what the owner declared, read by the one open-now resolver; nothing when not declared. */}
        {weekHoursLines(partner.operating_hours) && (
          <View style={{ marginBottom: 6 }}>
            {businessHoursLabel(partner) ? (
              <Text style={styles.reliabilityLine}>🕒 {businessHoursLabel(partner)}</Text>
            ) : null}
            {weekHoursLines(partner.operating_hours).map((l) => (
              <Text key={l.day} style={styles.reliabilityLine}>{l.day}  {l.text}</Text>
            ))}
          </View>
        )}
        {/* Booking mode (item 72): how you come in, as the owner declared it; nothing when not declared. */}
        {bookingModeOption(bookingModeOf(partner)) && (
          <Text style={styles.reliabilityLine}>
            {bookingModeOption(bookingModeOf(partner)).icon} {bookingModeOption(bookingModeOf(partner)).customerLine}
          </Text>
        )}
        {/* Item 80: the largest group the owner said they can host (total people); hidden when not set, never guessed. */}
        {maxGroupLine(partner.max_group_size) && (
          <Text style={styles.reliabilityLine} accessibilityLabel={`Largest group, ${maxGroupLine(partner.max_group_size)}`}>
            👥 Largest group · {maxGroupLine(partner.max_group_size)}
          </Text>
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

        {/* Intent engine vision, multi-classification businesses (resumed
            2026-09-10) -- the business's own secondary, cross-major
            self-classification (brand_partners.categories), so a real
            consumer sees the same "also" identity the resolver itself now
            scores (secondaryCategoryBonus, intentResolverScoring.js). */}
        {(partner.categories ?? []).length > 0 && (
          <Text style={styles.meta}>Also: {partner.categories.join(', ')}</Text>
        )}

        {partner.description ? <Text style={styles.description}>{partner.description}</Text> : null}

        {/* Phase 1 -- Business DNA: the owner's own real, free-text "what
            makes you different" line. */}
        {partner.differentiator ? (
          <Text style={[styles.description, { fontStyle: 'italic' }]}>"{partner.differentiator}"</Text>
        ) : null}

        {/* "What you can do here" (owner item 38): derived ONLY from what the business declared (activityLayer.js), so it
            never claims something the owner did not say; hidden when nothing is supported. */}
        {thingsToDo.length > 0 && (
          <>
            <Text style={styles.attributeSectionHeader}>What You Can Do Here</Text>
            <View style={styles.attributeChipRow}>
              {thingsToDo.map((a) => (
                <View key={a.key} style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{a.icon} {a.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {!!ageRangeLabel(partner.suited_age_min, partner.suited_age_max) && (
          <Text style={styles.attributeSectionHeader}>🧒 {ageRangeLabel(partner.suited_age_min, partner.suited_age_max)}</Text>
        )}

        {((partner.attributes ?? []).some((key) => key !== LEGACY_RESERVATION_ATTRIBUTE) || partner.cuisine) && (
          <>
            <Text style={styles.attributeSectionHeader}>Why People Choose Us</Text>
            <View style={styles.attributeChipRow}>
              {partner.cuisine && (
                <View style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{cuisineLabel(partner.cuisine)}</Text>
                </View>
              )}
              {(partner.attributes ?? []).filter((key) => key !== LEGACY_RESERVATION_ATTRIBUTE).map((key) => (
                <View key={key} style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{businessAttributeLabel(key)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* "Business Profile Phase 1" addendum (CLAUDE.md) -- the public
            half of "What You Can Accommodate." Deliberately shows only
            accommodates_party_types here, not outdoor_seating too -- that
            already renders one section up, in "Why People Choose Us,"
            and repeating it here would just be visual duplication on a
            screen a real consumer actually sees. Group size stays
            owner-dashboard-only (business_fulfillment_policies is
            deliberately owner-only-SELECT, not something this pass
            widens). */}
        {(partner.accommodates_party_types ?? []).length > 0 && (
          <>
            <Text style={styles.attributeSectionHeader}>What This Business Can Accommodate</Text>
            <View style={styles.attributeChipRow}>
              {partner.accommodates_party_types.map((key) => (
                <View key={key} style={styles.attributeChip}>
                  <Text style={styles.attributeChipText}>{experiencePartyTypeLabel(key)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Convergence pass P1 (CLAUDE.md, "Make a Plan / Business = The
            Grove") -- the real new entry point for planning something at a
            specific business that has no live standing offer right now.
            When a real active offer does exist, that offer's own row on
            the Perks section below already gets its own "Make a plan"
            treatment in the resolver-driven flow (Home's perk
            recommendation) -- this button is the honest general case,
            reachable regardless of whether a perk happens to be live.
            Item 37 (context-aware primary CTA): "Plan Here" is the real
            primary action on a business profile -- coral -- not "Follow",
            which is a passive subscribe action and stays secondary below. */}
        {/* Item 72: when the owner declared how customers come in, the primary CTA follows it (Go now / Reserve / Book /
            Request, utils/primaryAction.js businessPrimaryAction); otherwise "Plan Here" stays the primary. */}
        {bookingAction ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity
              style={[styles.planHereButton, { flex: 1 }]}
              onPress={() => runBookingAction(bookingAction)}
              activeOpacity={0.85}
              accessibilityLabel={`${bookingAction.label}, ${partner.name}`}
              accessibilityRole="button"
            >
              <Text style={styles.planHereButtonText}>{bookingAction.label}</Text>
            </TouchableOpacity>
            {bookingAction.secondary ? (
              <TouchableOpacity
                style={[styles.messageButton, { flex: 0, paddingHorizontal: spacing.lg, justifyContent: 'center' }]}
                onPress={() => runBookingAction(bookingAction.secondary)}
                activeOpacity={0.85}
                accessibilityLabel={`${bookingAction.secondary.label}, ${partner.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.messageButtonText}>{bookingAction.secondary.label}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <TouchableOpacity
            style={styles.planHereButton}
            onPress={() => navigation.navigate('MakeAPlan', { partnerId })}
            activeOpacity={0.85}
            accessibilityLabel={`Plan something at ${partner.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.planHereButtonText}>📅 Plan Here</Text>
          </TouchableOpacity>
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
          {/* Nearby does the arranging: the person says what they want and Nearby finds businesses (this one included)
              that can do it, instead of opening a chat to negotiate one-on-one. */}
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => navigation.navigate('AskBusiness', { prefillCategory: partner.subcategory ?? null })}
            activeOpacity={0.85}
            accessibilityLabel="Ask Nearby to set something up like this"
            accessibilityRole="button"
          >
            <Text style={styles.messageButtonText}>✨ Plan something</Text>
          </TouchableOpacity>
          {/* With a booking CTA as the primary, "Plan Here" moves into this row so it stays one tap away. */}
          {bookingAction ? (
            <TouchableOpacity
              style={styles.messageButton}
              onPress={() => navigation.navigate('MakeAPlan', { partnerId })}
              activeOpacity={0.85}
              accessibilityLabel={`Plan something at ${partner.name}`}
              accessibilityRole="button"
            >
              <Text style={styles.messageButtonText}>📅 Plan Here</Text>
            </TouchableOpacity>
          ) : null}
          {/* Same request form as asking Nearby, addressed to just this business (hidden when Reserve/Book/Request already opens it). */}
          {!(bookingAction && ['reserve', 'book', 'request'].includes(bookingAction.kind)) && (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => navigation.navigate('AskBusiness', { targetPartner: { id: partnerId, name: partner.name }, prefillCategory: partner.subcategory ?? null })}
            activeOpacity={0.85}
            accessibilityLabel={`Get an offer from ${partner.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.messageButtonText}>Get an offer</Text>
          </TouchableOpacity>
          )}
          {hasThread && (
            <TouchableOpacity
              style={styles.messageButton}
              onPress={() => navigation.navigate('BusinessConversation', { partnerId, partnerName: partner.name })}
              activeOpacity={0.85}
              accessibilityLabel={`Your conversation with ${partner.name}`}
              accessibilityRole="button"
            >
              <Text style={styles.messageButtonText}>💬 Your conversation</Text>
            </TouchableOpacity>
          )}
        </View>

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
                <ExperienceMediaPreview path={exp.media_path} type={exp.media_type} colors={colors} />
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
              const unlock = unlockStatus(offer, unlockProgress[offer.id]);
              const isLocked = unlock?.isLocked ?? false;
              return (
                <View key={offer.id} style={styles.offerCard}>
                  <Text style={styles.offerTitle}>{offer.title}</Text>
                  {offer.description ? <Text style={styles.offerDesc}>{offer.description}</Text> : null}
                  {offer.redemption_limit != null && (
                    <Text style={styles.scarcityText}>
                      {Math.max(0, offer.redemption_limit - (redemptionCounts[offer.id] ?? 0))} of {offer.redemption_limit} {offer.redemption_limit === 1 ? 'spot' : 'spots'} left
                    </Text>
                  )}
                  {offer.unlock_scope != null && (
                    <Text style={styles.scarcityText}>
                      {unlock.label}
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
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  // Item 37: Follow is a passive subscribe action, not the primary CTA --
  // outlined in both states, never filled coral. "Plan Here" (below) is
  // the real primary action on this screen.
  followButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  followingButton: { backgroundColor: colors.surface, borderColor: colors.border },
  followButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  followingButtonText: { color: colors.textSecondary },
  messageButton: { flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center' },
  messageButtonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  // Item 37: the real primary, context-aware CTA for "looking at a
  // business" -- filled coral, same treatment followButton used to have.
  planHereButton: {
    borderRadius: radius.full, paddingVertical: 14,
    alignItems: 'center', marginBottom: spacing.lg, backgroundColor: colors.primary, ...shadow.button,
  },
  planHereButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
