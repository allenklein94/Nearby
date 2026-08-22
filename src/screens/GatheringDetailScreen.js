import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { usePostHog } from 'posthog-react-native';
import {
  getGatheringById,
  getSignedGatheringPhotoUrl,
  getFirstTimerAttendeeIds,
  getGatheringFitReasons,
  expressInterest,
  leaveGathering,
  getHostStats,
  getHostReputation,
  getHostLovedTags,
  getApprovedAttendeeCount,
  getPendingInterestCount,
  getGatheringMessageCount,
} from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { getGatheringOffer } from '../services/brandOffers';
import { checkGatheringInterestLimit } from '../services/gatheringLimits';
import {
  getBusinessRequestForGathering,
  getAcceptedOfferForRequest,
  submitBusinessRequestForGathering,
  formatOfferSummary,
} from '../services/businessFulfillment';
import GatheringQnA from '../components/GatheringQnA';
import GatheringIntentModal from '../components/GatheringIntentModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
import GatheringStatusBadge from '../components/GatheringStatusBadge';
import LoadErrorState from '../components/LoadErrorState';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { openUberToDestination } from '../utils/uberDeepLink';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const VIBE_SCALES = [
  { key: 'energy_level', label: 'Energy', lowLabel: 'Chill', highLabel: 'High energy' },
  { key: 'conversation_level', label: 'Conversation', lowLabel: 'Quiet', highLabel: 'Chatty' },
  { key: 'group_size_feel', label: 'Group feel', lowLabel: 'Intimate', highLabel: 'Big group' },
];

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function GatheringDetailScreen({ route, navigation }) {
  const { gatheringId } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const posthog = usePostHog();

  const [gathering, setGathering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);
  const [hostPhotoUrl, setHostPhotoUrl] = useState(null);
  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [firstTimerCount, setFirstTimerCount] = useState(0);
  const [offer, setOffer] = useState(null);
  const [hostStats, setHostStats] = useState(null);
  const [hostReputation, setHostReputation] = useState(null);
  const [lovedTags, setLovedTags] = useState([]);
  const [intentModalVisible, setIntentModalVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [countdownStats, setCountdownStats] = useState(null);
  const [businessRequest, setBusinessRequest] = useState(null);
  const [acceptedBusinessOffer, setAcceptedBusinessOffer] = useState(null);
  const [firingBusinessRequest, setFiringBusinessRequest] = useState(false);

  const load = useCallback(async () => {
    let g;
    try {
      g = await getGatheringById(gatheringId);
    } catch (e) {
      setGathering(null);
      setLoadError(true);
      setLoading(false);
      return;
    }

    if (!g) {
      setGathering(null);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setGathering(g);
    setLoadError(false);
    setLoading(false);

    try {
      const [cover, hostPhoto, offerResult, stats, reputation] = await Promise.all([
        g.cover_photo_path ? getSignedGatheringPhotoUrl(g.cover_photo_path) : Promise.resolve(null),
        g.host?.photo_url ? getSignedPhotoUrl(g.host.photo_url) : Promise.resolve(null),
        getGatheringOffer(gatheringId),
        getHostStats(g.host_id),
        getHostReputation(g.host_id),
      ]);
      setCoverUrl(cover);
      setHostPhotoUrl(hostPhoto);
      setOffer(offerResult);
      setHostStats(stats);
      setHostReputation(reputation);

      if (g.host_id) {
        getHostLovedTags(g.host_id).then(setLovedTags);
      }

      if (g.isHost) {
        const [going, interested, messages] = await Promise.all([
          getApprovedAttendeeCount(gatheringId),
          getPendingInterestCount(gatheringId),
          getGatheringMessageCount(gatheringId),
        ]);
        setCountdownStats({ going, interested, messages, waitlisted: g.waitlistCount });

        // Gap #1 (CLAUDE.md, "vision doc describes a fully merged
        // gathering/date <-> business UX"): the gathering's own linked
        // business request/offer, surfaced inline instead of only ever
        // living on a separate BusinessRequestDetailScreen. Host-only --
        // business_requests' own RLS only ever lets the real requester
        // (the host, since only the host can call
        // create_business_request_for_gathering) see the row at all.
        const request = await getBusinessRequestForGathering(gatheringId);
        setBusinessRequest(request);
        if (request) {
          const accepted = await getAcceptedOfferForRequest(request.id);
          setAcceptedBusinessOffer(accepted);
        } else {
          setAcceptedBusinessOffer(null);
        }
      } else {
        setCountdownStats(null);
        setBusinessRequest(null);
        setAcceptedBusinessOffer(null);
      }

      if (g.approvedAttendees?.length > 0) {
        const urlEntries = await Promise.all(
          g.approvedAttendees.map(async (a) => {
            const path = a.profiles?.photo_url;
            if (!path) return null;
            const url = await getSignedPhotoUrl(path);
            return [a.user_id, url];
          })
        );
        setAttendeePhotoUrls(Object.fromEntries(urlEntries.filter(Boolean)));

        const firstTimers = await getFirstTimerAttendeeIds(gatheringId, g.approvedAttendees.map((a) => a.user_id));
        setFirstTimerCount(firstTimers.length);
      } else {
        setAttendeePhotoUrls({});
        setFirstTimerCount(0);
      }
    } catch (e) {
      // Enrichment data (cover photo, host stats/reputation, offer, attendee
      // photos/first-timer count) failed to load — the core gathering
      // content above already rendered successfully, so this fails quietly
      // rather than replacing a working screen with an error state.
    }
  }, [gatheringId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleConfirmIntent() {
    setIntentModalVisible(false);

    const limitCheck = await checkGatheringInterestLimit();
    if (!limitCheck.allowed) {
      Alert.alert(
        'Daily limit reached',
        limitCheck.reason,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    setJoining(true);
    try {
      const result = await expressInterest(gatheringId);
      posthog.capture('gathering_interest_expressed', { source: 'detail_screen', status: result.status });
      if (result.status === 'approved') {
        // Auto-approved gatherings land straight in the Gathering Hub —
        // the live, day-of experience — rather than back on this
        // persuade-you-to-join page. Host-approval and waitlisted joins
        // stay here (pending panel / waitlisted panel), since there's
        // nothing live to enter yet either way.
        navigation.replace('GatheringHub', { gatheringId, justJoined: true });
        return;
      }
      // Pending/waitlisted joins stay on this screen (no Hub hand-off, so
      // no Success haptic from that screen either) — a lighter Medium
      // impact confirms the request itself went through, matching this
      // codebase's own Light-tap/Medium-meaningful-action/Success-fully-
      // done haptic convention.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setJoining(false);
  }

  // The deferred half of the party-size bug fix: fires the exact same
  // create_business_request_for_gathering() RPC the manual "Ask Local
  // Businesses" link already uses, but only now -- whatever moment the
  // host actually taps this -- so party_size reflects real
  // gathering_interest rows instead of the zero-attendee moment right
  // after creation.
  async function handleAskBusinessesNow() {
    setFiringBusinessRequest(true);
    try {
      await submitBusinessRequestForGathering({
        gatheringId,
        text: gathering.title,
        category: gathering.interest_tag ?? null,
      });
      posthog.capture('gathering_business_help_fired', { gatheringId });
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setFiringBusinessRequest(false);
  }

  function confirmLeave() {
    const isPending = gathering.myStatus === 'pending';
    Alert.alert(
      isPending ? 'Withdraw your request?' : 'Leave this gathering?',
      gathering.myStatus === 'approved'
        ? "If someone's waiting on the waitlist, they'll take your spot."
        : isPending
        ? "The host won't see your request anymore."
        : "You'll be removed from the waitlist.",
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: isPending ? 'Withdraw' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveGathering(gatheringId);
              posthog.capture(isPending ? 'gathering_request_withdrawn' : 'gathering_left');
              await load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
            setLeaving(false);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading gathering...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.loadingContainer}>
        <LoadErrorState message="Couldn't load this gathering." onRetry={load} />
      </View>
    );
  }

  if (!gathering) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.notFoundText}>This gathering isn't available anymore.</Text>
      </View>
    );
  }

  const categoryStyle = categoryStyleFor(gathering.interest_tag);
  const { reasons } = getGatheringFitReasons(gathering, { firstTimerCount });
  const hasVibe = VIBE_SCALES.some((scale) => gathering[scale.key] != null);
  const curatedCover = curatedCoverPhotoFor(gathering.interest_tag);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.hero} accessibilityLabel={`${gathering.title} cover photo`} />
        ) : curatedCover ? (
          <Image source={{ uri: curatedCover }} style={styles.hero} accessibilityLabel={`${gathering.interest_tag} cover photo`} />
        ) : (
          <View style={[styles.hero, styles.heroFallback, { backgroundColor: categoryStyle.color + '30' }]}>
            <Text style={styles.heroFallbackIcon}>{categoryStyle.icon}</Text>
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
              <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
            </View>
            <Text style={styles.title}>{gathering.title}</Text>
          </View>
          <Text style={styles.metaLine}>
            {formatDate(gathering.scheduled_at)}{gathering.distanceLabel ? ` · ${gathering.distanceLabel}` : ''}
          </Text>

          {gathering.isHost ? (
            <GatheringStatusBadge status="hosting" />
          ) : gathering.myStatus === 'approved' ? (
            <GatheringStatusBadge status="going" />
          ) : gathering.myStatus === 'waitlisted' ? (
            <GatheringStatusBadge status="waitlisted" />
          ) : gathering.myStatus === 'pending' ? (
            <GatheringStatusBadge status="interested" />
          ) : null}

          {gathering.capacity != null && (
            <Text style={styles.capacityLine}>
              {gathering.isFull
                ? `🔒 Full — ${gathering.approvedAttendees.length}/${gathering.capacity} spots taken`
                : `${gathering.approvedAttendees.length}/${gathering.capacity} spots filled`}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('ViewProfile', { userId: gathering.host_id })}
            style={styles.hostLineRow}
            accessibilityLabel={`Hosted by ${gathering.host?.display_name}, view profile`}
            accessibilityRole="button"
          >
            {hostPhotoUrl ? (
              <Image source={{ uri: hostPhotoUrl }} style={styles.hostAvatarSmall} />
            ) : (
              <View style={[styles.hostAvatarSmall, styles.hostAvatarPlaceholder]} />
            )}
            <Text style={styles.hostLine}>Hosted by {gathering.host?.display_name}</Text>
          </TouchableOpacity>

          {gathering.women_only && (
            <View style={styles.womenOnlyBadge}>
              <Text style={styles.womenOnlyBadgeText}>👩 Women Only</Text>
            </View>
          )}

          {reasons.length > 0 && (
            <View style={styles.reasonsCard}>
              <Text style={styles.sectionLabel}>Why this fits you</Text>
              {reasons.map((reason, i) => (
                <Text key={i} style={styles.reasonLine}>✓ {reason}</Text>
              ))}
            </View>
          )}

          {gathering.description ? <Text style={styles.description}>{gathering.description}</Text> : null}

          {gathering.approvedAttendees?.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Who's Going</Text>
              <View style={styles.attendeesRow}>
                <View style={styles.attendeeAvatars}>
                  {gathering.approvedAttendees.slice(0, 6).map((attendee, i) => {
                    const url = attendeePhotoUrls[attendee.user_id];
                    return url ? (
                      <Image
                        key={attendee.user_id}
                        source={{ uri: url }}
                        style={[styles.attendeeAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}
                      />
                    ) : (
                      <View
                        key={attendee.user_id}
                        style={[styles.attendeeAvatar, styles.attendeeAvatarPlaceholder, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}
                      />
                    );
                  })}
                </View>
                <Text style={styles.attendeesText}>
                  {gathering.approvedAttendees.length === 1
                    ? `${gathering.approvedAttendees[0].profiles?.display_name} is going`
                    : `${gathering.approvedAttendees.length} people going`}
                  {gathering.approvedAttendees.length > 6 ? ` (+${gathering.approvedAttendees.length - 6} more)` : ''}
                </Text>
              </View>
              {firstTimerCount > 0 && (
                <Text style={styles.firstTimerText}>
                  🌱 {firstTimerCount} {firstTimerCount === 1 ? "attendee's" : "attendees'"} first gathering
                </Text>
              )}
            </View>
          )}

          {(hasVibe || gathering.timeline_steps?.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>📋 What to Expect</Text>

              {hasVibe && (
                <View style={gathering.timeline_steps?.length > 0 ? { marginBottom: spacing.lg } : null}>
                  <Text style={styles.subLabel}>The Vibe</Text>
                  {VIBE_SCALES.map((scale) => {
                    const value = gathering[scale.key];
                    if (value == null) return null;
                    return (
                      <View key={scale.key} style={styles.vibeScaleRow}>
                        <Text style={styles.vibeScaleLabel}>{scale.label}</Text>
                        <View style={styles.vibeDotsRow}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <View key={n} style={[styles.vibeDot, n <= value && { backgroundColor: categoryStyle.color, borderColor: categoryStyle.color }]} />
                          ))}
                        </View>
                        <View style={styles.vibeEndLabels}>
                          <Text style={styles.vibeEndLabel}>{scale.lowLabel}</Text>
                          <Text style={styles.vibeEndLabel}>{scale.highLabel}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {gathering.beginner_friendly && <Text style={styles.beginnerText}>🔰 Beginner friendly</Text>}
                </View>
              )}

              {gathering.timeline_steps?.length > 0 && (
                <View>
                  <Text style={styles.subLabel}>Timeline</Text>
                  {gathering.timeline_steps.map((step, i) => (
                    <View key={i} style={styles.timelineRow}>
                      <View style={styles.timelineDotColumn}>
                        <View style={[styles.timelineDot, { backgroundColor: categoryStyle.color }]} />
                        {i < gathering.timeline_steps.length - 1 && <View style={styles.timelineConnector} />}
                      </View>
                      <View style={styles.timelineTextColumn}>
                        {step.time ? <Text style={styles.timelineTime}>{step.time}</Text> : null}
                        <Text style={styles.timelineLabel}>{step.label}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {(offer || gathering.community) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>🏘️ Community & Perks</Text>

              {offer && (
                <View style={styles.perkCard}>
                  <Text style={styles.perkKicker}>🎁 Community Perk</Text>
                  <Text style={styles.perkTitle}>{offer.title}</Text>
                  {offer.brand_partners?.name && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                      accessibilityLabel={`View ${offer.brand_partners.name}'s business profile`}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.perkSub, styles.perkSubLink]}>at {offer.brand_partners.name}</Text>
                    </TouchableOpacity>
                  )}
                  {offer.description ? <Text style={styles.perkDesc}>{offer.description}</Text> : null}
                </View>
              )}

              {gathering.community && (
                <TouchableOpacity
                  style={[styles.communityCard, offer && { marginTop: spacing.sm }]}
                  onPress={() => navigation.navigate('CommunityDetail', { communityId: gathering.community.id, communityName: gathering.community.name })}
                  accessibilityLabel={`View the ${gathering.community.name} community`}
                  accessibilityRole="button"
                >
                  <Text style={styles.communityKicker}>🏘️ Part of a community</Text>
                  <Text style={styles.communityTitle}>{gathering.community.name}</Text>
                  <Text style={styles.communitySub}>View community →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Meet the Organizer</Text>
            <TouchableOpacity
              style={styles.organizerRow}
              onPress={() => navigation.navigate('ViewProfile', { userId: gathering.host_id })}
              accessibilityLabel={`View ${gathering.host?.display_name}'s profile`}
              accessibilityRole="button"
            >
              {hostPhotoUrl ? (
                <Image source={{ uri: hostPhotoUrl }} style={styles.organizerAvatar} />
              ) : (
                <View style={[styles.organizerAvatar, styles.hostAvatarPlaceholder]} />
              )}
              <Text style={styles.organizerName}>{gathering.host?.display_name}</Text>
            </TouchableOpacity>
            {hostStats && hostStats.gatherings_hosted > 0 && (
              <Text style={styles.organizerStatLine}>
                🎉 Hosted {hostStats.gatherings_hosted} gathering{hostStats.gatherings_hosted === 1 ? '' : 's'}, averaging {Math.round(hostStats.avg_attendance)} attendee{Math.round(hostStats.avg_attendance) === 1 ? '' : 's'}
              </Text>
            )}
            {hostReputation && hostReputation.feedback_count > 0 && (
              <Text style={styles.organizerStatLine}>
                ⭐ {hostReputation.welcoming_pct}% said welcoming · {hostReputation.would_return_pct}% would attend again ({hostReputation.feedback_count} review{hostReputation.feedback_count === 1 ? '' : 's'})
              </Text>
            )}
            {lovedTags.length > 0 && (
              <Text style={styles.organizerStatLine}>💛 What people loved: {lovedTags.join(' · ')}</Text>
            )}
          </View>

          <GatheringQnA gatheringId={gatheringId} isHost={gathering.isHost} />

          {gathering.isHost ? (
            <View style={styles.hostBanner}>
              <Text style={styles.hostBannerText}>You're hosting this gathering.</Text>
              {countdownStats && (
                <View style={styles.countdownRow}>
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.going}</Text>
                    <Text style={styles.countdownLabel}>Going</Text>
                  </View>
                  <View style={styles.countdownDivider} />
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.interested}</Text>
                    <Text style={styles.countdownLabel}>Interested</Text>
                  </View>
                  <View style={styles.countdownDivider} />
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.messages}</Text>
                    <Text style={styles.countdownLabel}>Messages</Text>
                  </View>
                  {gathering.capacity != null && countdownStats.waitlisted > 0 && (
                    <>
                      <View style={styles.countdownDivider} />
                      <View style={styles.countdownStat}>
                        <Text style={styles.countdownNumber}>{countdownStats.waitlisted}</Text>
                        <Text style={styles.countdownLabel}>Waitlisted</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
              {gathering.capacity != null && !gathering.isFull && (
                (() => {
                  const spotsLeft = gathering.capacity - gathering.approvedAttendees.length;
                  const almostFullThreshold = Math.max(2, Math.ceil(gathering.capacity * 0.2));
                  return spotsLeft > 0 && spotsLeft <= almostFullThreshold ? (
                    <Text style={styles.almostFullNudge}>
                      🔥 Almost full — only {spotsLeft} spot{spotsLeft === 1 ? '' : 's'} left. Invite more people before it fills up!
                    </Text>
                  ) : null;
                })()
              )}
              <TouchableOpacity
                onPress={() => navigation.navigate('Gatherings', { initialTab: 'hosting' })}
                accessibilityLabel="Manage attendees"
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>Manage attendees →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.xs }}
                accessibilityLabel="Invite friends to this gathering"
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>🤝 Invite friends →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('RequestBusinessPartner', { targetType: 'gathering', targetId: gatheringId, targetTitle: gathering.title })}
                style={{ marginTop: spacing.xs }}
                accessibilityLabel="Request a business partner for this gathering"
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>🤝 Request a Business Partner →</Text>
              </TouchableOpacity>
              {new Date(gathering.scheduled_at) >= new Date() && (
                acceptedBusinessOffer ? (
                  // Gap #1: the accepted business offer, shown inline
                  // instead of only ever living on a separate
                  // BusinessRequestDetailScreen.
                  <View style={[styles.businessOfferCard, { marginTop: spacing.xs }]}>
                    <Text style={styles.businessOfferKicker}>🍽️ Local Business Confirmed</Text>
                    <Text style={styles.businessOfferTitle}>{acceptedBusinessOffer.brand_partners?.name ?? 'A local business'}</Text>
                    {acceptedBusinessOffer.proposed_time && (
                      <Text style={styles.businessOfferSub}>{formatDate(acceptedBusinessOffer.proposed_time)}</Text>
                    )}
                    <Text style={styles.businessOfferSub}>
                      Confirmed for {businessRequest?.party_size ?? '—'} {businessRequest?.party_size === 1 ? 'person' : 'people'}
                    </Text>
                    {formatOfferSummary(acceptedBusinessOffer) && (
                      <Text style={styles.businessOfferSub}>{formatOfferSummary(acceptedBusinessOffer)}</Text>
                    )}
                    {acceptedBusinessOffer.offer_description ? (
                      <Text style={styles.perkDesc}>{acceptedBusinessOffer.offer_description}</Text>
                    ) : null}
                    {acceptedBusinessOffer.brand_partners?.latitude != null && acceptedBusinessOffer.brand_partners?.longitude != null && (
                      <TouchableOpacity
                        onPress={() => openUberToDestination({
                          latitude: acceptedBusinessOffer.brand_partners.latitude,
                          longitude: acceptedBusinessOffer.brand_partners.longitude,
                          nickname: acceptedBusinessOffer.brand_partners.name,
                          address: acceptedBusinessOffer.brand_partners.address,
                        })}
                        style={{ marginTop: spacing.xs }}
                        accessibilityLabel="Get an Uber there"
                        accessibilityRole="button"
                      >
                        <Text style={styles.businessOfferLink}>🚗 Get an Uber there</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                      style={{ marginTop: spacing.xs }}
                      accessibilityLabel="View your business request"
                      accessibilityRole="button"
                    >
                      <Text style={styles.businessOfferLink}>View request →</Text>
                    </TouchableOpacity>
                  </View>
                ) : businessRequest ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <Text style={styles.hostBannerLink}>🍽️ Waiting to hear back from local businesses.</Text>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                      accessibilityLabel="View your business request"
                      accessibilityRole="button"
                    >
                      <Text style={styles.hostBannerLink}>View request →</Text>
                    </TouchableOpacity>
                  </View>
                ) : gathering.ask_local_businesses ? (
                  // The deferred half of the party-size bug fix: the
                  // checkbox at creation only stored real intent
                  // (gathering.ask_local_businesses) -- nothing was fired
                  // yet, so real attendee state exists to make an honest
                  // ask from right now, whenever the host actually taps
                  // this.
                  <View style={styles.businessReadyBanner}>
                    <Text style={styles.businessReadyText}>You asked us to look for local business options. Ready to see what's available?</Text>
                    <TouchableOpacity
                      style={styles.businessReadyButton}
                      onPress={handleAskBusinessesNow}
                      disabled={firingBusinessRequest}
                      accessibilityLabel="Look for local business options now"
                      accessibilityRole="button"
                    >
                      {firingBusinessRequest ? <ActivityIndicator color="#fff" /> : <Text style={styles.businessReadyButtonText}>Yes, look now →</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => navigation.navigate('AskBusiness', {
                      gatheringId,
                      gatheringTitle: gathering.title,
                      gatheringPartySize: (gathering.approvedAttendees?.length ?? 0) + 1,
                      prefillCategory: gathering.interest_tag ?? null,
                    })}
                    style={{ marginTop: spacing.xs }}
                    accessibilityLabel="Ask local businesses on behalf of this gathering"
                    accessibilityRole="button"
                  >
                    <Text style={styles.hostBannerLink}>🍽️ Ask Local Businesses →</Text>
                  </TouchableOpacity>
                )
              )}
              {!gathering.community_id && new Date(gathering.scheduled_at) < new Date() && (
                <TouchableOpacity
                  onPress={() => navigation.navigate('CreateCommunity', {
                    seedFromGatheringId: gatheringId,
                    quickStartTitle: gathering.title,
                    quickStartCategory: gathering.interest_tag,
                  })}
                  style={{ marginTop: spacing.xs }}
                  accessibilityLabel="Start a community from this gathering"
                  accessibilityRole="button"
                >
                  <Text style={styles.hostBannerLink}>🏘️ Start a Community from This Gathering →</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : gathering.myStatus === 'approved' ? (
            <View style={styles.youreInPanel}>
              <Text style={styles.youreInTitle}>You're in! 🎉</Text>
              <Text style={styles.youreInSub}>Say hello before it starts?</Text>
              <TouchableOpacity
                style={styles.sayHelloButton}
                onPress={() => navigation.navigate('GatheringHub', { gatheringId })}
                activeOpacity={0.85}
                accessibilityLabel="Open the Gathering Hub"
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloButtonText}>Open Gathering Hub →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Open group chat and say hello"
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>💬 Say Hello</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Invite friends to this gathering"
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>🤝 Invite friends</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Leave this gathering"
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{leaving ? 'Leaving...' : 'Leave Gathering'}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.myStatus === 'waitlisted' ? (
            <View style={styles.pendingPanel}>
              <Text style={styles.pendingText}>🕒 You're on the waitlist — we'll let you know if a spot opens up.</Text>
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Leave the waitlist"
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{leaving ? 'Leaving...' : 'Leave Waitlist'}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.myStatus === 'pending' ? (
            <View style={styles.pendingPanel}>
              <Text style={styles.pendingText}>You're interested — the host will review and let you know.</Text>
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel="Withdraw your request to join"
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{leaving ? 'Withdrawing...' : 'Withdraw Request'}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.visibility === 'invite_only' && !gathering.hasInviteOnlyAccess ? (
            <View style={styles.pendingPanel}>
              <Text style={styles.pendingText}>🔒 This gathering is invite-only. Ask {gathering.host?.display_name} for an invite to join.</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.joinButton, { backgroundColor: categoryStyle.color }, shadow.button]}
                onPress={() => setIntentModalVisible(true)}
                disabled={joining}
                activeOpacity={0.85}
                accessibilityLabel={gathering.isFull ? 'Join Waitlist' : (gathering.is_public ? 'Join Gathering' : 'Request to Join')}
                accessibilityRole="button"
              >
                <Text style={styles.joinButtonText}>
                  {joining ? 'Joining...' : gathering.isFull ? 'JOIN WAITLIST' : (gathering.is_public ? 'JOIN GATHERING' : 'REQUEST TO JOIN')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.sm, alignItems: 'center' }}
                accessibilityLabel="Invite a friend to this gathering"
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>🤝 Invite a friend</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>

      <GatheringIntentModal
        visible={intentModalVisible}
        gathering={gathering}
        onClose={() => setIntentModalVisible(false)}
        onConfirm={handleConfirmIntent}
        confirmLabel={gathering.isFull ? 'Join Waitlist' : (gathering.is_public ? 'Join Gathering' : 'Request to Join')}
      />

      <InviteFriendsModal
        visible={inviteModalVisible}
        onClose={() => setInviteModalVisible(false)}
        gatheringId={gatheringId}
        gatheringTitle={gathering.title}
      />
    </View>
  );
}

const HERO_HEIGHT = 320;

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { color: colors.textSecondary, fontSize: 15 },
  hero: { width: '100%', height: HERO_HEIGHT },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroFallbackIcon: { fontSize: 72 },
  content: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryBadge: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  categoryBadgeIcon: { fontSize: 16 },
  title: { ...typography.title, color: colors.textPrimary, flex: 1 },
  metaLine: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs },
  capacityLine: { color: colors.textTertiary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  almostFullNudge: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  hostLineRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.xs },
  hostAvatarSmall: { width: 22, height: 22, borderRadius: 11 },
  hostAvatarPlaceholder: { backgroundColor: colors.border },
  hostLine: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  womenOnlyBadge: {
    alignSelf: 'flex-start', backgroundColor: '#ec489920', borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.sm, borderWidth: 1, borderColor: '#ec4899',
  },
  womenOnlyBadgeText: { color: '#ec4899', fontSize: 11, fontWeight: '700' },
  reasonsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  sectionLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  subLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  reasonLine: { color: colors.textPrimary, fontSize: 14, marginBottom: 2, fontWeight: '600' },
  description: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  section: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  attendeesRow: { flexDirection: 'row', alignItems: 'center' },
  attendeeAvatars: { flexDirection: 'row', alignItems: 'center' },
  attendeeAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.background },
  attendeeAvatarPlaceholder: { backgroundColor: colors.border },
  attendeesText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: spacing.sm },
  firstTimerText: { color: colors.textTertiary, fontSize: 12, marginTop: spacing.sm },
  vibeScaleRow: { marginBottom: spacing.md },
  vibeScaleLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs },
  vibeDotsRow: { flexDirection: 'row', gap: spacing.xs },
  vibeDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: 'transparent' },
  vibeEndLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  vibeEndLabel: { color: colors.textTertiary, fontSize: 11 },
  beginnerText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  timelineRow: { flexDirection: 'row' },
  timelineDotColumn: { alignItems: 'center', width: 20 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  timelineConnector: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border, marginTop: 2 },
  timelineTextColumn: { flex: 1, marginLeft: spacing.sm, paddingBottom: spacing.md },
  timelineTime: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
  timelineLabel: { color: colors.textPrimary, fontSize: 14 },
  perkCard: {
    backgroundColor: '#f59e0b15', borderRadius: radius.lg, borderWidth: 1, borderColor: '#f59e0b',
    padding: spacing.md,
  },
  perkKicker: { color: '#f59e0b', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  perkTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  perkSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  perkSubLink: { color: colors.primary, fontWeight: '600' },
  perkDesc: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  businessOfferCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md,
  },
  businessOfferKicker: { color: colors.primary, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  businessOfferTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  businessOfferSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  businessOfferLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  businessReadyBanner: {
    marginTop: spacing.xs, backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.md,
  },
  businessReadyText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  businessReadyButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center' },
  businessReadyButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  communityCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md,
  },
  communityKicker: { color: colors.primary, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  communityTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  communitySub: { color: colors.primary, fontSize: 13, marginTop: 2, fontWeight: '600' },
  organizerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  organizerAvatar: { width: 44, height: 44, borderRadius: 22 },
  organizerName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  organizerStatLine: { color: colors.textSecondary, fontSize: 13, marginBottom: 4 },
  hostBanner: {
    marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center',
  },
  hostBannerText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: spacing.xs },
  hostBannerLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  countdownRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg, paddingVertical: spacing.sm, width: '100%', marginVertical: spacing.sm,
  },
  countdownStat: { flex: 1, alignItems: 'center' },
  countdownNumber: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  countdownLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  countdownDivider: { width: 1, height: 28, backgroundColor: colors.border },
  youreInPanel: {
    marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, alignItems: 'center',
  },
  youreInTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: 4 },
  youreInSub: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.md },
  sayHelloButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  sayHelloButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sayHelloLink: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  leaveLink: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  pendingPanel: {
    marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, alignItems: 'center',
  },
  pendingText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  joinButton: { marginTop: spacing.xl, borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center' },
  joinButtonText: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
});
