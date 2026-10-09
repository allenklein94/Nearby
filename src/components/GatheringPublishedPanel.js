import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import EmptyCopy from './EmptyCopy';
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, Share, Animated } from 'react-native';
import { NLoader, showSuccessToast } from '../motion';
import { getFriendsWithSharedContext, isFirstGatheringHosted, gatheringInviteShareUrl } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { sendInvite } from '../services/invites';
import { getMyCircles } from '../services/friendCircles';
import { NearbyMark } from './brand';
import * as Haptics from 'expo-haptics';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

import { MOTION_BUDGET, SEQUENCES, AMBIENT } from '../motion/motionBudget';
import { inviteSentConfirmation } from '../utils/actionConfirmations';
// Replaces the old plain Alert.alert('Posted!', ...) dead end with two
// real actions — a working shareable deep link (needs the `linking`
// config added to RootNavigator.js; a "shareable link" that silently
// does nothing when tapped is exactly the class of bug this codebase
// has caught before) and friends-only "Invite Connections" (locked
// decision #3 — never nearby strangers, even ones the recommendation
// engine would score as a good match).
// Screen-reduction audit B5 (2026-10-09): this was its own screen (GatheringConfirmation) that publishing replaced Create
// with, and its Done then replaced it with the gathering. Publishing now lands on GatheringDetail, which shows this panel
// once at the top (route param justPublished); Done / "I'll do this later" just closes it, so the host is already on
// their gathering and Back returns where they started Create from.
export default function GatheringPublishedPanel({ gathering, gatheringId, placeName, businessesAsked, preInviteResult, onDone, navigation }) {
  const { t, language } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  // Celebrate Something's suggested friends are preselected on Create's own invite step (item 109) and sent at publish,
  // so they arrive here as preInviteResult, not as a second suggestion.

  const [isFirstHosted, setIsFirstHosted] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [invitedIds, setInvitedIds] = useState({});
  const [invitingId, setInvitingId] = useState(null);
  const [circles, setCircles] = useState([]);
  const [invitingCircleId, setInvitingCircleId] = useState(null);
  // Item 57 ("N mark as product language ... success confirmation"): this
  // is the app's one real, already-existing celebration screen (the 🎉
  // emoji + haptic below), and the single flagship spot for the brand mark
  // to make a "confirmed by Nearby" moment — not a replacement for the
  // celebratory emoji, a small addition above it. Same spring-in shape
  // MatchAnimation (src/motion/) already established for a celebration entrance.
  const markScale = useRef(new Animated.Value(0.7)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.parallel([
      Animated.spring(markScale, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(markOpacity, { toValue: 1, duration: MOTION_BUDGET.medium.ms, useNativeDriver: true }),
    ]).start();
    isFirstGatheringHosted().then(setIsFirstHosted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatheringId]);

  async function handleShare() {
    try {
      // Item 72 (CLAUDE.md): a plain https link, not a bare nearby://
      // deep link -- this one works for anyone, app installed or not.
      const shareUrl = gatheringInviteShareUrl(gatheringId);
      await Share.share({
        message: placeName
          ? t('ui.gatheringConfirmation.shareMessageAt', { title: gathering?.title ?? t('ui.gatheringConfirmation.myGathering'), place: placeName, url: shareUrl })
          : t('ui.gatheringConfirmation.shareMessage', { title: gathering?.title ?? t('ui.gatheringConfirmation.myGathering'), url: shareUrl }),
        url: shareUrl,
      });
    } catch (e) {
      // Share sheet cancellation isn't an error worth surfacing.
    }
  }

  async function handleOpenInvite() {
    setShowInvite(true);
    if (friends.length > 0 || loadingFriends) return;
    setLoadingFriends(true);
    const [list, myCircles] = await Promise.all([
      getFriendsWithSharedContext(gathering?.host_id),
      // P1 item 2 (CLAUDE.md, Aug 28 Full Coherence Audit): the first
      // real downstream use for Friend Circles -- fetched alongside
      // friends, not a new lazy step, so "Invite a Circle" is available
      // the instant the friend list itself renders. A circle-less
      // account (the common case today) sees nothing extra -- getMyCircles()
      // already returns [] rather than a fabricated placeholder.
      getMyCircles(),
    ]);
    setFriends(list);
    setCircles(myCircles);
    const urlEntries = await Promise.all(
      list.map(async (f) => {
        if (!f.photo_url) return [f.id, null];
        return [f.id, await getSignedPhotoUrl(f.photo_url)];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));
    setLoadingFriends(false);
  }

  async function handleInvite(friendId) {
    setInvitingId(friendId);
    try {
      await sendInvite('gathering', gatheringId, friendId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInvitedIds((prev) => ({ ...prev, [friendId]: true }));
      showSuccessToast(...inviteSentConfirmation(friends.find((f) => f.id === friendId)?.display_name));
    } catch (e) {
      presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => handleInvite(friendId) });
    }
    setInvitingId(null);
  }

  // Real member ids, scoped down to whoever is both (a) a genuine
  // circle member and (b) actually present in this gathering's own
  // real friends-with-shared-context list -- a circle can reference a
  // friend id that's since been removed or, in principle, doesn't share
  // this specific gathering's context, and this never invites anyone
  // getFriendsWithSharedContext() itself didn't already surface as real,
  // inviteable friend.
  function circleInviteTargets(circle) {
    return circle.memberIds.filter((id) => friends.some((f) => f.id === id) && !invitedIds[id]);
  }

  // A real, itemized bulk send -- one sendInvite() call per real member,
  // matching handleInvite()'s own single-friend shape exactly, no new
  // RPC. Matches this screen's own already-established "honest count,
  // never a fabricated 'invites sent!' claim" convention (see the
  // preInviteResult note above) -- a partial failure across several real
  // sends is disclosed, not silently swallowed.
  async function handleInviteCircle(circle) {
    const targetIds = circleInviteTargets(circle);
    if (targetIds.length === 0) return;
    setInvitingCircleId(circle.id);
    const results = await Promise.allSettled(
      targetIds.map((id) => sendInvite('gathering', gatheringId, id))
    );
    const newlyInvited = {};
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') newlyInvited[targetIds[i]] = true;
    });
    if (Object.keys(newlyInvited).length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setInvitedIds((prev) => ({ ...prev, ...newlyInvited }));
    }
    const failedCount = results.length - Object.keys(newlyInvited).length;
    if (failedCount > 0) {
      Alert.alert(
        t('ui.gatheringConfirmation.someInvitesDidntGoThrough'),
        t('ui.gatheringConfirmation.invitedOfInTryThe', { sent: Object.keys(newlyInvited).length, total: targetIds.length, name: circle.name })
      );
    }
    setInvitingCircleId(null);
  }

  function handleDone() {
    onDone?.();
  }

  const categoryStyle = categoryStyleFor(gathering?.interest_tag);

  return (
    <View style={styles.container}>
        <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }], marginBottom: spacing.xs }}>
          <NearbyMark size={40} />
        </Animated.View>
        <Text style={styles.celebrateIcon}>{isFirstHosted ? '🎉🌟' : '🎉'}</Text>
        <Text style={styles.title}>{isFirstHosted ? t('ui.gatheringConfirmation.yourFirstGatheringIsLive') : t('ui.gatheringConfirmation.yourGatheringIsLive')}</Text>
        <Text style={styles.subtitle}>
          {isFirstHosted ? t('ui.gatheringConfirmation.youreOfficiallyAHostLets') : t('ui.gatheringConfirmation.nowLetsHelpPeopleDiscover')}
        </Text>

        <View style={[styles.summaryCard, { borderColor: categoryStyle.color }]}>
          <Text style={styles.summaryIcon}>{categoryStyle.icon}</Text>
          <Text style={styles.summaryTitle}>{gathering?.title}</Text>
        </View>

        {businessesAsked && (
          <Text style={styles.businessAskedNote}>{t('ui.gatheringConfirmation.wellLookForLocalBusiness')}</Text>
        )}

        {/* Phase 4 (see CLAUDE.md's "build everything" plan): "Make a
            plan" sends invites as part of its own one-tap Confirm, before
            ever landing here -- an honest count, not a fabricated
            "invites sent!" claim, since a partial failure among the
            selected friends is a real, disclosed possibility (this whole
            phase deliberately isn't one atomic transaction). */}
        {preInviteResult && (
          <Text style={styles.businessAskedNote}>
            {t('ui.gatheringConfirmation.weInvited', { sent: preInviteResult.sent, count: preInviteResult.total })}
          </Text>
        )}

        {!showInvite ? (
          <View style={{ width: '100%' }}>
            <TouchableOpacity style={styles.actionButton} onPress={handleShare} activeOpacity={0.85} accessibilityLabel={t('ui.gatheringConfirmation.shareGatheringA11y')} accessibilityRole="button">
              <Text style={styles.actionButtonText}>{t('ui.gatheringConfirmation.shareGathering')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} onPress={handleOpenInvite} activeOpacity={0.85} accessibilityLabel={t('ui.gatheringConfirmation.inviteConnectionsA11y')} accessibilityRole="button">
              <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>{t('ui.gatheringConfirmation.inviteConnections')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel={t('ui.gatheringConfirmation.doneA11y')} accessibilityRole="button">
              <Text style={styles.doneLink}>{t('ui.gatheringConfirmation.illDoThisLater')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: '100%' }}>
            <Text style={styles.inviteHeader}>{t('ui.gatheringConfirmation.inviteConnections2')}</Text>
            <Text style={styles.inviteSubtext}>{t('ui.gatheringConfirmation.onlyPeopleYoureAlreadyFriends')}</Text>
            {!loadingFriends && circles.length > 0 && (
              <View style={styles.circleRow}>
                {circles.map((circle) => {
                  const targetCount = circleInviteTargets(circle).length;
                  const isEmpty = circle.memberIds.length === 0;
                  const allInvited = !isEmpty && targetCount === 0;
                  const label = allInvited
                    ? `✓ ${circle.name}`
                    : isEmpty
                    ? t('ui.gatheringConfirmation.circleEmpty', { name: circle.name })
                    : t('ui.gatheringConfirmation.inviteCircle', { name: circle.name, count: targetCount });
                  return (
                    <TouchableOpacity
                      key={circle.id}
                      style={[styles.circleChip, (allInvited || isEmpty) && styles.circleChipDone]}
                      onPress={() => handleInviteCircle(circle)}
                      disabled={invitingCircleId === circle.id || targetCount === 0}
                      accessibilityLabel={allInvited ? t('ui.gatheringConfirmation.everyoneInAlreadyInvitedA11y', { name: circle.name }) : isEmpty ? t('ui.gatheringConfirmation.hasNoMembersYetA11y', { name: circle.name }) : t('ui.gatheringConfirmation.inviteEveryoneInA11y', { name: circle.name })}
                      accessibilityRole="button"
                    >
                      {invitingCircleId === circle.id ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={[styles.circleChipText, (allInvited || isEmpty) && styles.circleChipTextDone]}>{label}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {loadingFriends ? (
              <NLoader fullScreen={false} size="inline" caption={t('ui.gatheringConfirmation.loadingFriends')} />
            ) : friends.length === 0 ? (
              <View style={{ alignItems: 'center' }}>
                <EmptyCopy id="no_friends_to_invite" />
                <TouchableOpacity onPress={() => navigation.navigate('FriendDiscovery')} accessibilityLabel={t('ui.gatheringConfirmation.discoverPeopleToAddAsA11y')} accessibilityRole="button">
                  <Text style={styles.emptyActionText}>{t('ui.gatheringConfirmation.discoverPeople')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              friends
                .map((f) => {
                  return (
                    <View key={f.id} style={styles.friendRow}>
                      {photoUrls[f.id] ? (
                        <Image source={{ uri: photoUrls[f.id] }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.friendName}>{f.display_name}</Text>
                        {f.sharedContext && <Text style={styles.friendContext}>{f.sharedContext}</Text>}
                      </View>
                      <TouchableOpacity
                        style={[styles.inviteButton, invitedIds[f.id] && styles.inviteButtonSent]}
                        onPress={() => handleInvite(f.id)}
                        disabled={invitingId === f.id || invitedIds[f.id]}
                        accessibilityLabel={invitedIds[f.id] ? t('ui.gatheringConfirmation.inviteSentA11y') : t('ui.gatheringConfirmation.inviteA11y', { name: f.display_name })}
                        accessibilityRole="button"
                      >
                        {invitingId === f.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.inviteButtonText}>{invitedIds[f.id] ? t('ui.gatheringConfirmation.sent') : t('ui.gatheringConfirmation.invite')}</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })
            )}
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel={t('ui.gatheringConfirmation.doneA11y')} accessibilityRole="button">
              <Text style={styles.doneLink}>{t('ui.gatheringConfirmation.done')}</Text>
            </TouchableOpacity>
          </View>
        )}
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: spacing.xl, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.md },
  celebrateIcon: { fontSize: 48, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: spacing.lg },
  summaryCard: {
    width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, marginBottom: spacing.xl, ...shadow.card,
  },
  summaryIcon: { fontSize: 28, marginRight: spacing.md },
  summaryTitle: { ...typography.headline, color: colors.textPrimary, flex: 1 },
  businessAskedNote: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  actionButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16,
    alignItems: 'center', marginBottom: spacing.sm, ...shadow.button,
  },
  actionButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowOpacity: 0 },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  actionButtonTextSecondary: { color: colors.textPrimary },
  doneLink: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
  inviteHeader: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  inviteSubtext: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.lg },
  circleRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md, gap: spacing.sm },
  circleChip: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: 8, minHeight: 32, justifyContent: 'center',
  },
  circleChipDone: { backgroundColor: colors.surfaceElevated },
  circleChipText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  circleChipTextDone: { color: colors.textTertiary },
  emptyText: { color: colors.textTertiary, textAlign: 'center', paddingVertical: spacing.xl, lineHeight: 20 },
  emptyActionText: { color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: -spacing.sm, paddingBottom: spacing.md },
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  friendContext: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  inviteButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  inviteButtonSent: { backgroundColor: colors.success },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
