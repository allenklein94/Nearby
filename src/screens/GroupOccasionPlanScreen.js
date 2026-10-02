import React, { useState, useCallback, useEffect } from 'react';
import { tr, getCurrentLanguage } from '../i18n/translate';
import { localDate } from '../i18n/format';
import { occasionName } from '../i18n/categoryNames';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from '../components/EmptyCopy';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TextInput, Platform, Share } from 'react-native';
import FadeInState from '../components/FadeInState';
import CancellationReasonSheet from '../components/CancellationReasonSheet';
import StaggeredReveal from '../components/StaggeredReveal';
import { NLoader, SurpriseRevealAnimation } from '../motion';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import {
  getOccasionGroupPlanDetail,
  respondToOccasionGroupPlan,
  proposeOccasionOption,
  castOccasionVote,
  decideOccasionGroupPlan,
  cancelOccasionGroupPlan,
  setOccasionGroupPlanOrganizer,
  inviteMoreToOccasionGroupPlan,
  inviteGuestToOccasionGroupPlan,
  occasionGroupPlanGuestInviteShareUrl,
  proposeOccasionBusinessOptions,
  decideOccasionGroupPlanBusiness,
  skipOccasionGroupPlanBusinessVote,
  linkOccasionGroupPlanToPlan,
  revealOccasionGroupPlan,
  proposeOccasionGroupPlanDates,
  markOccasionDateAvailability,
  setOccasionGroupPlanDate,
} from '../services/occasionGroupPlans';
import { getMyFriends } from '../services/friends';
import { resolveIntent } from '../services/intentResolver';
import { submitBusinessRequest } from '../services/businessFulfillment';
import {
  ACTIVITY_OPTIONS,
  resolveDecidedGroupPlanParams,
  formatBudgetRange,
  dateWindowForWhenPreset,
  extractBusinessCandidateIds,
  formatBusinessOptionDetail,
  composeCelebrationAskText,
  experienceLevelToPriceLevel,
} from '../services/celebrateSomething';
import { OCCASION_OPTIONS, occasionLabel } from '../constants/businessAttributes';
import { WHEN_PRESETS } from '../utils/whenPresets';
import { isOccasionInviteExpired, expiredDateLabel } from '../utils/inviteExpiry';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { isNotFound } from '../utils/notFound';
import UnavailableState from '../components/UnavailableState';

// "Group planning for an Occasion" (CLAUDE.md, direct user follow-up to the
// Occasion rename/simplify pass). User's own example: "Sarah's 30th
// Birthday," invite 8 friends, everyone proposes/votes on what to do
// (Italian dinner / Bowling / Concert), Nearby turns the winner into a real
// plan via the existing business pipeline. DB layer:
// supabase/migrations/20261020_occasion_group_plans.sql. Deciding
// (decide_occasion_group_plan) hands the winner straight back into
// CelebrateSomethingScreen (resolveDecidedGroupPlanParams), which skips
// straight to its own real last step (business 'options' or gathering/
// custom 'who_involved') -- everything downstream (find businesses ->
// availability -> offer -> reservation) is that wizard's own existing
// pipeline, not rebuilt here. Per the user's own explicit guardrail, this
// stays intentionally small: no RSVP complexity beyond invited/joined/
// declined, no elaborate invitations, no seating charts, no calendars
// beyond the occasion's own single date.
//
// Item 67 (CLAUDE.md, "Let the group vote on businesses"): a SECOND,
// optional voting round on this same screen. Once the group decides a
// business-destined activity type (dinner/night_out/activity),
// decideOccasionGroupPlan moves the plan to 'voting_business' instead of
// 'decided' -- this screen then fetches real live resolveIntent()
// candidates (the same resolver CelebrateSomethingScreen's own 'options'
// step already calls) and proposes the top few as new, votable, real
// business_availability options (never fabricated -- each is re-verified
// live server-side). The whole group votes again on WHICH business, not
// just what to do. Once the host decides the winner, "Book It" submits the
// real bound business_request directly via the existing
// submitBusinessRequest(preferredAvailabilityId) primitive -- which itself
// instantly creates a real 'offered' business_request_offers row. Request
// -> offer -> (accept ->) reservation, without ever routing back through
// CelebrateSomethingScreen's own wizard steps a second time.
function activityMeta(activityType) {
  const o = ACTIVITY_OPTIONS.find((x) => x.key === activityType);
  return o ? { ...o, label: tr(`ui.optionVocab.celebrateActivity.${o.key}`) } : { icon: '💡', label: activityType };
}

function formatWhen(whenPreset, scheduledDate) {
  const preset = WHEN_PRESETS.find((p) => p.key === whenPreset);
  const dateLabel = scheduledDate
    ? localDate(new Date(`${scheduledDate}T00:00:00`), getCurrentLanguage())
    : null;
  const presetLabel = preset ? tr(`ui.gatheringOptions.when.${preset.key}`) : null;
  if (preset && preset.key !== 'custom') return dateLabel ? `${presetLabel} · ${dateLabel}` : presetLabel;
  return dateLabel ?? tr('ui.groupOccasionPlan.dateNotSet');
}

// Item 99 (CLAUDE.md, "Let Nearby recommend when to celebrate") -- the
// same weekday/month/day shape formatWhen already uses for its own
// scheduledDate, just for one standalone candidate date at a time.
function formatDateOptionLabel(dateStr) {
  return localDate(new Date(`${dateStr}T00:00:00`), getCurrentLanguage());
}

// Display labels by stored participant status (values stay canonical).
const PARTICIPANT_STATUS_KEYS = ['invited', 'joined', 'declined'];

