// Being in a gathering, on its own detail screen (screen-reduction audit B1, owner 2026-10-08): what used to be the separate
// GatheringHub screen. A gathering is ONE object with ONE detail screen (item 39); joining changes the viewer's state and the
// actions shown here, it never moves them to a second destination. Shown by GatheringDetailScreen to the host and to approved
// attendees only (the same people the Hub admitted); every read below is the one the Hub made, under the same rules:
// approved attendees are readable only to members and friends (item 75 RLS), people I blocked are left out of the meet list
// and get no notice button, the meet-up point is the host/attendee-only RPC. The day-of block keeps every Hub capability:
// "You're in" + bring someone (invite / share link) right after joining, Who You'll Meet + Send notice, ice breakers (open the
// group chat with the line drafted), Before you go (forecast + prep tips), Meet-up point + Uber, I'm on my way (a toggle) and
// I'm here (check in), and once checked in: who's here, Say hi, Photos. Not carried over, because the detail screen already
// has them: the title/meta header, the "View full details" / "Details" links (this IS the detail screen), the separate Group
// Chat button (Say hello / the host's Message chip), and the post-event feedback modal (the detail screen's own
// GatheringFeedbackPrompt for a past gathering, and Home's modal, record the same feedback).
import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, Share } from 'react-native';
import MeetupPointMap from './MeetupPointMap';
import {
  getGatheringMeetupPoint,
  setGatheringOnMyWay,
  unsetGatheringOnMyWay,
  checkInToGathering,
  getFirstTimerAttendeeIds,
  getHostStats,
  isFirstGatheringJoin,
  gatheringInviteShareUrl,
} from '../services/gatherings';
import { getSocialForecast } from '../services/homeDashboard';
import { getSignedPhotoUrl } from '../services/photos';
import { iceBreakersFor, prepTipsFor } from '../constants/gatheringHubContent';
import { categoryStyleFor, CATEGORY_BUTTON_TEXT_COLOR } from '../constants/gatheringCategoryStyles';
import { openUberToDestination } from '../utils/uberDeepLink';
import InviteFriendsModal from './InviteFriendsModal';
import { sendNoticeTo } from '../services/noticeActions';
import { getMyBlockedUsers } from '../services/blockedUsers';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getCountdownLabel, showsAttendingSection } from '../utils/gatheringAttending';

