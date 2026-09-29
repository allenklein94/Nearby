import { practicalFacts } from '../utils/gatheringPractical';
import { attendeeSummary } from '../utils/gatheringAttendeeDisplay';
import { presentRecoverableError } from '../utils/recoverableError';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert } from 'react-native';
import { NLoader, showSuccessToast } from '../motion';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { usePostHog } from 'posthog-react-native';
import {
  getGatheringById,
  getSignedGatheringPhotoUrl,
  getGatheringFirstTimerCount,
  getGatheringFitReasons,
  getGatheringGroupInsights,
  expressInterest,
  setGatheringInterested,
  getInterestedDemandPrefs,
  acknowledgeInterestedDisclosure,
  leaveGathering,
  getHostStats,
  getHostReputation,
  getHostLovedTags,
  getApprovedAttendeeCount,
  getPendingInterestCount,
  getGatheringMessageCount,
  cancelGathering,
  stopRecurringSeries,
} from '../services/gatherings';
import { filterToMyConnections } from '../services/connections';
import { recordBehaviorEvent } from '../services/behaviorSignals';
import { visibilityMeta } from '../constants/gatheringVisibility';
import { formatPreciseBucketLine, formatInterestLine } from '../utils/groupInsightsLabels';
import { getSignedPhotoUrl } from '../services/photos';
import { getPlanIdForResource } from '../services/plans';
import { getGatheringOffer } from '../services/brandOffers';
import { checkGatheringInterestLimit } from '../services/gatheringLimits';
import {
  getBusinessRequestForGathering,
  getAcceptedOfferForRequest,
  getOpenOfferCounts,
  submitBusinessRequestForGathering,
} from '../services/businessFulfillment';
import { getMyPartnershipRequestForTarget } from '../services/businessPartnerships';
import GatheringQnA from '../components/GatheringQnA';
import HostAttendeeManager from '../components/HostAttendeeManager';
import GatheringFeedbackPrompt from '../components/GatheringFeedbackPrompt';
import CancellationReasonSheet from '../components/CancellationReasonSheet';
import GatheringIntentModal from '../components/GatheringIntentModal';
import InviteFriendsModal from '../components/InviteFriendsModal';
import GatheringStatusBadge from '../components/GatheringStatusBadge';
import ReasonList from '../components/ReasonList';
import LoadErrorState from '../components/LoadErrorState';
import AcceptedBusinessOfferCard from '../components/AcceptedBusinessOfferCard';
import PlanCompletionRow from '../components/PlanCompletionRow';
import { getGatheringPlanCompletion, formatPlaceStatusLabel } from '../utils/planCompletion';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { curatedCoverPhotoFor } from '../constants/gatheringCoverPhotos';
import { useTheme } from '../context/ThemeContext';
import { displayDateTime } from '../i18n/display';
import { useLanguage } from '../context/LanguageContext';
import useCategoryNames from '../hooks/useCategoryNames';
import { attendeeTotal, getGatheringFullness, gatheringBusinessPartySize } from '../utils/gatheringFullness';
import { gatheringRequestText } from '../utils/gatheringBusinessAsk';
import { countLabel } from '../utils/plural';
import { spacing, radius, typography } from '../theme';
import { gatheringJoinAction } from '../utils/primaryAction';
import { expiredDateLabel } from '../utils/inviteExpiry';
import { gatheringViewerState } from '../utils/objectState';
import { canDo, gatheringLifecycleState } from '../utils/objectLifecycle';
import { interestedConfirmation } from '../utils/actionConfirmations';

// Labels: ui.gatheringVocab.vibe.<key>.{label, low, high} (shared with Create/Edit).
const VIBE_SCALES = [{ key: 'energy_level' }, { key: 'conversation_level' }, { key: 'group_size_feel' }];