export default function GroupOccasionPlanScreen({ navigation, route }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const planId = route.params?.planId;

  const [myId, setMyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Item 139: the object was deleted or is no longer visible (often opened from a push or link): say so, never retry.
  const [unavailable, setUnavailable] = useState(false);
  const [acting, setActing] = useState(false);
  const [reasonAsk, setReasonAsk] = useState(null);
  const [proposeType, setProposeType] = useState(null);
  const [proposeLabel, setProposeLabel] = useState('');
  // Item 112 follow-up (CLAUDE.md, "the lock opens... and the plan
  // becomes visible to the recipient"): true only after the real reveal
  // RPC has already succeeded -- the surprise banner below swaps to the
  // reveal animation for a moment before `load()` (deferred until the
  // animation finishes) flips detail.surpriseMode false and the whole
  // banner naturally disappears.
  const [revealAnimating, setRevealAnimating] = useState(false);

  // Item 66 (CLAUDE.md, "Add collaborative planning"): host/organizer-only
  // "invite more guests" expand-in-place, same "no navigation, contextual
  // disclosure" doctrine this app already applies everywhere (Progressive
  // Depth). Friends are only fetched once this section is actually opened.
  const [inviteMoreOpen, setInviteMoreOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [selectedNewInviteeIds, setSelectedNewInviteeIds] = useState(() => new Set());
  const [invitingMore, setInvitingMore] = useState(false);
  // Items 105 & 106 (CLAUDE.md, "make invitations frictionless" extended
  // to Occasion plans): invite someone by name who isn't a Nearby user
  // yet -- shares a real, per-guest link (docs/occasion-invite.html) they
  // can view and RSVP from with zero install.
  const [guestName, setGuestName] = useState('');
  const [invitingGuest, setInvitingGuest] = useState(false);

  // Item 67 ("Let the group vote on businesses"): businessOptionsLoading
  // covers the host's device fetching real resolveIntent() candidates right
  // after deciding a business-destined activity type; businessFetchError
  // is a real, honest "Nearby found zero genuine options nearby" state (not
  // a network error) -- both offer a real next step (Try Again / Skip),
  // never a dead end. booking covers submitBusinessRequest's own real
  // network round trip once the group's winning business is decided.
  const [businessOptionsLoading, setBusinessOptionsLoading] = useState(false);
  const [businessFetchError, setBusinessFetchError] = useState(false);
  const [booking, setBooking] = useState(false);

  // Item 99 (CLAUDE.md, "Let Nearby recommend when to celebrate"): host-only
  // "propose candidate dates" expand-in-place, same Progressive Depth
  // doctrine as inviteMoreOpen above -- a real native date picker, never
  // AI-inferred, feeding pendingDateOptions until the host explicitly
  // submits them.
  const [proposeDatesOpen, setProposeDatesOpen] = useState(false);
  const [pendingDateOptions, setPendingDateOptions] = useState([]);
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [proposingDates, setProposingDates] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      setMyId(sessionData?.session?.user?.id ?? null);
      const result = await getOccasionGroupPlanDetail(planId);
      setDetail(result);
      setLoadError(false);
    } catch (e) {
      if (isNotFound(e)) setUnavailable(true);
      else setLoadError(true);
    }
    setLoading(false);
  }, [planId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Same "whole-screen re-fetch on any event" shape GroupPlanScreen.js
  // already established for its own multi-party live coordination --
  // exactly one other participant's action (a vote, a new option, a
  // response) needs to show up for everyone without a manual refresh, and
  // this screen is low-frequency enough that per-row optimistic patching
  // isn't worth the complexity.
  useEffect(() => {
    if (!planId) return undefined;
    const channel = supabase
      .channel(`occasion_group_plan:${planId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occasion_group_plans', filter: `id=eq.${planId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occasion_group_plan_participants', filter: `group_plan_id=eq.${planId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occasion_group_plan_options', filter: `group_plan_id=eq.${planId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occasion_group_plan_votes' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [planId, load]);

  async function runAction(fn) {
    setActing(true);
    try {
      const result = await fn();
      await load();
      return result;
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => runAction(fn) });
      return null;
    } finally {
      setActing(false);
    }
  }

  function handleRespond(accept) {
    Haptics.selectionAsync();
    runAction(() => respondToOccasionGroupPlan(planId, accept));
  }

  function handleToggleVote(option) {
    Haptics.selectionAsync();
    runAction(() => castOccasionVote(option.id, !option.myVote));
  }

  // Item 99: a real "I'm free this day" toggle -- any joined participant,
  // same insert-or-delete shape castOccasionVote already uses for votes.
  function handleToggleDateAvailability(dateOption) {
    Haptics.selectionAsync();
    runAction(() => markOccasionDateAvailability(dateOption.id, !dateOption.myAvailable));
  }

  function addPendingDateOption() {
    const iso = pickerDate.toISOString().slice(0, 10);
    setPendingDateOptions((prev) => (prev.includes(iso) ? prev : [...prev, iso].sort()));
    setShowDatePicker(false);
  }

  function removePendingDateOption(iso) {
    setPendingDateOptions((prev) => prev.filter((d) => d !== iso));
  }

  async function handleProposeDates() {
    if (pendingDateOptions.length === 0) return;
    Haptics.selectionAsync();
    setProposingDates(true);
    const result = await runAction(() => proposeOccasionGroupPlanDates(planId, pendingDateOptions));
    setProposingDates(false);
    if (result) {
      setPendingDateOptions([]);
      setProposeDatesOpen(false);
    }
  }

  // The real "Plan for Saturday?" action -- host-only, always confirmed
  // (never silently applied), notifies everyone else in the plan.
  function handleApplyDate(dateOption) {
    const label = formatDateOptionLabel(dateOption.optionDate);
    Alert.alert(
      t('ui.groupOccasionPlan.planFor', { label: label }),
      t('ui.groupOccasionPlan.everyoneInThisPlanWill'),
      [
        { text: t('ui.groupOccasionPlan.notYet'), style: 'cancel' },
        { text: t('ui.groupOccasionPlan.planFor2', { label: label }), onPress: () => runAction(() => setOccasionGroupPlanDate(planId, dateOption.optionDate)) },
      ]
    );
  }

  function handlePropose() {
    if (!proposeType) {
      return Alert.alert(t('ui.groupOccasionPlan.pickSomething'), t('ui.groupOccasionPlan.whatAreYouProposing'));
    }
    Haptics.selectionAsync();
    runAction(() => proposeOccasionOption(planId, proposeType, proposeLabel.trim() || null)).then((result) => {
      if (result) {
        setProposeType(null);
        setProposeLabel('');
      }
    });
  }

  function handleDecide(option) {
    const destinationCopy = ['dinner', 'night_out', 'activity'].includes(option.activityType)
      ? t('ui.groupOccasionPlan.thisLocksInTheGroups')
      : t('ui.groupOccasionPlan.thisLocksInTheGroups2');
    Alert.alert(
      t('ui.groupOccasionPlan.goWith', { label: option.label || activityMeta(option.activityType).label }),
      destinationCopy,
      [
        { text: t('ui.groupOccasionPlan.neverMind'), style: 'cancel' },
        {
          text: t('ui.groupOccasionPlan.decide'),
          onPress: async () => {
            const decided = await runAction(() => decideOccasionGroupPlan(planId, option.id));
            if (!decided) return;
            // Item 67: a business-destined activity type doesn't navigate
            // away -- it starts a second, real group vote right here on
            // this same screen (fetchAndProposeBusinessOptions).
            if (decided.status === 'voting_business') {
              fetchAndProposeBusinessOptions();
            } else {
              navigation.replace('CelebrateSomething', resolveDecidedGroupPlanParams(decided, planId));
            }
          },
        },
      ]
    );
  }

  // Item 67 ("Let the group vote on businesses"): the host's device finds
  // real live business_availability candidates for the just-decided
  // activity type using the exact same resolveIntent() call
  // CelebrateSomethingScreen's own 'options' step already makes -- no
  // second matching engine. Nearby's own top picks (never a free-for-all
  // proposal) get stored as votable options; a genuine zero-result search
  // shows a real empty state with a real next step, never a silent dead end.
  async function fetchAndProposeBusinessOptions() {
    setBusinessOptionsLoading(true);
    setBusinessFetchError(false);
    try {
      const joinedCount = detail?.participants?.filter((p) => p.status === 'joined').length ?? 1;
      const result = await resolveIntent({
        category: null,
        dateWindow: dateWindowForWhenPreset(detail?.whenPreset),
        rawText: '',
        partySize: Math.max(joinedCount, 1),
        occasion: detail?.occasionType,
        // Item 95 (CLAUDE.md): the group's own real "how important is the
        // occasion?" answer nudges which real postings get proposed for
        // the vote, same lever CelebrateSomethingScreen's own solo options
        // step already uses.
        priceLevel: experienceLevelToPriceLevel(detail?.experienceLevel),
        // Item 100 (CLAUDE.md): the plan's own real who-for person's
        // standing/polled preferences bias the proposed options too --
        // safe unconditionally, including under surprise mode, since this
        // reads their own already-visible data and never notifies or
        // reveals anything to them.
        whoForFriendId: detail?.whoForFriendId,
        whoForName: detail?.whoForName,
      });
      const ids = extractBusinessCandidateIds(result);
      if (ids.length === 0) {
        setBusinessFetchError(true);
      } else {
        await proposeOccasionBusinessOptions(planId, ids);
      }
    } catch (e) {
      setBusinessFetchError(true);
    }
    await load();
    setBusinessOptionsLoading(false);
  }

  function handleDecideBusiness(option) {
    Alert.alert(
      t('ui.groupOccasionPlan.goWith2', { partnerName: option.partnerName || t('ui.groupOccasionPlan.thisBusiness') }),
      t('ui.groupOccasionPlan.thisLocksInTheGroups3'),
      [
        { text: t('ui.groupOccasionPlan.neverMind'), style: 'cancel' },
        { text: t('ui.groupOccasionPlan.decide'), onPress: () => runAction(() => decideOccasionGroupPlanBusiness(planId, option.id)) },
      ]
    );
  }

  // Host-only escape hatch: falls back to the pre-Item-67 behavior (browse
  // personally in CelebrateSomethingScreen) when Nearby found zero genuine
  // businesses nearby, or the host would rather skip the second vote.
  async function handleSkipBusinessVote() {
    const decided = await runAction(() => skipOccasionGroupPlanBusinessVote(planId));
    if (decided) {
      navigation.replace('CelebrateSomething', resolveDecidedGroupPlanParams(decided, planId));
    }
  }

  // Item 67's own final step: the group already picked the real business --
  // this submits the actual bound business_request via the exact same
  // submitBusinessRequest(preferredAvailabilityId) primitive Item 53/61
  // already established, which itself instantly creates a real 'offered'
  // business_request_offers row. Host-only (a business_availability posting
  // has finite real capacity -- letting every participant independently
  // "book" the same winning slot would create duplicate competing requests
  // against it).
  async function handleBookWinningBusiness(option) {
    if (!detail) return;
    const joinedCount = detail.participants.filter((p) => p.status === 'joined').length;
    const whoFor = detail.whoForFriendId ? 'friend' : detail.whoForName ? 'someone_else' : 'me';
    const askText = composeCelebrationAskText({
      occasion: detail.occasionType, whoFor, whoForName: detail.whoForName, activityType: option.activityType,
    });
    setBooking(true);
    try {
      const result = await submitBusinessRequest({
        text: askText,
        partySize: Math.max(joinedCount, 1),
        budgetMin: detail.budgetMin,
        budgetMax: detail.budgetMax,
        date: detail.scheduledDate,
        occasion: detail.occasionType,
        preferredAvailabilityId: option.businessAvailabilityId,
        experienceLevel: detail.experienceLevel,
        surpriseMode: detail.surpriseMode,
      });
      linkOccasionGroupPlanToPlan({ groupPlanId: planId, resultingBusinessRequestId: result.requestId }).catch(() => {});
      navigation.replace('BusinessRequestDetail', {
        requestId: result.requestId,
        justSubmitted: true,
        notifiedCount: result.notifiedCount,
        duplicate: result.duplicate,
        prefillText: askText,
        prefillOccasion: detail.occasionType,
        prefillPartySize: Math.max(joinedCount, 1),
      });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleBookWinningBusiness(option) });
    }
    setBooking(false);
  }

  function handleCancel() {
    const booked = detail.status === 'fulfilled';
    Alert.alert(t('ui.groupOccasionPlan.cancelThisPlan'), booked
      ? t('ui.groupOccasionPlan.everyoneWillBeToldAnything')
      : t('ui.groupOccasionPlan.everyoneWillBeToldThis'), [
      { text: t('ui.groupOccasionPlan.neverMind'), style: 'cancel' },
      { text: t('ui.groupOccasionPlan.cancelPlan'), style: 'destructive', onPress: () => runAction(async () => {
        await cancelOccasionGroupPlan(planId);
        setReasonAsk({ entityType: 'occasion_group_plan', entityId: planId, role: 'host' });
      }) },
    ]);
  }

  // Item 96 (CLAUDE.md, "Add surprise mode... Eventually: Reveal plan
  // becomes an action"): host-only. A real, one-way action -- lets the
  // previously-excluded person in as a real participant and notifies
  // them, server-side (reveal_occasion_group_plan), not just a local flag
  // flip.
  function handleReveal() {
    Alert.alert(
      t('ui.groupOccasionPlan.revealTheSurprise'),
      t('ui.groupOccasionPlan.willBeInvitedToThis', { whoForName: detail.whoForName || t('ui.groupOccasionPlan.they') }),
      [
        { text: t('ui.groupOccasionPlan.notYet'), style: 'cancel' },
        { text: t('ui.groupOccasionPlan.reveal'), onPress: performReveal },
      ]
    );
  }

  // Item 112 follow-up: bypasses the shared runAction() helper on purpose
  // -- the reveal animation needs to play, in full, AFTER the real RPC has
  // already succeeded and BEFORE the refetch flips detail.surpriseMode
  // false (which would otherwise unmount this whole banner mid-animation).
  async function performReveal() {
    setActing(true);
    try {
      await revealOccasionGroupPlan(planId);
      setRevealAnimating(true);
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => performReveal() });
      setActing(false);
    }
  }

  async function handleRevealAnimationDone() {
    setRevealAnimating(false);
    setActing(false);
    await load();
  }

  function goFindBusinesses() {
    const winningOption = detail.options.find((o) => o.id === detail.winningOptionId);
    const joinedCount = detail.participants.filter((p) => p.status === 'joined').length;
    navigation.navigate('CelebrateSomething', resolveDecidedGroupPlanParams({
      occasionType: detail.occasionType,
      whoForName: detail.whoForName,
      whoForFriendId: detail.whoForFriendId,
      whenPreset: detail.whenPreset,
      scheduledDate: detail.scheduledDate,
      activityType: winningOption?.activityType,
      label: winningOption?.label,
      partySize: Math.max(joinedCount, 1),
      surpriseMode: detail.surpriseMode,
      budgetMin: detail.budgetMin,
      budgetMax: detail.budgetMax,
    }, planId));
  }

  // Item 66 (CLAUDE.md, "Add collaborative planning"): host-only. Promoting
  // requires the target to have actually joined -- enforced server-side --
  // since a co-organizer role only makes sense for someone who's genuinely
  // in the plan, not someone who merely got invited.
  function handleToggleOrganizer(participant) {
    Haptics.selectionAsync();
    runAction(() => setOccasionGroupPlanOrganizer(planId, participant.userId, !participant.isOrganizer));
  }

  async function openInviteMore() {
    setInviteMoreOpen((v) => !v);
    if (!friendsLoaded && !loadingFriends) {
      setLoadingFriends(true);
      try {
        const result = await getMyFriends();
        setFriends(result);
      } catch (e) {
        setFriends([]);
      }
      setFriendsLoaded(true);
      setLoadingFriends(false);
    }
  }

  function toggleNewInvitee(friendId) {
    Haptics.selectionAsync();
    setSelectedNewInviteeIds((prev) => {
      const next = new Set(prev);
      if (next.has(friendId)) next.delete(friendId); else next.add(friendId);
      return next;
    });
  }

  async function handleInviteMore() {
    if (selectedNewInviteeIds.size === 0) return;
    setInvitingMore(true);
    try {
      await inviteMoreToOccasionGroupPlan(planId, Array.from(selectedNewInviteeIds));
      setSelectedNewInviteeIds(new Set());
      setInviteMoreOpen(false);
      await load();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleInviteMore() });
    }
    setInvitingMore(false);
  }

  // Items 105 & 106: creates the real guest participant row + token, then
  // hands the resulting link straight to the OS share sheet -- the host
  // picks whichever channel (text/email/etc.) actually reaches that person;
  // Nearby never sends it on their behalf.
  async function handleInviteGuest() {
    const trimmed = guestName.trim();
    if (!trimmed) return;
    setInvitingGuest(true);
    try {
      const result = await inviteGuestToOccasionGroupPlan(planId, trimmed);
      setGuestName('');
      await load();
      await Share.share({
        message: t('ui.groupOccasionPlan.youreInvitedToOnNearby', { title: detail?.title ?? 'a plan', occasionGroupPlanGuestInviteShareUrl: occasionGroupPlanGuestInviteShareUrl(result.guestToken) }),
      });
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleInviteGuest() });
    }
    setInvitingGuest(false);
  }

  function handleShareGuestLink(participant) {
    if (!participant.guestToken) return;
    Share.share({
      message: t('ui.groupOccasionPlan.youreInvitedToOnNearby', { title: detail?.title ?? 'a plan', occasionGroupPlanGuestInviteShareUrl: occasionGroupPlanGuestInviteShareUrl(participant.guestToken) }),
    });
  }

  if (loading && !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <NLoader fullScreen={false} />
      </SafeAreaView>
    );
  }

  if (unavailable) {
    return <SafeAreaView style={styles.container}><UnavailableState navigation={navigation} /></SafeAreaView>;
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message={t('ui.groupOccasionPlan.couldntLoadThisPlan')} onRetry={load} />
      </SafeAreaView>
    );
  }

  if (!detail) return null;

  const occasionMeta = OCCASION_OPTIONS.find((o) => o.key === detail.occasionType);
  const canVote = detail.myStatus === 'joined' && detail.status === 'voting';
  const winningOption = (detail.status === 'decided' || detail.status === 'fulfilled')
    ? detail.options.find((o) => o.id === detail.winningOptionId)
    : null;
  const budgetLabel = formatBudgetRange(detail.budgetMin, detail.budgetMax);

  // Item 66: Organizers (host + anyone the host has promoted) get their own
  // named section, matching the user's own mock -- everyone else is just
  // "Guests," a real honest count broken down by status.
  const organizers = detail.participants.filter((p) => p.isOrganizer);
  const guests = detail.participants.filter((p) => !p.isOrganizer);
  const guestCounts = guests.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const canInviteMore = detail.myIsOrganizer && detail.status === 'voting';
  const alreadyInPlanIds = new Set(detail.participants.map((p) => p.userId));
  const inviteMoreCandidates = friends.filter((f) => (
    !alreadyInPlanIds.has(f.id) && !(detail.surpriseMode && f.id === detail.whoForFriendId)
  ));

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.header} accessibilityRole="header">{occasionMeta?.icon ?? '🎉'} {detail.surpriseMode ? '🔒 ' : ''}{detail.title}</Text>
        <Text style={[styles.subheader, budgetLabel && { marginBottom: 0 }]}>
          {occasionName(detail.occasionType, language, occasionLabel(detail.occasionType))} · {formatWhen(detail.whenPreset, detail.scheduledDate)}
          {detail.isHost ? t('ui.groupOccasionPlan.youreHosting') : ''}
        </Text>
        {/* Item 109 (CLAUDE.md, "make the visibility model explicit"): this
            plan is invite-only by construction whether or not surprise mode
            is on -- occasion_group_plans has zero client RLS policies,
            every access goes through an RPC that checks host/organizer/
            joined-participant membership. Say so plainly instead of
            leaving it an invisible rule; the richer surprise-specific
            banner below still covers the surprise case on top of this. */}
        <Text style={[styles.subheader, { marginTop: 2 }]}>{t('ui.groupOccasionPlan.inviteOnlyVisibleToThe')}</Text>
        {budgetLabel && <Text style={[styles.subheader, { marginTop: 2 }]}>💰 {budgetLabel}</Text>}

        {/* Item 65 (CLAUDE.md): the one collaborator-facing surface this
            change added a real indicator to -- surpriseMode is already
            enforced server-side (the person it's for can never actually be
            a participant here), this is just making that fact visible so
            invited friends know to keep it quiet. */}
        {detail.surpriseMode && (
          <View style={styles.surpriseBanner}>
            {revealAnimating ? (
              // Item 112 follow-up: the real reveal RPC has already
              // succeeded by the time this renders (performReveal awaits
              // it first) -- this is celebrating a fact that's already
              // true server-side, never a speculative animation.
              <SurpriseRevealAnimation haptic
                text={t('ui.groupOccasionPlan.canSeeItNow', { whoForName: detail.whoForName || 'They' })}
                onDone={handleRevealAnimationDone}
              />
            ) : (
              <>
                <Text style={styles.surpriseBannerText}>
                  {t('ui.groupOccasionPlan.surpriseBanner', { name: detail.whoForName || t('ui.groupOccasionPlan.thePersonThisIsFor') })}
                </Text>
                {detail.isHost && detail.status !== 'cancelled' && (
                  <View style={styles.surpriseRevealRow}>
                    <Text style={styles.surpriseRevealLabel}>{t('ui.groupOccasionPlan.readyToReveal')}</Text>
                    <TouchableOpacity
                      onPress={handleReveal}
                      disabled={acting}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.groupOccasionPlan.revealTheSurpriseA11y')}
                      style={styles.surpriseRevealButton}
                    >
                      <Text style={styles.surpriseRevealButtonText}>{t('ui.groupOccasionPlan.revealPlan')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Item 99 (CLAUDE.md, "Let Nearby recommend when to celebrate"):
            a real, honest availability poll among the plan's own already-
            real guest roster -- not a read of anyone's calendar (no
            mechanism exists anywhere for a host to see an invitee's own
            calendar, and Item 76 draws a hard line against building one
            for this). Whichever candidate date has the most real "I'm
            free" marks is surfaced back as a real recommendation, computed
            server-side, never guessed -- and only once at least one real
            mark exists, so an unanswered poll never fabricates a pick. */}
        {detail.status !== 'cancelled' && detail.status !== 'fulfilled' && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.sectionLabel}>{t('ui.groupOccasionPlan.whenWorksBest')}</Text>
            {detail.dateOptions.length === 0 ? (
              <Text style={styles.helperText}>
                {detail.isHost ? t('ui.groupOccasionPlan.proposeAFewCandidateDates') : t('ui.groupOccasionPlan.theHostHasntProposedAny')}
              </Text>
            ) : (
              detail.dateOptions.map((opt) => (
                <View key={opt.id} style={styles.optionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{opt.isTopRecommendation ? '⭐ ' : ''}{formatDateOptionLabel(opt.optionDate)}</Text>
                    <Text style={styles.optionSubtitle}>
                      {t('ui.groupOccasionPlan.peopleFree', { count: opt.availableCount })}
                      {opt.isTopRecommendation ? t('ui.groupOccasionPlan.mostAvailability') : ''}
                    </Text>
                  </View>
                  {detail.myStatus === 'joined' && (
                    <TouchableOpacity
                      style={[styles.voteButton, opt.myAvailable && styles.voteButtonActive]}
                      onPress={() => handleToggleDateAvailability(opt)}
                      disabled={acting}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={opt.myAvailable ? t('ui.groupOccasionPlan.imNoLongerFreeThisA11y') : t('ui.groupOccasionPlan.imFreeThisDayA11y')}
                    >
                      <Text style={[styles.voteButtonText, opt.myAvailable && styles.voteButtonTextActive]}>{opt.myAvailable ? t('ui.groupOccasionPlan.imFree') : t('ui.groupOccasionPlan.imFree2')}</Text>
                    </TouchableOpacity>
                  )}
                  {detail.isHost && (
                    <TouchableOpacity style={styles.decideLink} onPress={() => handleApplyDate(opt)} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.planForA11y', { optionDate: formatDateOptionLabel(opt.optionDate) })}>
                      <Text style={styles.decideLinkText}>{t('ui.groupOccasionPlan.use')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}

            {/* The item's own literal moment: "Saturday has the most
                availability among your guests... Plan for Saturday?" --
                shown only when there's a real recommendation the plan
                hasn't already been set to. */}
            {(() => {
              const top = detail.dateOptions.find((o) => o.isTopRecommendation);
              if (!top || !detail.isHost || detail.scheduledDate === top.optionDate) return null;
              const label = formatDateOptionLabel(top.optionDate);
              return (
                <View style={styles.recommendationBanner}>
                  <Text style={styles.recommendationText}>{t('ui.groupOccasionPlan.hasTheMostAvailabilityAmong', { label: label, availableCount: top.availableCount })}</Text>
                  <TouchableOpacity
                    style={[styles.decideButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]}
                    onPress={() => handleApplyDate(top)}
                    disabled={acting}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('ui.groupOccasionPlan.planForA11y2', { label: label })}
                  >
                    <Text style={styles.decideButtonText}>{t('ui.groupOccasionPlan.planFor', { label: label })}</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}

            {detail.isHost && (
              <>
                <TouchableOpacity onPress={() => setProposeDatesOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.proposeCandidateDatesA11y')}>
                  <Text style={styles.inviteMoreLink}>{proposeDatesOpen ? t('ui.groupOccasionPlan.cancel') : t('ui.groupOccasionPlan.proposeDates')}</Text>
                </TouchableOpacity>
                {proposeDatesOpen && (
                  <View style={styles.proposeCard}>
                    {pendingDateOptions.length > 0 && (
                      <View style={styles.chipRow}>
                        {pendingDateOptions.map((iso) => (
                          <TouchableOpacity key={iso} style={[styles.chip, styles.chipSelected]} onPress={() => removePendingDateOption(iso)} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.removeA11y', { iso: formatDateOptionLabel(iso) })}>
                            <Text style={[styles.chipText, styles.chipTextSelected]}>{formatDateOptionLabel(iso)} ✕</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.pickACandidateDateA11y')}>
                      <Text style={{ color: colors.textPrimary }}>{formatDateOptionLabel(pickerDate.toISOString().slice(0, 10))}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={pickerDate}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(event, selectedDate) => {
                          setShowDatePicker(Platform.OS === 'ios');
                          if (selectedDate) setPickerDate(selectedDate);
                        }}
                      />
                    )}
                    <TouchableOpacity style={[styles.addOptionButton, { marginBottom: spacing.sm }]} onPress={addPendingDateOption} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.addThisDateToTheA11y')}>
                      <Text style={styles.addOptionButtonText}>{t('ui.groupOccasionPlan.addThisDate')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.addOptionButton, pendingDateOptions.length === 0 && { opacity: 0.5 }]}
                      onPress={handleProposeDates}
                      disabled={pendingDateOptions.length === 0 || proposingDates}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.groupOccasionPlan.proposeDatesA11y', { count: pendingDateOptions.length })}
                    >
                      <Text style={styles.addOptionButtonText}>{proposingDates ? t('ui.groupOccasionPlan.proposing') : (pendingDateOptions.length ? t('ui.groupOccasionPlan.proposeDatesCount', { count: pendingDateOptions.length }) : t('ui.groupOccasionPlan.proposeDatesNone'))}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {detail.status === 'cancelled' && (
          <FadeInState style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('ui.groupOccasionPlan.thisPlanWasCancelled')}</Text>
          </FadeInState>
        )}

        {detail.myStatus === 'invited' && detail.status === 'voting' && isOccasionInviteExpired(detail.scheduledDate) && (
          <View style={styles.inviteRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.declineButtonText}>{t('ui.groupOccasionPlan.invitationExpired')}</Text>
              <Text style={styles.subheader}>{expiredDateLabel(detail.scheduledDate)}</Text>
            </View>
            <TouchableOpacity style={styles.declineButton} onPress={() => handleRespond(false)} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.dismissExpiredInvitationA11y')}>
              <Text style={styles.declineButtonText}>{t('ui.groupOccasionPlan.dismiss')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {detail.myStatus === 'invited' && detail.status === 'voting' && !isOccasionInviteExpired(detail.scheduledDate) && (
          <View style={styles.inviteRow}>
            <TouchableOpacity style={styles.declineButton} onPress={() => handleRespond(false)} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.declineInviteA11y')}>
              <Text style={styles.declineButtonText}>{t('ui.groupOccasionPlan.cantMakeIt2')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptButton} onPress={() => handleRespond(true)} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.joinAndVoteA11y')}>
              <Text style={styles.acceptButtonText}>{t('ui.groupOccasionPlan.joinVote')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Item 67: a business-kind winning option (the group voted on a
            specific real business, not just an activity type) gets its own
            decided-card treatment -- real partner/posting/price/time, a
            host-only "Book It" action, and (once fulfilled) a static real
            confirmation instead of "Find More Options" -- there's exactly
            one real request tied to this specific plan, never several. */}
        {(detail.status === 'decided' || detail.status === 'fulfilled') && winningOption?.optionKind === 'business' && (
          <View style={styles.decidedCard}>
            <Text style={styles.decidedLabel}>{detail.status === 'fulfilled' ? t('ui.groupOccasionPlan.booked') : t('ui.groupOccasionPlan.itsDecided')}</Text>
            <Text style={styles.decidedChoice}>🍽️ {winningOption.partnerName}</Text>
            {!!winningOption.postingTitle && <Text style={styles.subheader}>{winningOption.postingTitle}</Text>}
            {!!formatBusinessOptionDetail(winningOption) && (
              <Text style={[styles.subheader, { marginBottom: spacing.md }]}>{formatBusinessOptionDetail(winningOption)}</Text>
            )}
            {detail.status === 'fulfilled' ? (
              <Text style={styles.helperText}>{t('ui.groupOccasionPlan.trackItFromYourPlans')}</Text>
            ) : detail.isHost ? (
              <TouchableOpacity style={styles.decideButton} onPress={() => handleBookWinningBusiness(winningOption)} disabled={booking} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.bookThisBusinessA11y')}>
                <Text style={styles.decideButtonText}>{booking ? t('ui.groupOccasionPlan.booking') : t('ui.groupOccasionPlan.bookIt')}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.helperText}>{t('ui.groupOccasionPlan.waitingForTheHostTo')}</Text>
            )}
          </View>
        )}

        {(detail.status === 'decided' || detail.status === 'fulfilled') && winningOption && winningOption.optionKind !== 'business' && (
          <View style={styles.decidedCard}>
            <Text style={styles.decidedLabel}>{detail.status === 'fulfilled' ? t('ui.groupOccasionPlan.turnedIntoARealPlan') : t('ui.groupOccasionPlan.itsDecided')}</Text>
            <Text style={styles.decidedChoice}>
              {activityMeta(winningOption.activityType).icon} {winningOption.label || activityMeta(winningOption.activityType).label}
            </Text>
            {/* "fulfilled" means someone already turned this into a real gathering/business
                request (linkOccasionGroupPlanToPlan) -- the button stays available so anyone
                else who still wants their own separate options can keep going, per this
                object's own multi-actor shape (any joined participant can submit their own). */}
            <TouchableOpacity style={styles.decideButton} onPress={goFindBusinesses} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.findBusinessesForThisA11y')}>
              <Text style={styles.decideButtonText}>{detail.status === 'fulfilled' ? t('ui.groupOccasionPlan.findMoreOptions') : t('ui.groupOccasionPlan.findOptionsNearby')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Item 67: the second, real group vote round -- WHICH business, not
            just what to do. Nearby's own picks (fetchAndProposeBusinessOptions)
            show up as votable options exactly like the activity round above;
            a genuine zero-result search is a real empty state with a real
            next step (Try Again / host-only Skip), never a dead end. */}
        {detail.status === 'voting_business' && (
          <>
            <Text style={styles.sectionLabel}>{t('ui.groupOccasionPlan.voteOnWhere')}</Text>
            {businessOptionsLoading && (
              <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                <NLoader fullScreen={false} size="compact" />
                <Text style={[styles.helperText, { marginTop: spacing.sm }]}>{t('ui.groupOccasionPlan.nearbyIsFindingRealOptions')}</Text>
              </View>
            )}
            {!businessOptionsLoading && detail.options.filter((o) => o.optionKind === 'business').length === 0 && (
              <FadeInState style={styles.emptyState}>
                <EmptyCopy id={businessFetchError ? 'group_plan_options_error' : 'group_plan_options'} />
                {detail.isHost && (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <TouchableOpacity style={styles.declineButton} onPress={fetchAndProposeBusinessOptions} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.tryFindingOptionsAgainA11y')}>
                      <Text style={styles.declineButtonText}>{t('ui.groupOccasionPlan.tryAgain')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.acceptButton} onPress={handleSkipBusinessVote} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.skipAndPickManuallyA11y')}>
                      <Text style={styles.acceptButtonText}>{t('ui.groupOccasionPlan.skipIllPick')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </FadeInState>
            )}
            {/* Item 124 ("Use animation when something becomes available"): the real "we found
                options" moment following the loading caption above -- each option settles into
                place with a small per-index cascade instead of appearing all at once. */}
            {!businessOptionsLoading && detail.options.filter((o) => o.optionKind === 'business').map((option, optionIndex) => (
              <StaggeredReveal key={option.id} index={optionIndex} style={styles.optionCard}>
              <View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{option.partnerName}{option.stillActive === false ? t('ui.groupOccasionPlan.noLongerAvailable') : ''}</Text>
                  {!!option.postingTitle && <Text style={styles.optionSubtitle}>{option.postingTitle}</Text>}
                  <Text style={styles.optionSubtitle}>
                    {[formatBusinessOptionDetail(option), t('ui.groupOccasionPlan.votes', { count: option.voteCount })].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {detail.myStatus === 'joined' && (
                  <TouchableOpacity
                    style={[styles.voteButton, option.myVote && styles.voteButtonActive]}
                    onPress={() => handleToggleVote(option)}
                    disabled={acting}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={option.myVote ? t('ui.groupOccasionPlan.removeVoteA11y') : t('ui.groupOccasionPlan.voteForThisA11y')}
                  >
                    <Text style={[styles.voteButtonText, option.myVote && styles.voteButtonTextActive]}>{option.myVote ? t('ui.groupOccasionPlan.voted') : t('ui.groupOccasionPlan.vote')}</Text>
                  </TouchableOpacity>
                )}
                {detail.isHost && (
                  <TouchableOpacity
                    style={styles.decideLink}
                    onPress={() => handleDecideBusiness(option)}
                    disabled={acting || option.stillActive === false}
                    accessibilityRole="button"
                    accessibilityLabel={t('ui.groupOccasionPlan.decideOnA11y', { partnerName: option.partnerName })}
                  >
                    <Text style={styles.decideLinkText}>{t('ui.groupOccasionPlan.pick')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              </StaggeredReveal>
            ))}
            {!businessOptionsLoading && detail.isHost && detail.options.filter((o) => o.optionKind === 'business').length > 0 && (
              <TouchableOpacity onPress={fetchAndProposeBusinessOptions} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.findMoreOptionsA11y')}>
                <Text style={[styles.inviteMoreLink, { marginTop: spacing.xs }]}>{t('ui.groupOccasionPlan.findMoreOptions2')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {detail.status === 'voting' && (
          <>
            {/* Item 66 (CLAUDE.md, "Add collaborative planning"): Organizers
                (host + anyone promoted) get a named section of their own,
                matching the user's own mock -- everyone else is a Guest,
                a real honest count broken down by status rather than a
                second wall of names. */}
            <Text style={styles.sectionLabel}>{t('ui.groupOccasionPlan.organizers')}</Text>
            <View style={styles.participantsWrap}>
              {organizers.map((p) => {
                const isSelf = p.userId === myId;
                const canDemote = detail.isHost && !isSelf;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.participantChip}
                    disabled={!canDemote}
                    activeOpacity={canDemote ? 0.7 : 1}
                    onPress={() => canDemote && Alert.alert(
                      t('ui.groupOccasionPlan.removeAsOrganizer', { name: p.displayName }),
                      t('ui.groupOccasionPlan.theyllStayARegularGuest'),
                      [{ text: t('ui.groupOccasionPlan.neverMind'), style: 'cancel' }, { text: t('ui.groupOccasionPlan.remove'), style: 'destructive', onPress: () => handleToggleOrganizer(p) }]
                    )}
                    accessibilityRole={canDemote ? 'button' : undefined}
                    accessibilityLabel={canDemote ? t('ui.groupOccasionPlan.removeAsOrganizerA11y', { name: p.displayName }) : undefined}
                  >
                    <Text style={styles.participantText}>
                      {p.userId === detail.hostId ? '👑 ' : '🎗️ '}{p.displayName}{isSelf ? t('ui.groupOccasionPlan.you') : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>
              {t('ui.groupOccasionPlan.guests')}{' '}{[
                guestCounts.invited ? t('ui.groupOccasionPlan.guestsInvited', { count: guestCounts.invited }) : null,
                guestCounts.joined ? t('ui.groupOccasionPlan.guestsJoined', { count: guestCounts.joined }) : null,
                guestCounts.declined ? t('ui.groupOccasionPlan.guestsDeclined', { count: guestCounts.declined }) : null,
              ].filter(Boolean).join(' · ') || t('ui.groupOccasionPlan.noneYet')}
            </Text>
            <View style={styles.participantsWrap}>
              {guests.map((p) => {
                const isSelf = p.userId === myId;
                const canPromote = detail.isHost && !isSelf && !p.isGuest && p.status === 'joined';
                // Items 105 & 106: a guest with no Nearby account can't be
                // promoted (there's no account to grant organizer power
                // to) -- tapping their chip instead re-shares their real
                // invite link, when this viewer is privileged to see it.
                const canShareLink = !!p.guestToken;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.participantChip}
                    disabled={!canPromote && !canShareLink}
                    activeOpacity={(canPromote || canShareLink) ? 0.7 : 1}
                    onPress={() => {
                      if (canPromote) {
                        Alert.alert(
                          t('ui.groupOccasionPlan.makeAnOrganizer', { name: p.displayName }),
                          t('ui.groupOccasionPlan.theyllBeAbleToInvite'),
                          [{ text: t('ui.groupOccasionPlan.neverMind'), style: 'cancel' }, { text: t('ui.groupOccasionPlan.makeOrganizer'), onPress: () => handleToggleOrganizer(p) }]
                        );
                      } else if (canShareLink) {
                        handleShareGuestLink(p);
                      }
                    }}
                    accessibilityRole={(canPromote || canShareLink) ? 'button' : undefined}
                    accessibilityLabel={canPromote ? t('ui.groupOccasionPlan.makeAnOrganizerA11y', { name: p.displayName }) : (canShareLink ? t('ui.groupOccasionPlan.shareInviteLinkWithA11y', { name: p.displayName }) : undefined)}
                  >
                    <Text style={styles.participantText}>
                      {p.isGuest ? '🔗 ' : ''}{p.displayName}{isSelf ? t('ui.groupOccasionPlan.you') : ''} · {PARTICIPANT_STATUS_KEYS.includes(p.status) ? t(`ui.groupOccasionPlan.participantStatus.${p.status}`) : p.status}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {guests.length === 0 && <Text style={styles.helperText}>{t('ui.groupOccasionPlan.noOtherGuestsYet')}</Text>}
            </View>

            {canInviteMore && (
              <View style={{ marginBottom: spacing.md }}>
                <TouchableOpacity onPress={openInviteMore} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.inviteMoreGuestsA11y')}>
                  <Text style={styles.inviteMoreLink}>{inviteMoreOpen ? t('ui.groupOccasionPlan.inviteMoreGuests') : t('ui.groupOccasionPlan.inviteMoreGuests2')}</Text>
                </TouchableOpacity>
                {inviteMoreOpen && (
                  <View style={styles.inviteMorePanel}>
                    {loadingFriends && <NLoader fullScreen={false} size="inline" caption={t('ui.groupOccasionPlan.loadingFriends')} />}
                    {!loadingFriends && friendsLoaded && inviteMoreCandidates.length === 0 && (
                      <Text style={styles.helperText}>{t('ui.groupOccasionPlan.everyoneYoureConnectedWithIs')}</Text>
                    )}
                    {!loadingFriends && inviteMoreCandidates.length > 0 && (
                      <>
                        <View style={styles.chipRow}>
                          {inviteMoreCandidates.map((f) => {
                            const selected = selectedNewInviteeIds.has(f.id);
                            return (
                              <TouchableOpacity
                                key={f.id}
                                style={[styles.chip, selected && styles.chipSelected]}
                                onPress={() => toggleNewInvitee(f.id)}
                                activeOpacity={0.85}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                                accessibilityLabel={f.display_name}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                  {selected ? '✓ ' : ''}{f.display_name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <TouchableOpacity
                          style={[styles.addOptionButton, selectedNewInviteeIds.size === 0 && { opacity: 0.5 }]}
                          onPress={handleInviteMore}
                          disabled={selectedNewInviteeIds.size === 0 || invitingMore}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={t('ui.groupOccasionPlan.inviteMoreA11y', { size: selectedNewInviteeIds.size })}
                        >
                          <Text style={styles.addOptionButtonText}>{invitingMore ? t('ui.groupOccasionPlan.inviting') : t('ui.groupOccasionPlan.invite', { size: selectedNewInviteeIds.size })}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {/* Items 105 & 106 (CLAUDE.md): "make invitations
                        frictionless" extended to Occasion plans -- a guest
                        who isn't (yet) a Nearby user gets a real link they
                        can view and RSVP from with zero install. */}
                    <Text style={[styles.helperText, { marginTop: spacing.sm, marginBottom: spacing.xs }]}>
                      {t('ui.groupOccasionPlan.orInviteSomeoneWhoIsnt')}
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder={t('ui.groupOccasionPlan.theirNameEGJohn')}
                      placeholderTextColor={colors.textTertiary}
                      value={guestName}
                      onChangeText={setGuestName}
                      accessibilityLabel={t('ui.groupOccasionPlan.guestsNameA11y')}
                    />
                    <TouchableOpacity
                      style={[styles.addOptionButton, !guestName.trim() && { opacity: 0.5 }]}
                      onPress={handleInviteGuest}
                      disabled={!guestName.trim() || invitingGuest}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.groupOccasionPlan.sendAShareableInviteLinkA11y')}
                    >
                      <Text style={styles.addOptionButtonText}>{invitingGuest ? t('ui.groupOccasionPlan.creatingLink') : t('ui.groupOccasionPlan.getInviteLink')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <Text style={styles.sectionLabel}>{t('ui.groupOccasionPlan.whatShouldWeDo')}</Text>
            {detail.options.length === 0 && (
              <Text style={styles.helperText}>{t('ui.groupOccasionPlan.noIdeasYetBeThe')}</Text>
            )}
            {detail.options.map((option) => {
              const meta = activityMeta(option.activityType);
              return (
                <View key={option.id} style={styles.optionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{meta.icon} {option.label || meta.label}</Text>
                    <Text style={styles.optionSubtitle}>{t('ui.groupOccasionPlan.votes', { count: option.voteCount })}</Text>
                  </View>
                  {canVote && (
                    <TouchableOpacity
                      style={[styles.voteButton, option.myVote && styles.voteButtonActive]}
                      onPress={() => handleToggleVote(option)}
                      disabled={acting}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={option.myVote ? t('ui.groupOccasionPlan.removeVoteA11y') : t('ui.groupOccasionPlan.voteForThisA11y')}
                    >
                      <Text style={[styles.voteButtonText, option.myVote && styles.voteButtonTextActive]}>{option.myVote ? t('ui.groupOccasionPlan.voted') : t('ui.groupOccasionPlan.vote')}</Text>
                    </TouchableOpacity>
                  )}
                  {detail.isHost && (
                    <TouchableOpacity
                      style={styles.decideLink}
                      onPress={() => handleDecide(option)}
                      disabled={acting}
                      accessibilityRole="button"
                      accessibilityLabel={t('ui.groupOccasionPlan.decideOnA11y2', { label: option.label || meta.label })}
                    >
                      <Text style={styles.decideLinkText}>{t('ui.groupOccasionPlan.pick')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {canVote && detail.options.length < 8 && (
              <View style={styles.proposeCard}>
                <Text style={styles.sublabel}>{t('ui.groupOccasionPlan.proposeAnIdea')}</Text>
                <View style={styles.chipRow}>
                  {ACTIVITY_OPTIONS.map((o) => {
                    const selected = proposeType === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setProposeType(o.key); }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={activityMeta(o.key).label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {activityMeta(o.key).label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder={t('ui.groupOccasionPlan.addAShortNoteOptional')}
                  placeholderTextColor={colors.textTertiary}
                  value={proposeLabel}
                  onChangeText={setProposeLabel}
                  accessibilityLabel={t('ui.groupOccasionPlan.optionalNoteForThisIdeaA11y')}
                />
                <TouchableOpacity style={styles.addOptionButton} onPress={handlePropose} disabled={acting} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.addThisIdeaA11y')}>
                  <Text style={styles.addOptionButtonText}>{acting ? t('ui.groupOccasionPlan.adding') : t('ui.groupOccasionPlan.addIdea')}</Text>
                </TouchableOpacity>
              </View>
            )}

          </>
        )}
        {detail.isHost && ['voting', 'voting_business', 'decided', 'fulfilled'].includes(detail.status) && (
          <TouchableOpacity style={styles.cancelLink} onPress={handleCancel} disabled={acting} accessibilityRole="button" accessibilityLabel={t('ui.groupOccasionPlan.cancelThisPlanA11y')}>
            <Text style={styles.cancelLinkText}>{t('ui.groupOccasionPlan.cancelThisPlan2')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      <CancellationReasonSheet ask={reasonAsk} onClose={() => setReasonAsk(null)} />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary },
  subheader: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyText: { color: colors.textTertiary },
  // Item 112 follow-up (CLAUDE.md, "Surprise Mode could have its own
  // visual language... the screen subtly changes"): a distinct
  // surprise/violet register (colors.surprise/surpriseMuted, theme.js),
  // not the same coral primaryMuted every other banner on this screen
  // uses -- so surprise mode is visually distinguishable at a glance, not
  // just a differently-worded coral box.
  surpriseBanner: {
    backgroundColor: colors.surpriseMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.surprise,
    padding: spacing.md, marginBottom: spacing.lg, alignItems: 'stretch',
  },
  surpriseBannerText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  surpriseRevealRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm,
  },
  surpriseRevealLabel: { color: colors.surprise, fontSize: 13, fontWeight: '700' },
  surpriseRevealButton: {
    backgroundColor: colors.surprise, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
  },
  surpriseRevealButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  recommendationBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  recommendationText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  inviteRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  declineButton: { flex: 1, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, alignItems: 'center' },
  declineButtonText: { color: colors.textSecondary, fontWeight: '700' },
  acceptButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', ...shadow.button },
  acceptButtonText: { color: '#fff', fontWeight: '700' },
  decidedCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center',
  },
  decidedLabel: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs },
  decidedChoice: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  decideButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, paddingHorizontal: spacing.lg, ...shadow.button },
  decideButtonText: { color: '#fff', fontWeight: '700' },
  sectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
  participantsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  participantChip: { backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  participantText: { color: colors.textSecondary, fontSize: 12 },
  inviteMoreLink: { color: colors.primary, fontWeight: '700', fontSize: 13, marginBottom: spacing.xs },
  inviteMorePanel: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.xs,
  },
  helperText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.md },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.xs,
  },
  optionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  optionSubtitle: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  voteButton: { paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  voteButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  voteButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  voteButtonTextActive: { color: '#fff' },
  decideLink: { paddingHorizontal: spacing.sm, paddingVertical: 8 },
  decideLinkText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  proposeCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  sublabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  input: { backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.sm, fontSize: 14, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  addOptionButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 12, alignItems: 'center' },
  addOptionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelLink: { alignItems: 'center', paddingVertical: spacing.lg },
  cancelLinkText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
});