export default function GatheringAttendingSection({ gathering, gatheringId, navigation, justJoined = false, onChanged }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [firstTimerIds, setFirstTimerIds] = useState(new Set());
  const [meetupPoint, setMeetupPoint] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [onMyWayBusy, setOnMyWayBusy] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [showJoinedBanner, setShowJoinedBanner] = useState(!!justJoined);
  const [isFirstJoin, setIsFirstJoin] = useState(false);
  const [showGrowthPrompt, setShowGrowthPrompt] = useState(false);
  const [growthInviteModalVisible, setGrowthInviteModalVisible] = useState(false);
  const [sentNoticeTo, setSentNoticeTo] = useState({});
  // People I've blocked never show in the meet list (and get no notice button). Only my own blocks are
  // readable client-side (blocks RLS); counts elsewhere are unchanged.
  const [blockedIds, setBlockedIds] = useState(new Set());
  const [showAllAttendees, setShowAllAttendees] = useState(false);
  const [hostStats, setHostStats] = useState(null);

  const attendeeKey = (gathering?.approvedAttendees ?? []).map((a) => a.user_id).join(',');
  useEffect(() => {
    if (!showsAttendingSection(gathering)) return undefined;
    let cancelled = false;
    (async () => {
      let blocked = new Set();
      try {
        blocked = new Set((await getMyBlockedUsers()).map((b) => b.blocked_id));
      } catch (e) {
        console.error('GatheringAttendingSection blocked lookup failed', e);
      }
      if (cancelled) return;
      setBlockedIds(blocked);
      const others = gathering.approvedAttendees.filter((a) => a.user_id !== gathering.myAttendee?.user_id && !blocked.has(a.user_id));
      if (others.length > 0) {
        Promise.all(
          others.map(async (a) => {
            const path = a.profiles?.photo_url;
            if (!path) return null;
            return [a.user_id, await getSignedPhotoUrl(path)];
          })
        ).then((entries) => { if (!cancelled) setAttendeePhotoUrls(Object.fromEntries(entries.filter(Boolean))); });
        getFirstTimerAttendeeIds(gatheringId, others.map((a) => a.user_id)).then((ids) => { if (!cancelled) setFirstTimerIds(new Set(ids)); });
      }
      if (gathering.host_id) getHostStats(gathering.host_id).then((s) => { if (!cancelled) setHostStats(s); });
      getGatheringMeetupPoint(gatheringId).then((p) => { if (!cancelled) setMeetupPoint(p); });
      if (gathering.latitude != null && gathering.longitude != null) {
        getSocialForecast(gathering.latitude, gathering.longitude).then((f) => { if (!cancelled) setForecast(f); });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatheringId, gathering?.isHost, gathering?.myStatus, attendeeKey, gathering?.latitude, gathering?.longitude, gathering?.host_id]);

  useEffect(() => {
    if (justJoined) {
      setShowJoinedBanner(true);
      isFirstGatheringJoin().then(setIsFirstJoin);
    }
  }, [justJoined]);

  useEffect(() => {
    if (!showJoinedBanner) return undefined;
    const timer = setTimeout(() => {
      setShowJoinedBanner(false);
      // Shown once, right after an auto-approved join (justJoined is only set for that case), never for a pending
      // request or a waitlist spot (nothing to celebrate yet).
      setShowGrowthPrompt(true);
    }, 2200);
    return () => clearTimeout(timer);
  }, [showJoinedBanner]);

  if (!showsAttendingSection(gathering)) return null;

  async function handleGrowthShareLink() {
    try {
      const shareUrl = gatheringInviteShareUrl(gatheringId);
      await Share.share({
        message: t('ui.gatheringHub.shareMessage', { title: gathering?.title ?? t('ui.gatheringHub.thisGathering'), url: shareUrl }),
        url: shareUrl,
      });
    } catch (e) {
      // Share sheet cancellation isn't an error worth surfacing.
    }
    setShowGrowthPrompt(false);
  }

  async function handleOnMyWay() {
    setOnMyWayBusy(true);
    try {
      if (iAmOnMyWay) {
        await unsetGatheringOnMyWay(gatheringId);
      } else {
        await setGatheringOnMyWay(gatheringId);
      }
      await onChanged?.();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleOnMyWay() });
    }
    setOnMyWayBusy(false);
  }

  async function handleCheckIn() {
    setCheckInBusy(true);
    try {
      await checkInToGathering(gatheringId);
      await onChanged?.();
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleCheckIn() });
    }
    setCheckInBusy(false);
  }

  async function handleSendNotice(userId) {
    try {
      await sendNoticeTo(userId, false);
      setSentNoticeTo((prev) => ({ ...prev, [userId]: true }));
    } catch (e) {
      if (e.message === 'ALREADY_SENT') {
        Alert.alert(t('ui.gatheringHub.alreadySent'), t('ui.gatheringHub.youveAlreadyNoticedThisPerson'));
      } else {
        presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleSendNotice(userId) });
      }
    }
  }

  const categoryStyle = categoryStyleFor(gathering.interest_tag);
  const others = gathering.approvedAttendees.filter((a) => a.user_id !== gathering.myAttendee?.user_id && !blockedIds.has(a.user_id));
  const onTheWay = gathering.approvedAttendees.filter((a) => a.on_my_way_at);
  const checkedIn = gathering.approvedAttendees.filter((a) => a.checked_in_at);
  const iAmCheckedIn = !!gathering.myAttendee?.checked_in_at;
  const iAmOnMyWay = !!gathering.myAttendee?.on_my_way_at;
  const countdown = getCountdownLabel(gathering.scheduled_at);
  const isOver = countdown === null;

  // Every true fact stacks; only real signals already fetched above, never a single best-guess line.
  function meetPersonLines(attendee) {
    const lines = [];
    if (attendee.user_id === gathering.host_id) {
      lines.push('Organizer');
      if (hostStats?.gatherings_hosted > 0) {
        lines.push(`Hosted ${hostStats.gatherings_hosted} gathering${hostStats.gatherings_hosted === 1 ? '' : 's'}`);
      }
      return lines;
    }
    const theirInterests = attendee.profiles?.interests ?? [];
    const shared = (gathering.myInterests ?? []).filter((i) => theirInterests.includes(i));
    if (shared.length > 0) lines.push(`Also into ${shared.slice(0, 2).join(' and ')}`);
    if (firstTimerIds.has(attendee.user_id)) lines.push('First time here');
    if (lines.length === 0) lines.push(`Going to ${gathering.title}`);
    return lines;
  }

  return (
    <View style={styles.container}>
      {showJoinedBanner && (
        <View style={[styles.joinedBanner, { borderColor: categoryStyle.color, backgroundColor: categoryStyle.color + '20' }]}>
          <Text style={styles.joinedBannerTitle}>{isFirstJoin ? t('ui.gatheringHub.yourFirstGathering') : t('ui.gatheringHub.youreIn')}</Text>
          <Text style={styles.joinedBannerSub}>{gathering.title}</Text>
          {countdown && <Text style={styles.joinedBannerSub}>{countdown}</Text>}
          <Text style={styles.joinedBannerFoot}>
            {isFirstJoin ? t('ui.gatheringHub.thisIsTheStartOf') : t('ui.gatheringHub.wellHelpYouHaveA')}
          </Text>
        </View>
      )}

      {showGrowthPrompt && (
        <View style={[styles.growthPrompt, { borderColor: categoryStyle.color }]}>
          <Text style={styles.growthPromptTitle}>{t('ui.gatheringHub.wantToBringSomeone')}</Text>
          <TouchableOpacity
            style={[styles.growthAction, { backgroundColor: categoryStyle.color }]}
            onPress={() => setGrowthInviteModalVisible(true)}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.gatheringHub.inviteAFriendA11y')}
            accessibilityRole="button"
          >
            <Text style={styles.growthActionText}>{t('ui.gatheringHub.inviteAFriend')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.growthAction, styles.growthActionSecondary]}
            onPress={handleGrowthShareLink}
            activeOpacity={0.85}
            accessibilityLabel={t('ui.gatheringHub.shareLinkA11y')}
            accessibilityRole="button"
          >
            <Text style={[styles.growthActionText, styles.growthActionTextSecondary]}>{t('ui.gatheringHub.shareLink')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowGrowthPrompt(false)} style={{ marginTop: spacing.xs }} accessibilityLabel={t('ui.gatheringHub.skipA11y')} accessibilityRole="button">
            <Text style={styles.growthSkip}>{t('ui.gatheringHub.skip')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {iAmCheckedIn ? (
        <View style={styles.duringPanel}>
          <Text style={styles.duringTitle}>{t('ui.gatheringHub.haveFun')}</Text>
          <Text style={styles.duringSub}>{t('ui.gatheringHub.wellSeeYouAfterwards')}</Text>

          {checkedIn.length > 0 && (
            <View style={styles.whosHereRow}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringHub.whosHere')}</Text>
              <Text style={styles.whosHereText}>
                {t('ui.gatheringHub.checkedIn', { count: checkedIn.length })}
              </Text>
            </View>
          )}

          <View style={styles.duringActionsRow}>
            <TouchableOpacity
              style={styles.duringAction}
              onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
              accessibilityLabel={t('ui.gatheringHub.sayHiInGroupChatA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.duringActionText}>{t('ui.gatheringHub.sayHi')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.duringAction}
              onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title })}
              accessibilityLabel={t('ui.gatheringHub.shareAPhotoA11y')}
              accessibilityRole="button"
            >
              <Text style={styles.duringActionText}>{t('ui.gatheringHub.photos')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          {others.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringHub.whoYoullMeet')}</Text>
              {(showAllAttendees ? others : others.slice(0, 5)).map((a) => (
                <View key={a.user_id} style={styles.meetRowWrap}>
                  <TouchableOpacity
                    style={[styles.meetRow, { flex: 1, marginBottom: 0 }]}
                    onPress={() => navigation.navigate('ViewProfile', { userId: a.user_id })}
                    accessibilityLabel={t('ui.gatheringHub.viewSProfileA11y', { name: a.profiles?.display_name })}
                    accessibilityRole="button"
                  >
                    {attendeePhotoUrls[a.user_id] ? (
                      <Image source={{ uri: attendeePhotoUrls[a.user_id] }} style={styles.meetAvatar} />
                    ) : (
                      <View style={[styles.meetAvatar, styles.meetAvatarPlaceholder]} />
                    )}
                    <View>
                      <Text style={styles.meetName}>{a.profiles?.display_name}</Text>
                      {meetPersonLines(a).map((line, i) => (
                        <Text key={i} style={styles.meetLine}>{line}</Text>
                      ))}
                    </View>
                  </TouchableOpacity>
                  {!gathering.isHost && (
                    sentNoticeTo[a.user_id] ? (
                      <Text style={styles.noticeSentText}>{t('ui.gatheringHub.noticeSent')}</Text>
                    ) : (
                      <TouchableOpacity
                        style={styles.noticeButton}
                        onPress={() => handleSendNotice(a.user_id)}
                        accessibilityLabel={t('ui.gatheringHub.sendANoticeToA11y', { name: a.profiles?.display_name })}
                        accessibilityRole="button"
                      >
                        <Text style={styles.noticeButtonText}>{t('ui.gatheringHub.sendNotice')}</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              ))}
              {others.length > 5 && (
                <TouchableOpacity onPress={() => setShowAllAttendees((v) => !v)} accessibilityRole="button" accessibilityLabel={showAllAttendees ? t('ui.gatheringHub.showFewerA11y') : t('ui.gatheringHub.showAllA11y', { count: others.length })}>
                  <Text style={styles.showAllText}>{showAllAttendees ? t('ui.gatheringHub.showFewer') : t('ui.gatheringHub.showAll', { count: others.length })}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('ui.gatheringHub.iceBreakers')}</Text>
            <View style={styles.chipsWrap}>
              {iceBreakersFor(gathering.interest_tag).map((starter) => (
                <TouchableOpacity
                  key={starter}
                  style={styles.iceChip}
                  onPress={() => navigation.navigate('GatheringChat', { gatheringId, gatheringTitle: gathering.title, draftText: starter })}
                  accessibilityLabel={t('ui.gatheringHub.sendConversationStarterA11y', { starter: starter })}
                  accessibilityRole="button"
                >
                  <Text style={styles.iceChipText}>{starter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>


          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('ui.gatheringHub.beforeYouGo')}</Text>
            {forecast && (
              <Text style={styles.checklistItem}>☀️ {forecast.forecast_label}{forecast.forecast_detail ? ` — ${forecast.forecast_detail}` : ''}</Text>
            )}
            {prepTipsFor(gathering.interest_tag).map((tip) => (
              <Text key={tip} style={styles.checklistItem}>✓ {tip}</Text>
            ))}
          </View>

          {meetupPoint && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('ui.gatheringHub.meetUpPoint')}</Text>
              <MeetupPointMap point={meetupPoint} color={categoryStyle.color} style={styles.map} />
              <TouchableOpacity
                style={styles.uberLink}
                onPress={() => openUberToDestination({ ...meetupPoint, nickname: gathering.title })}
                accessibilityLabel={t('ui.gatheringHub.getAnUberThereA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.uberLinkText}>{t('ui.gatheringHub.getAnUberThere')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {!gathering.isHost && !isOver && (
            <View style={styles.section}>
              {onTheWay.length > 0 && (
                <Text style={styles.onTheWayText}>
                  {t('ui.gatheringHub.onTheWay', { count: onTheWay.length })}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.bigButton, { backgroundColor: iAmOnMyWay ? colors.surface : categoryStyle.color, borderWidth: iAmOnMyWay ? 1 : 0, borderColor: colors.border }, shadow.button]}
                onPress={handleOnMyWay}
                disabled={onMyWayBusy}
                activeOpacity={0.85}
                accessibilityLabel={iAmOnMyWay ? t('ui.gatheringHub.youreOnYourWayTapA11y') : t('ui.gatheringHub.imOnMyWayA11y')}
                accessibilityRole="button"
              >
                <Text style={[styles.bigButtonText, iAmOnMyWay && { color: colors.textSecondary }]}>
                  {iAmOnMyWay ? t('ui.gatheringHub.onYourWayTapTo') : t('ui.gatheringHub.imOnMyWay')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.checkInLink}
                onPress={handleCheckIn}
                disabled={checkInBusy}
                accessibilityLabel={t('ui.gatheringHub.imHereCheckInA11y')}
                accessibilityRole="button"
              >
                <Text style={styles.checkInLinkText}>{t('ui.gatheringHub.imHereCheckIn')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <InviteFriendsModal
        visible={growthInviteModalVisible}
        onClose={() => {
          setGrowthInviteModalVisible(false);
          setShowGrowthPrompt(false);
        }}
        gatheringId={gatheringId}
        gatheringTitle={gathering.title}
      />
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { marginTop: spacing.md },
  joinedBanner: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  joinedBannerTitle: { ...typography.title, color: colors.textPrimary },
  joinedBannerSub: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 2 },
  joinedBannerFoot: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm },
  growthPrompt: {
    borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, alignItems: 'center',
    marginBottom: spacing.lg, backgroundColor: colors.surface,
  },
  growthPromptTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  growthAction: { width: '100%', borderRadius: radius.full, paddingVertical: 14, alignItems: 'center', marginBottom: spacing.sm },
  growthActionSecondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  // Aug 30 2026 -- dark, not white: this is the base color for the primary
  // ("Invite a Friend", solid categoryStyle.color fill) variant; the
  // secondary ("Share Link") variant still correctly overrides via
  // growthActionTextSecondary, applied later in the same style array. See
  // gatheringCategoryStyles.js's own CATEGORY_BUTTON_TEXT_COLOR comment
  // for the measured white-on-PALETTE contrast failure this fixes.
  growthActionText: { color: CATEGORY_BUTTON_TEXT_COLOR, fontWeight: '700', fontSize: 15 },
  growthActionTextSecondary: { color: colors.textPrimary },
  growthSkip: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  section: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  sectionLabel: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  meetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  meetRowWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  noticeButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  noticeButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  noticeSentText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  showAllText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  meetAvatar: { width: 44, height: 44, borderRadius: 22 },
  meetAvatarPlaceholder: { backgroundColor: colors.border },
  meetName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  meetLine: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iceChip: { backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iceChipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  checklistItem: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.xs },
  map: { width: '100%', height: 180, borderRadius: radius.lg },
  onTheWayText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm, textAlign: 'center' },
  bigButton: { borderRadius: radius.full, paddingVertical: spacing.md, alignItems: 'center' },
  // Aug 30 2026 -- this is the base ("I'M ON MY WAY", solid
  // categoryStyle.color fill) color; the active ("✓ ON YOUR WAY", plain
  // colors.surface fill) state still correctly overrides to
  // colors.textSecondary via the inline `iAmOnMyWay && {...}` spread at
  // its own render site, applied after this base style. See
  // gatheringCategoryStyles.js's own CATEGORY_BUTTON_TEXT_COLOR comment.
  bigButtonText: { color: CATEGORY_BUTTON_TEXT_COLOR, fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  checkInLink: { marginTop: spacing.md, alignItems: 'center' },
  checkInLinkText: { color: colors.textTertiary, fontSize: 13, fontWeight: '600' },
  uberLink: { marginTop: spacing.sm, alignItems: 'center' },
  uberLinkText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  duringPanel: { marginTop: spacing.xl, alignItems: 'center', padding: spacing.lg },
  duringTitle: { ...typography.title, color: colors.textPrimary },
  duringSub: { color: colors.textSecondary, fontSize: 14, marginTop: 4 },
  whosHereRow: { marginTop: spacing.xl, alignItems: 'center' },
  whosHereText: { color: colors.textSecondary, fontSize: 13 },
  duringActionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  duringAction: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  duringActionText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
});