export default function GatheringDetailScreen({ route, navigation }) {
  const { gatheringId } = route.params;
  const { colors, shadow } = useTheme();
  const { t, language } = useLanguage();
  const names = useCategoryNames(); // category names in the person's language (display only)
  const styles = getStyles(colors, shadow);
  const posthog = usePostHog();

  const [gathering, setGathering] = useState(null);
  const [reasonAsk, setReasonAsk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);
  const [hostPhotoUrl, setHostPhotoUrl] = useState(null);
  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [firstTimerCount, setFirstTimerCount] = useState(0);
  const [friendAttendeeCount, setFriendAttendeeCount] = useState(0);
  const [groupInsights, setGroupInsights] = useState(null);
  const [offer, setOffer] = useState(null);
  const [hostStats, setHostStats] = useState(null);
  const [hostReputation, setHostReputation] = useState(null);
  const [lovedTags, setLovedTags] = useState([]);
  const [intentModalVisible, setIntentModalVisible] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  // The host can turn invitations off for everyone but themselves (allow_attendee_invites; also enforced server-side).
  const canInvite = !!gathering && (gathering.isHost || gathering.allow_attendee_invites !== false);
  const [countdownStats, setCountdownStats] = useState(null);
  const [businessRequest, setBusinessRequest] = useState(null);
  const [acceptedBusinessOffer, setAcceptedBusinessOffer] = useState(null);
  const [placeOfferCounts, setPlaceOfferCounts] = useState({ pendingCount: 0, offeredCount: 0 });
  const [firingBusinessRequest, setFiringBusinessRequest] = useState(false);
  // "Find a Business for This Plan" merge (CLAUDE.md, locked directly by
  // the user) -- the specific-business half of the merged entry point.
  // myPartnershipRequest is null (no real request), 'declined' (treated
  // the same as null -- try again), or a real 'pending'/'approved' row.
  const [myPartnershipRequest, setMyPartnershipRequest] = useState(null);
  const [businessHelpChooserOpen, setBusinessHelpChooserOpen] = useState(false);
  // Home's contextual "Join" CTA lands here and opens the normal join confirmation once (limits, approval,
  // women-only and invite-only all still apply; nothing is joined without the confirmation).
  const openJoinRequested = route.params?.openJoin === true;
  // Item 55 ("deep links should preserve context, too" -- CLAUDE.md): a
  // notification tap can carry the real reason the user landed here (the
  // exact push body text, see notifications.js's routeNotificationTap) and,
  // for the two types where it's genuinely the one obviously-correct next
  // step, a flag to surface "Invite Friends" right alongside it -- never
  // forced for every notification type, only the ones where it's real.
  const notificationReason = route.params?.notificationReason ?? null;
  const notificationSuggestsInvite = route.params?.notificationSuggestsInvite ?? false;
  const openJoinHandled = useRef(false);
  // One explicit viewer state (relation + time) instead of re-combining myStatus/isHost/date per block.
  const viewer = gathering ? gatheringViewerState(gathering) : null;
  // What this state allows comes from the lifecycle table, not re-derived per block.
  const can = (action) => (gathering ? canDo('gathering', gatheringLifecycleState(gathering), action) : false);
  useEffect(() => {
    if (!openJoinRequested || openJoinHandled.current || !gathering) return;
    openJoinHandled.current = true;
    const blocked = !can('join') || gathering.myStatus
      || (gathering.visibility === 'invite_only' && !gathering.hasInviteOnlyAccess);
    if (!blocked) setIntentModalVisible(true);
  }, [openJoinRequested, gathering]);
  const [showReasonBanner, setShowReasonBanner] = useState(!!notificationReason);

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
    recordBehaviorEvent('open', 'gathering', g.id, g.interest_tag);
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
        setCountdownStats({ going: going ?? attendeeTotal(g), interested, messages, waitlisted: g.waitlistCount });

        // Gap #1 (CLAUDE.md, "vision doc describes a fully merged
        // gathering/date <-> business UX"): the gathering's own linked
        // business request/offer, surfaced inline instead of only ever
        // living on a separate BusinessRequestDetailScreen. Host sees the
        // full in-progress state (pending/waiting, not just confirmed) --
        // business_requests' own RLS lets the real requester see the row
        // regardless of status.
        const request = await getBusinessRequestForGathering(gatheringId);
        setBusinessRequest(request);
        if (request) {
          const accepted = await getAcceptedOfferForRequest(request.id);
          setAcceptedBusinessOffer(accepted);
          // Real "N businesses found" / "N offers, choose one" sub-state
          // (CLAUDE.md, Aug 30 2026) -- host-only, since RLS only ever
          // lets the requester see pending/offered rows at all (an
          // attendee's own widened policy is scoped to accepted/completed
          // only, see the comment on that branch below).
          setPlaceOfferCounts(accepted ? { pendingCount: 0, offeredCount: 0 } : await getOpenOfferCounts(request.id));
        } else {
          setAcceptedBusinessOffer(null);
          setPlaceOfferCounts({ pendingCount: 0, offeredCount: 0 });
        }
        const partnershipRequest = await getMyPartnershipRequestForTarget('gathering', gatheringId);
        setMyPartnershipRequest(partnershipRequest);
      } else {
        setCountdownStats(null);
        setMyPartnershipRequest(null);
        // P0 #1 fix (CLAUDE.md, Aug 29 2026 Full Coherence Audit
        // remediation): an approved attendee should see the real
        // confirmed venue too, not just the host -- RLS now allows this
        // (see 20260829_gathering_attendees_see_confirmed_venue.sql).
        // Deliberately narrower than the host's own fetch: never surface
        // the "waiting to hear back" pending state to an attendee -- only
        // the real, final, confirmed outcome, which is also all the
        // widened business_request_offers policy actually permits
        // (accepted/completed only, never a business's own in-progress
        // bid).
        if (g.myStatus === 'approved') {
          const request = await getBusinessRequestForGathering(gatheringId);
          if (request) {
            const accepted = await getAcceptedOfferForRequest(request.id);
            setBusinessRequest(request);
            setAcceptedBusinessOffer(accepted);
          } else {
            setBusinessRequest(null);
            setAcceptedBusinessOffer(null);
          }
        } else {
          setBusinessRequest(null);
          setAcceptedBusinessOffer(null);
        }
        // An attendee's own RLS never surfaces pending/offered rows (only
        // accepted/completed, per the branch above's own comment) -- no
        // real count to show, the formatter's honest fallback ("Waiting
        // for business offer") is what an attendee should see either way.
        setPlaceOfferCounts({ pendingCount: 0, offeredCount: 0 });
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

        // Aggregate for every viewer (no identities); the per-person ids are member-only (Hub).
        setFirstTimerCount(await getGatheringFirstTimerCount(gatheringId));

        // Group Insights plan (2026-09-18): a real, already-connected-only
        // signal for the fit-reasons hero -- filterToMyConnections() over
        // this gathering's own approved attendees, same helper Discover's
        // "People You Know" section already uses.
        const connections = await filterToMyConnections(g.approvedAttendees.map((a) => a.user_id));
        setFriendAttendeeCount(connections.length);
      } else {
        setAttendeePhotoUrls({});
        setFirstTimerCount(0);
        setFriendAttendeeCount(0);
      }

      // Group Insights plan (2026-09-18): the RPC itself decides the tier
      // ('none'/'coarse'/'precise') from the real approved-attendee count,
      // the gathering's own party_type, and its host toggle -- runs
      // regardless of attendee count so a 0/1/2-person gathering correctly
      // gets back 'none' rather than this screen guessing.
      setGroupInsights(await getGatheringGroupInsights(gatheringId));
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

  async function openPlanDetail() {
    try {
      const planId = await getPlanIdForResource('gathering', gatheringId);
      if (planId) navigation.navigate('PlanDetail', { planId });
    } catch (e) {
      Alert.alert(t('ui.common.error'), t('ui.gatheringDetail.couldNotOpenPlan'));
    }
  }

  const [togglingInterested, setTogglingInterested] = useState(false);
  const [showDemandDisclosure, setShowDemandDisclosure] = useState(false);
  async function toggleInterested() {
    if (togglingInterested) return;
    const next = !gathering.myInterested;
    setTogglingInterested(true);
    try {
      await setGatheringInterested(gatheringId, next);
      // Item 124: low-risk and private, so Undo sits on the toast and puts it back exactly as it was.
      showSuccessToast(...interestedConfirmation(next), { undo: () => undoInterested(!next) });
      if (next) {
        // One-time, inline (no screen): interest may feed anonymous local demand trends. Never repeats once acknowledged.
        const prefs = await getInterestedDemandPrefs().catch(() => null);
        if (prefs && prefs.share && !prefs.acknowledged) setShowDemandDisclosure(true);
      }
      await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => toggleInterested() });
    }
    setTogglingInterested(false);
  }

  async function undoInterested(previous) {
    try {
      await setGatheringInterested(gatheringId, previous);
      if (previous === false) setShowDemandDisclosure(false);
      await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'undo that', error: e, onRetry: () => undoInterested(previous) });
    }
  }

  async function handleConfirmIntent() {
    setIntentModalVisible(false);

    const limitCheck = await checkGatheringInterestLimit();
    if (!limitCheck.allowed) {
      Alert.alert(
        t('ui.gatherings.limitTitle'),
        limitCheck.reason,
        [
          { text: t('ui.common.notNow'), style: 'cancel' },
          { text: t('ui.gatherings.upgrade'), onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    setJoining(true);
    try {
      const result = await expressInterest(gatheringId);
      recordBehaviorEvent('join', 'gathering', gatheringId, gathering?.interest_tag);
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
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleConfirmIntent() });
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
      // Item 69 (CLAUDE.md): "Businesses shouldn't need to know the
      // person's identity." gathering.title is the host's own freely-
      // chosen text -- it could just as easily be "Sarah's Birthday" as
      // "Yoga in the Park," and this fires with no user-review step in
      // between. category (the gathering's real interest_tag, already
      // sent separately below) already tells the business what kind of
      // gathering this is; a generic phrase covers the rest without ever
      // risking a real name.
      await submitBusinessRequestForGathering({
        gatheringId,
        text: gatheringRequestText(gathering.interest_tag),
        category: gathering.interest_tag ?? null,
      });
      posthog.capture('gathering_business_help_fired', { gatheringId });
      await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleAskBusinessesNow() });
    }
    setFiringBusinessRequest(false);
  }

  function confirmLeave() {
    const isPending = gathering.myStatus === 'pending';
    Alert.alert(
      t(isPending ? 'ui.gatheringDetail.withdrawTitle' : 'ui.gatheringDetail.leaveTitle'),
      t(gathering.myStatus === 'approved' ? 'ui.gatheringDetail.leaveBodyApproved' : isPending ? 'ui.gatheringDetail.leaveBodyPending' : 'ui.gatheringDetail.leaveBodyWaitlist'),
      [
        { text: t('ui.gatheringDetail.stay'), style: 'cancel' },
        {
          text: t(isPending ? 'ui.gatheringDetail.withdraw' : 'ui.common.leave'),
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveGathering(gatheringId);
              posthog.capture(isPending ? 'gathering_request_withdrawn' : 'gathering_left');
              await load();
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmLeave() });
            }
            setLeaving(false);
          },
        },
      ]
    );
  }

  // Host cancellation lifecycle (2026-09-06 CLAUDE.md item 6) -- the
  // detail screen previously had no Cancel action at all, only the
  // hosting-tab list row (GatheringsScreen.js's confirmCancelGathering,
  // same recurring-series branching preserved here verbatim).
  function confirmCancelGatheringInDetail() {
    if (gathering.recurrence_rule) {
      Alert.alert(
        t('ui.gatheringDetail.cancelTitle', { title: gathering.title }),
        t('ui.gatheringDetail.cancelRecurringBody'),
        [
          { text: t('ui.gatheringDetail.keepIt'), style: 'cancel' },
          {
            text: t('ui.gatheringDetail.justThisOne'),
            onPress: async () => {
              try {
                await cancelGathering(gatheringId);
                setReasonAsk({ entityType: 'gathering', entityId: gatheringId, role: 'host' });
              } catch (e) {
                presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmCancelGatheringInDetail() });
              }
            },
          },
          {
            text: t('ui.gatheringDetail.stopSeries'),
            style: 'destructive',
            onPress: async () => {
              try {
                await stopRecurringSeries(gatheringId);
                await load();
                Alert.alert(t('ui.gatheringDetail.seriesStoppedTitle'), t('ui.gatheringDetail.seriesStoppedBody'));
              } catch (e) {
                presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmCancelGatheringInDetail() });
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      t('ui.gatheringDetail.cancelTitle', { title: gathering.title }),
      t('ui.gatheringDetail.cancelBody'),
      [
        { text: t('ui.gatheringDetail.keepIt'), style: 'cancel' },
        {
          text: t('ui.gatheringDetail.cancelGathering'),
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelGathering(gatheringId);
              setReasonAsk({ entityType: 'gathering', entityId: gatheringId, role: 'host' });
            } catch (e) {
              presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmCancelGatheringInDetail() });
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <NLoader fullScreen={false} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{t('ui.gatheringDetail.loading')}</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.loadingContainer}>
        <LoadErrorState message={t('ui.gatheringDetail.loadError')} onRetry={load} />
      </View>
    );
  }

  if (!gathering) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.notFoundText}>{t('ui.gatheringDetail.notAvailable')}</Text>
      </View>
    );
  }

  const categoryStyle = categoryStyleFor(gathering.interest_tag);
  const { reasons } = getGatheringFitReasons(gathering, { firstTimerCount, friendAttendeeCount });
  // Group Insights plan (2026-09-18): the shared-interests line is allowed
  // regardless of tier (it's not demographic, and the product spec's own
  // small-group example shows plain names even when the age/gender
  // sub-block is suppressed) -- the age/gender sub-block below is gated
  // separately on makeup_tier.
  const groupInsightsInterestLine = groupInsights
    ? formatInterestLine({
        tier: groupInsights.makeup_tier,
        interestNames: groupInsights.interest_names,
        interestCounts: groupInsights.interest_counts,
      })
    : null;
  // Persistent, computed People/Time/Place status (CLAUDE.md, Aug 29
  // 2026) -- reuses exactly the same businessRequest/acceptedBusinessOffer
  // state the merged offer card below already fetches, so this never
  // needs a second query and can never say something different from the
  // detailed banner right underneath it.
  const planCompletion = getGatheringPlanCompletion({
    approvedAttendeeCount: attendeeTotal(gathering),
    businessRequest,
    acceptedOffer: acceptedBusinessOffer,
  });
  // Real staged copy for the Place segment (CLAUDE.md, Aug 30 2026 --
  // "Find a place" -> "N businesses found" -> "Choose an option" ->
  // "Booked at {venue}") -- every count is real, from the same
  // business_request_offers rows the merged accepted-offer card below
  // already reads.
  const planPlaceLabels = {
    done: formatPlaceStatusLabel({ place: 'done', venueName: acceptedBusinessOffer?.brand_partners?.name ?? null }),
    pending: formatPlaceStatusLabel({ place: 'pending', ...placeOfferCounts }),
    todo: t('ui.gatheringDetail.findAPlace'),
  };
  const gatheringIsUpcoming = viewer?.actionable ?? false;
  const canActOnPlace = Boolean(businessRequest || acceptedBusinessOffer || gatheringIsUpcoming);
  function handlePlaceRowPress() {
    if (businessRequest || acceptedBusinessOffer) {
      navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id });
    } else if (gatheringIsUpcoming) {
      setBusinessHelpChooserOpen(true);
    }
  }
  const hasVibe = VIBE_SCALES.some((scale) => gathering[scale.key] != null);
  const curatedCover = curatedCoverPhotoFor(gathering.interest_tag);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl * 2 }}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.hero} accessibilityLabel={t('ui.gatherings.coverA11y', { name: gathering.title })} />
        ) : curatedCover ? (
          <Image source={{ uri: curatedCover }} style={styles.hero} accessibilityLabel={t('ui.gatherings.coverA11y', { name: names.tag(gathering.interest_tag) })} />
        ) : (
          <View style={[styles.hero, styles.heroFallback, { backgroundColor: categoryStyle.color + '30' }]}>
            <Text style={styles.heroFallbackIcon}>{categoryStyle.icon}</Text>
          </View>
        )}

        <View style={styles.content}>
          {showReasonBanner && notificationReason && (
            <View style={styles.notificationReasonBanner}>
              <Text style={styles.notificationReasonText}>{notificationReason}</Text>
              <View style={styles.notificationReasonActions}>
                {notificationSuggestsInvite && canInvite && (
                  <TouchableOpacity
                    onPress={() => setInviteModalVisible(true)}
                    style={styles.notificationReasonInviteButton}
                    accessibilityLabel={t('ui.gatheringDetail.inviteA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.notificationReasonInviteButtonText}>{t('ui.gatheringDetail.inviteFriendsCap')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setShowReasonBanner(false)}
                  accessibilityLabel={t('ui.common.dismiss')}
                  accessibilityRole="button"
                  style={styles.notificationReasonDismiss}
                >
                  <Text style={styles.notificationReasonDismissText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.titleRow}>
            <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
              <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
            </View>
            <Text style={styles.title}>{gathering.title}</Text>
          </View>
          <Text style={styles.metaLine}>
            {displayDateTime(gathering.scheduled_at, language)}{gathering.distanceLabel ? ` · ${gathering.distanceLabel}` : ''}
          </Text>
          {(gathering.isHost || gathering.myStatus === 'approved') && (
            <TouchableOpacity onPress={openPlanDetail} accessibilityRole="button" accessibilityLabel={t('ui.gatheringDetail.wholePlanA11y')}>
              <Text style={{ color: colors.primary, fontWeight: '700', marginTop: spacing.xs }}>{t('ui.gatheringDetail.wholePlan')}</Text>
            </TouchableOpacity>
          )}
          {/* Item 109 (CLAUDE.md, "make the visibility model explicit"): a
              real, always-visible badge showing who this gathering is
              actually visible to -- the same VISIBILITY_OPTIONS vocabulary
              the create flow's own picker already uses, so a host or
              attendee never has to trust an invisible rule. */}
          {visibilityMeta(gathering.visibility) && (
            <Text style={styles.metaLine}>
              {visibilityMeta(gathering.visibility).icon} {t(`ui.gatheringVocab.visibility.${gathering.visibility}.label`)}
              {gathering.visibility === 'community' && gathering.community?.name ? ` · ${gathering.community.name}` : ''}
            </Text>
          )}

          {viewer.relation === 'hosting' ? (
            <GatheringStatusBadge status="hosting" />
          ) : viewer.relation === 'attending' ? (
            <GatheringStatusBadge status="going" />
          ) : viewer.relation === 'waitlisted' ? (
            <GatheringStatusBadge status="waitlisted" />
          ) : viewer.relation === 'requested' ? (
            <GatheringStatusBadge status="interested" />
          ) : null}

          {gathering.capacity != null && (
            <Text style={styles.capacityLine}>
              {/* capacity counts everyone, including the host */}
              {gathering.isFull
                ? t('ui.gatheringDetail.fullTaken', { n: getGatheringFullness(gathering).people, cap: gathering.capacity })
                : t('ui.gatheringDetail.spotsFilled', { n: getGatheringFullness(gathering).people, cap: gathering.capacity })}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('ViewProfile', { userId: gathering.host_id })}
            style={styles.hostLineRow}
            accessibilityLabel={t('ui.gatheringDetail.hostedByA11y', { name: gathering.host?.display_name ?? '' })}
            accessibilityRole="button"
          >
            {hostPhotoUrl ? (
              <Image source={{ uri: hostPhotoUrl }} style={styles.hostAvatarSmall} />
            ) : (
              <View style={[styles.hostAvatarSmall, styles.hostAvatarPlaceholder]} />
            )}
            <Text style={styles.hostLine}>{t('ui.gatheringDetail.hostedBy', { name: gathering.host?.display_name ?? '' })}</Text>
          </TouchableOpacity>

          {gathering.women_only && (
            <View style={styles.womenOnlyBadge}>
              <Text style={styles.womenOnlyBadgeText}>{t('ui.gatherings.womenOnly')}</Text>
            </View>
          )}

          {/* A host was previously shown "Why this fits you" on their own
              gathering -- incoherent, since they made it. There's no real
              per-audience signal to compute a host-facing "why others
              might like this" variant from without fabricating one for a
              hypothetical viewer, so this is just suppressed for the host
              rather than replaced with a guess. */}
          {!gathering.isHost && reasons.length > 0 && (
            <View style={styles.reasonsCard}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.whyFits')}</Text>
              <ReasonList reasons={reasons} textStyle={styles.reasonLine} iconColor={colors.textPrimary} />
            </View>
          )}

          {gathering.description ? <Text style={styles.description}>{gathering.description}</Text> : null}
          {practicalFacts(gathering).map((f) => <Text key={f} style={styles.description}>{f}</Text>)}

          {viewer.relation === 'attending' && viewer.time === 'past' && (
            <GatheringFeedbackPrompt gatheringId={gatheringId} />
          )}

          {attendeeTotal(gathering) > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.whosGoing')}</Text>
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
                <Text style={styles.attendeesText}>{attendeeSummary(gathering, { verb: 'going', maxAvatars: 6 })?.text}</Text>
              </View>
              {firstTimerCount > 0 && (
                <Text style={styles.firstTimerText}>
                  {t('ui.gatheringDetail.firstTimers', { count: firstTimerCount })}
                </Text>
              )}
            </View>
          )}

          {/* Group Insights plan (2026-09-18): an elaboration of "Who's
              Going" above, not a competitor to the personalized "Why this
              fits you" hero at the top of the screen. Client renders
              whatever the RPC's own real tier decided -- no math, no
              re-thresholding here. The interests line can appear even when
              the age/gender sub-block is suppressed (groupInsights.
              makeup_tier === 'none'), since shared interests aren't
              demographic. */}
          {(groupInsightsInterestLine || groupInsights?.makeup_tier === 'coarse' || groupInsights?.makeup_tier === 'precise') && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.groupInsights')}</Text>
              {groupInsightsInterestLine && (
                <Text style={styles.groupInsightsLine}>{t('ui.gatheringDetail.sharedInterests', { list: groupInsightsInterestLine })}</Text>
              )}
              {groupInsights.makeup_tier === 'coarse' && (
                <>
                  {groupInsights.age_coarse_label && (
                    <Text style={styles.groupInsightsLine}>{groupInsights.age_coarse_label}</Text>
                  )}
                  {groupInsights.gender_coarse_label && (
                    <Text style={styles.groupInsightsLine}>{groupInsights.gender_coarse_label}</Text>
                  )}
                </>
              )}
              {groupInsights.makeup_tier === 'precise' && (
                <>
                  {groupInsights.age_buckets?.length > 0 && (
                    <View style={styles.groupInsightsBucketGroup}>
                      <Text style={styles.subLabel}>{t('ui.gatheringDetail.age')}</Text>
                      {groupInsights.age_buckets.map((b) => (
                        <Text key={b.label} style={styles.groupInsightsLine}>{formatPreciseBucketLine(b)}</Text>
                      ))}
                    </View>
                  )}
                  {groupInsights.gender_buckets?.length > 0 && (
                    <View style={styles.groupInsightsBucketGroup}>
                      <Text style={styles.subLabel}>{t('ui.gatheringDetail.gender')}</Text>
                      {groupInsights.gender_buckets.map((b) => (
                        <Text key={b.label} style={styles.groupInsightsLine}>{formatPreciseBucketLine(b)}</Text>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {(hasVibe || gathering.timeline_steps?.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.whatToExpect')}</Text>

              {hasVibe && (
                <View style={gathering.timeline_steps?.length > 0 ? { marginBottom: spacing.lg } : null}>
                  <Text style={styles.subLabel}>{t('ui.gatheringDetail.thevibe')}</Text>
                  {VIBE_SCALES.map((scale) => {
                    const value = gathering[scale.key];
                    if (value == null) return null;
                    return (
                      <View key={scale.key} style={styles.vibeScaleRow}>
                        <Text style={styles.vibeScaleLabel}>{t(`ui.gatheringVocab.vibe.${scale.key}.label`)}</Text>
                        <View style={styles.vibeDotsRow}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <View key={n} style={[styles.vibeDot, n <= value && { backgroundColor: categoryStyle.color, borderColor: categoryStyle.color }]} />
                          ))}
                        </View>
                        <View style={styles.vibeEndLabels}>
                          <Text style={styles.vibeEndLabel}>{t(`ui.gatheringVocab.vibe.${scale.key}.low`)}</Text>
                          <Text style={styles.vibeEndLabel}>{t(`ui.gatheringVocab.vibe.${scale.key}.high`)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {gathering.timeline_steps?.length > 0 && (
                <View>
                  <Text style={styles.subLabel}>{t('ui.gatheringDetail.timeline')}</Text>
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
              <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.communityPerks')}</Text>

              {offer && (
                <View style={styles.perkCard}>
                  <Text style={styles.perkKicker}>{t('ui.gatheringDetail.communityPerk')}</Text>
                  <Text style={styles.perkTitle}>{offer.title}</Text>
                  {offer.brand_partners?.name && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessProfile', { partnerId: offer.partner_id })}
                      accessibilityLabel={t('ui.gatheringDetail.businessProfileA11y', { name: offer.brand_partners.name })}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.perkSub, styles.perkSubLink]}>{t('ui.gatheringDetail.atBusiness', { name: offer.brand_partners.name })}</Text>
                    </TouchableOpacity>
                  )}
                  {offer.description ? <Text style={styles.perkDesc}>{offer.description}</Text> : null}
                </View>
              )}

              {gathering.community && (
                <TouchableOpacity
                  style={[styles.communityCard, offer && { marginTop: spacing.sm }]}
                  onPress={() => navigation.navigate('CommunityDetail', { communityId: gathering.community.id, communityName: gathering.community.name })}
                  accessibilityLabel={t('ui.gatheringDetail.communityA11y', { name: gathering.community.name })}
                  accessibilityRole="button"
                >
                  <Text style={styles.communityKicker}>{t('ui.gatheringDetail.partOfCommunity')}</Text>
                  <Text style={styles.communityTitle}>{gathering.community.name}</Text>
                  <Text style={styles.communitySub}>{t('ui.gatheringDetail.viewCommunity')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('ui.gatheringDetail.meetOrganizer')}</Text>
            <TouchableOpacity
              style={styles.organizerRow}
              onPress={() => navigation.navigate('ViewProfile', { userId: gathering.host_id })}
              accessibilityLabel={t('ui.gatheringDetail.profileA11y', { name: gathering.host?.display_name ?? '' })}
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
                {t('ui.gatheringDetail.hostedStats', { hosted: t('ui.gatheringDetail.hostedCount', { count: hostStats.gatherings_hosted }), avg: t('ui.gatheringDetail.avgAttendees', { count: Math.round(hostStats.avg_attendance) }) })}
              </Text>
            )}
            {hostReputation && hostReputation.feedback_count > 0 && (
              <Text style={styles.organizerStatLine}>
                {t('ui.gatheringDetail.reputation', { welcoming: hostReputation.welcoming_pct, again: hostReputation.would_return_pct, reviews: t('ui.gatheringDetail.reviews', { count: hostReputation.feedback_count }) })}
              </Text>
            )}
            {lovedTags.length > 0 && (
              <Text style={styles.organizerStatLine}>{t('ui.gatheringDetail.lovedList', { list: lovedTags.join(' · ') })}</Text>
            )}
          </View>

          <GatheringQnA gatheringId={gatheringId} isHost={gathering.isHost} />

          {gathering.isHost ? (
            <View style={styles.hostBanner}>
              <Text style={styles.hostBannerText}>{t('ui.gatheringDetail.youreHosting')}</Text>
              {gathering.interestedCount > 0 && (
                <Text style={styles.hostBannerText}>
                  {t('ui.gatheringDetail.interestedCount', { count: gathering.interestedCount })}
                </Text>
              )}
              <PlanCompletionRow
                people={planCompletion.people}
                time={planCompletion.time}
                place={planCompletion.place}
                placeLabels={planPlaceLabels}
                onPlacePress={canActOnPlace ? handlePlaceRowPress : undefined}
                style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}
              />
              {countdownStats && (
                <View style={styles.countdownRow}>
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.going}</Text>
                    <Text style={styles.countdownLabel}>{t('ui.gatheringDetail.statGoing')}</Text>
                  </View>
                  <View style={styles.countdownDivider} />
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.interested}</Text>
                    <Text style={styles.countdownLabel}>{t('ui.gatheringDetail.statInterested')}</Text>
                  </View>
                  <View style={styles.countdownDivider} />
                  <View style={styles.countdownStat}>
                    <Text style={styles.countdownNumber}>{countdownStats.messages}</Text>
                    <Text style={styles.countdownLabel}>{t('ui.gatheringDetail.statMessages')}</Text>
                  </View>
                  {gathering.capacity != null && countdownStats.waitlisted > 0 && (
                    <>
                      <View style={styles.countdownDivider} />
                      <View style={styles.countdownStat}>
                        <Text style={styles.countdownNumber}>{countdownStats.waitlisted}</Text>
                        <Text style={styles.countdownLabel}>{t('ui.gatheringDetail.statWaitlisted')}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
              {gathering.capacity != null && !gathering.isFull && (
                (() => {
                  const { spotsLeft, almostFull } = getGatheringFullness(gathering);
                  return almostFull ? (
                    <Text style={styles.almostFullNudge}>
                      {t('ui.gatheringDetail.almostFull', { count: spotsLeft })}
                    </Text>
                  ) : null;
                })()
              )}
              <HostAttendeeManager gatheringId={gatheringId} onChanged={load} />
              <TouchableOpacity
                onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.groupChatA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.groupChat')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('GatheringHub', { gatheringId })}
                style={{ marginTop: spacing.xs }}
                accessibilityLabel={t('ui.gatheringDetail.hubA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.hubRocket')}</Text>
              </TouchableOpacity>
              {/* Host cancellation lifecycle parity (2026-09-10 follow-up):
                  Communities already group Edit/Pause/Cancel under a
                  "Manage Community" label -- this label makes Gatherings'
                  own equivalent (Edit/Cancel) visually match, same links,
                  same behavior, just now grouped and named to match. */}
              {can('edit') && (
                <>
                  <Text style={styles.manageSectionLabel}>{t('ui.gatheringDetail.manage')}</Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('EditGathering', { gathering })}
                    style={{ marginTop: spacing.xs }}
                    accessibilityLabel={t('ui.gatheringDetail.editA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.edit')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmCancelGatheringInDetail}
                    style={{ marginTop: spacing.xs }}
                    accessibilityLabel={t('ui.gatheringDetail.cancelA11y')}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.hostBannerLink, { color: colors.danger }]}>{t('ui.gatheringDetail.cancelGathering')}</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.xs }}
                accessibilityLabel={t('ui.gatheringDetail.inviteA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.inviteFriendsArrow')}</Text>
              </TouchableOpacity>
              {viewer.actionable && (
                acceptedBusinessOffer ? (
                  // Gap #1: the accepted business offer, shown inline
                  // instead of only ever living on a separate
                  // BusinessRequestDetailScreen. Shared with
                  // DateProposalScreen's own Gap #2 rendering of the exact
                  // same fact via AcceptedBusinessOfferCard (convergence
                  // pass P1 follow-up) -- one component, not two
                  // hand-copied blocks.
                  <AcceptedBusinessOfferCard
                    offer={acceptedBusinessOffer}
                    groupCare
                    partySize={businessRequest?.party_size ?? null}
                    onViewRequest={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                    style={{ marginTop: spacing.xs }}
                  />
                ) : businessRequest ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.waitingBusinesses')}</Text>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })}
                      accessibilityLabel={t('ui.gatheringDetail.viewRequestA11y')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.viewRequest')}</Text>
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
                    <Text style={styles.businessReadyText}>{t('ui.gatheringDetail.businessReady')}</Text>
                    {/* Aug 23 2026 Product Coherence Audit P2 (CLAUDE.md):
                        this banner's own wording was the third, visually
                        disconnected narration of the same one decision (the
                        "Ask Local Businesses" checkbox at creation time,
                        then this screen's own later-visit banner) -- a
                        small caption naming where "You asked us" actually
                        came from closes that gap without changing the real
                        underlying flow. */}
                    <Text style={styles.businessReadyCaption}>{t('ui.gatheringDetail.businessReadyCaption')}</Text>
                    <TouchableOpacity
                      style={styles.businessReadyButton}
                      onPress={handleAskBusinessesNow}
                      disabled={firingBusinessRequest}
                      accessibilityLabel={t('ui.gatheringDetail.lookNowA11y')}
                      accessibilityRole="button"
                    >
                      {firingBusinessRequest ? <ActivityIndicator color="#fff" /> : <Text style={styles.businessReadyButtonText}>{t('ui.gatheringDetail.lookNow')}</Text>}
                    </TouchableOpacity>
                  </View>
                ) : myPartnershipRequest?.status === 'approved' ? (
                  // "Find a Business for This Plan" merge (CLAUDE.md,
                  // locked directly by the user) -- the specific-business
                  // mechanism's own confirmed state, same visual language
                  // as the broadcast mechanism's "Local Business
                  // Confirmed" card above rather than a third invented one.
                  <View style={[styles.businessOfferCard, { marginTop: spacing.xs }]}>
                    <Text style={styles.businessOfferKicker}>{t('ui.gatheringDetail.partnerConfirmed')}</Text>
                    <Text style={styles.businessOfferTitle}>{myPartnershipRequest.partnerName}</Text>
                    <Text style={styles.businessOfferSub}>{t('ui.gatheringDetail.partnerConfirmedSub')}</Text>
                  </View>
                ) : myPartnershipRequest?.status === 'pending' ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.waitingPartner', { name: myPartnershipRequest.partnerName })}</Text>
                  </View>
                ) : (
                  // The merged front door itself: neither mechanism has any
                  // real progress yet, so the host sees one primary action
                  // instead of two competing ones ("Request a Business
                  // Partner" / "Ask Local Businesses"). Both underlying
                  // capabilities are untouched -- this only changes which
                  // mental model the host has to understand up front.
                  <View>
                    <TouchableOpacity
                      onPress={() => setBusinessHelpChooserOpen((v) => !v)}
                      style={{ marginTop: spacing.xs }}
                      accessibilityLabel={t('ui.gatheringDetail.findBusinessA11y')}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: businessHelpChooserOpen }}
                    >
                      <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.findBusiness')}</Text>
                    </TouchableOpacity>
                    {businessHelpChooserOpen && (
                      <View style={styles.businessHelpChooser}>
                        <TouchableOpacity
                          style={styles.businessHelpChooserOption}
                          onPress={() => {
                            setBusinessHelpChooserOpen(false);
                            navigation.navigate('RequestBusinessPartner', { targetType: 'gathering', targetId: gatheringId, targetTitle: gathering.title });
                          }}
                          accessibilityLabel={t('ui.gatheringDetail.specificA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={styles.businessHelpChooserOptionTitle}>{t('ui.gatheringDetail.specific')}</Text>
                          <Text style={styles.businessHelpChooserOptionSub}>{t('ui.gatheringDetail.specificSub')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.businessHelpChooserOption, { marginTop: spacing.xs }]}
                          onPress={() => {
                            setBusinessHelpChooserOpen(false);
                            navigation.navigate('AskBusiness', {
                              gatheringId,
                              gatheringTitle: gathering.title,
                              gatheringPartySize: gatheringBusinessPartySize(gathering),
                              prefillCategory: gathering.interest_tag ?? null,
                            });
                          }}
                          accessibilityLabel={t('ui.gatheringDetail.askNearbyA11y')}
                          accessibilityRole="button"
                        >
                          <Text style={styles.businessHelpChooserOptionTitle}>{t('ui.gatheringDetail.askNearby')}</Text>
                          <Text style={styles.businessHelpChooserOptionSub}>{t('ui.gatheringDetail.askNearbySub')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )
              )}
              {!gathering.community_id && viewer.time === 'past' && (
                <TouchableOpacity
                  onPress={() => navigation.navigate('CreateCommunity', {
                    seedFromGatheringId: gatheringId,
                    quickStartTitle: gathering.title,
                    quickStartCategory: gathering.interest_tag,
                  })}
                  style={{ marginTop: spacing.xs }}
                  accessibilityLabel={t('ui.gatheringDetail.createCommunityA11y')}
                  accessibilityRole="button"
                >
                  <Text style={styles.hostBannerLink}>{t('ui.gatheringDetail.createCommunity')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : gathering.myStatus === 'approved' ? (
            <View style={styles.youreInPanel}>
              <Text style={styles.youreInTitle}>{t('ui.gatheringDetail.youreIn')}</Text>
              <Text style={styles.youreInSub}>{t('ui.gatheringDetail.sayHelloPrompt')}</Text>
              {acceptedBusinessOffer && (
                // P0 #1 fix (CLAUDE.md, Aug 29 2026 Full Coherence Audit
                // remediation): the real confirmed venue, now widened to
                // every approved attendee, not just the host -- same
                // shared component the host banner uses, so this never
                // drifts into a second hand-copied rendering. No
                // "View request ->" link here on purpose -- that screen's
                // other actions (accept/decline/cancel) are the host's
                // own decision-making context.
                <AcceptedBusinessOfferCard
                  offer={acceptedBusinessOffer}
                  groupCare
                  partySize={businessRequest?.party_size ?? null}
                  style={{ marginBottom: spacing.sm }}
                />
              )}
              <TouchableOpacity
                style={styles.sayHelloButton}
                onPress={() => navigation.navigate('GatheringHub', { gatheringId })}
                activeOpacity={0.85}
                accessibilityLabel={t('ui.gatheringDetail.hubA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloButtonText}>{t('ui.gatheringDetail.hub')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.sayHelloA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>{t('ui.gatheringDetail.sayHello')}</Text>
              </TouchableOpacity>
{canInvite && (
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.inviteA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>{t('ui.gatheringDetail.inviteFriends')}</Text>
              </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.leaveA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{t(leaving ? 'ui.gatheringDetail.leaving' : 'ui.gatheringDetail.leaveGathering')}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.myStatus === 'waitlisted' ? (
            <View style={styles.pendingPanel}>
              <Text style={styles.pendingText}>{t('ui.gatheringDetail.onWaitlist')}</Text>
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.leaveWaitlistA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{t(leaving ? 'ui.gatheringDetail.leaving' : 'ui.gatheringDetail.leaveWaitlist')}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.myStatus === 'pending' ? (
            <View style={styles.pendingPanel}>
              {can('dismiss') ? (
                <>
                  <Text style={styles.pendingText}>{t('ui.actions.requestExpired')}</Text>
                  <Text style={styles.pendingText}>{expiredDateLabel(gathering.scheduled_at)}</Text>
                </>
              ) : (
                <Text style={styles.pendingText}>{t('ui.gatheringDetail.requestSent')}</Text>
              )}
              <TouchableOpacity
                onPress={confirmLeave}
                disabled={leaving}
                style={{ marginTop: spacing.sm }}
                accessibilityLabel={t('ui.gatheringDetail.withdrawA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.leaveLink}>{t(leaving ? 'ui.gatheringDetail.withdrawing' : viewer.expired ? 'ui.common.dismiss' : 'ui.gatheringDetail.withdrawRequest')}</Text>
              </TouchableOpacity>
            </View>
          ) : gathering.visibility === 'invite_only' && !gathering.hasInviteOnlyAccess ? (
            <View style={styles.pendingPanel}>
              <Text style={styles.pendingText}>{t('ui.gatheringDetail.inviteOnly', { name: gathering.host?.display_name ?? '' })}</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.joinButton, { backgroundColor: categoryStyle.color }, shadow.button]}
                onPress={() => setIntentModalVisible(true)}
                disabled={joining}
                activeOpacity={0.85}
                accessibilityLabel={gatheringJoinAction(gathering, { isFull: gathering.isFull, interested: gathering.myInterested === true }).label}
                accessibilityRole="button"
              >
                <Text style={styles.joinButtonText}>
                  {joining ? t('ui.gatheringDetail.joining') : gatheringJoinAction(gathering, { isFull: gathering.isFull, interested: gathering.myInterested === true }).label.toUpperCase()}
                </Text>
              </TouchableOpacity>
              {can('interested') && (
                <>
                <TouchableOpacity
                  onPress={toggleInterested}
                  disabled={togglingInterested}
                  style={{ marginTop: spacing.sm, alignItems: 'center' }}
                  accessibilityLabel={t(gathering.myInterested ? 'ui.gatheringDetail.removeInterestedA11y' : 'ui.gatheringDetail.markInterestedA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !!gathering.myInterested }}
                >
                  <Text style={styles.sayHelloLink}>
                    {t(gathering.myInterested ? 'ui.gatheringDetail.interestedOn' : 'ui.gatheringDetail.interestedOff')}
                  </Text>
                  {gathering.myInterested && (
                    <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2, textAlign: 'center' }}>
                      {t('ui.gatheringDetail.interestedNote')}
                    </Text>
                  )}
                </TouchableOpacity>
              {gathering.myInterested && showDemandDisclosure && (
                <View style={styles.pendingPanel}>
                  <Text style={styles.pendingText}>{t('ui.gatheringDetail.demandDisclosure')}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.sm }}>
                    <TouchableOpacity
                      onPress={() => { setShowDemandDisclosure(false); acknowledgeInterestedDisclosure(); }}
                      accessibilityLabel={t('ui.common.gotIt')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.sayHelloLink}>{t('ui.common.gotIt')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { setShowDemandDisclosure(false); acknowledgeInterestedDisclosure(); navigation.navigate('Settings'); }}
                      accessibilityLabel={t('ui.gatheringDetail.changeInSettings')}
                      accessibilityRole="button"
                    >
                      <Text style={styles.leaveLink}>{t('ui.gatheringDetail.changeInSettings')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
                </>
              )}
{canInvite && (
              <TouchableOpacity
                onPress={() => setInviteModalVisible(true)}
                style={{ marginTop: spacing.sm, alignItems: 'center' }}
                accessibilityLabel={t('ui.gatheringDetail.inviteOneA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.sayHelloLink}>{t('ui.gatheringDetail.inviteOne')}</Text>
              </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <GatheringIntentModal
        visible={intentModalVisible}
        gathering={gathering}
        onClose={() => setIntentModalVisible(false)}
        onConfirm={handleConfirmIntent}
        confirmLabel={gatheringJoinAction(gathering, { isFull: gathering.isFull }).label}
      />

      <InviteFriendsModal
        visible={inviteModalVisible}
        onClose={() => setInviteModalVisible(false)}
        gatheringId={gatheringId}
        gatheringTitle={gathering.title}
      />
      <CancellationReasonSheet ask={reasonAsk} onClose={() => { setReasonAsk(null); navigation.goBack(); }} />
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
  notificationReasonBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  notificationReasonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  notificationReasonActions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  notificationReasonInviteButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  notificationReasonInviteButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  notificationReasonDismiss: { marginLeft: 'auto', padding: spacing.xs },
  notificationReasonDismissText: { color: colors.textTertiary, fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryBadge: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  categoryBadgeIcon: { fontSize: 16 },
  title: { ...typography.title, color: colors.textPrimary, flex: 1 },
  metaLine: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs },
  capacityLine: { color: colors.textTertiary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  almostFullNudge: { color: colors.warning, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
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
  groupInsightsLine: { color: colors.textSecondary, fontSize: 14, marginBottom: 4 },
  groupInsightsBucketGroup: { marginTop: spacing.sm },
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
  businessReadyBanner: {
    marginTop: spacing.xs, backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.md,
  },
  businessReadyText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  businessReadyCaption: { color: colors.textTertiary, fontSize: 11, marginBottom: spacing.sm },
  businessReadyButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.sm, alignItems: 'center' },
  businessReadyButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  businessHelpChooser: { marginTop: spacing.sm },
  businessHelpChooserOption: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  businessHelpChooserOptionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  businessHelpChooserOptionSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
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
  manageSectionLabel: {
    ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.xs,
  },
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
  // Aug 30 2026 -- dark, not white: categoryStyle.color is a deliberately
  // low-saturation badge palette, not built to carry solid white CTA
  // text (measured 2.03-3.19:1 contrast, below the WCAG floor -- the
  // real cause of "this button looks disabled"). See
  // gatheringCategoryStyles.js's own CATEGORY_BUTTON_TEXT_COLOR comment.
  joinButtonText: { color: CATEGORY_BUTTON_TEXT_COLOR, fontWeight: '800', fontSize: 16, letterSpacing: 0.5 },
});
