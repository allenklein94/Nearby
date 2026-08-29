import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, Share } from 'react-native';
import { getGatheringById, getFriendsWithSharedContext, isFirstGatheringHosted } from '../services/gatherings';
import { getSignedPhotoUrl } from '../services/photos';
import { sendInvite } from '../services/invites';
import { getMyCircles } from '../services/friendCircles';
import LoadErrorState from '../components/LoadErrorState';
import * as Haptics from 'expo-haptics';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Replaces the old plain Alert.alert('Posted!', ...) dead end with two
// real actions — a working shareable deep link (needs the `linking`
// config added to RootNavigator.js; a "shareable link" that silently
// does nothing when tapped is exactly the class of bug this codebase
// has caught before) and friends-only "Invite Connections" (locked
// decision #3 — never nearby strangers, even ones the recommendation
// engine would score as a good match).
export default function GatheringConfirmationScreen({ route, navigation }) {
  const { gatheringId, placeName, businessesAsked, preInviteResult } = route.params;
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [gathering, setGathering] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isFirstHosted, setIsFirstHosted] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [invitedIds, setInvitedIds] = useState({});
  const [invitingId, setInvitingId] = useState(null);
  const [circles, setCircles] = useState([]);
  const [invitingCircleId, setInvitingCircleId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const g = await getGatheringById(gatheringId);
      setGathering(g);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [gatheringId]);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    load();
    isFirstGatheringHosted().then(setIsFirstHosted);
  }, [gatheringId, load]);

  async function handleShare() {
    try {
      await Share.share({
        message: `Join me: ${gathering?.title ?? 'my gathering'}${placeName ? ` at ${placeName}` : ''} — nearby://gathering/${gatheringId}`,
        url: `nearby://gathering/${gatheringId}`,
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
    } catch (e) {
      Alert.alert('Error', e.message);
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
        'Some invites didn\'t go through',
        `Invited ${Object.keys(newlyInvited).length} of ${targetIds.length} in "${circle.name}" — try the rest individually below.`
      );
    }
    setInvitingCircleId(null);
  }

  function handleDone() {
    navigation.replace('GatheringDetail', { gatheringId });
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: spacing.sm, color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>Loading your gathering...</Text>
      </View>
    );
  }

  if (loadError) {
    // gestureEnabled is deliberately false on this modal (RootNavigator),
    // and there's no back button by design -- but that means a real load
    // failure here previously had *zero* way out, only a retry. handleDone
    // only ever needs the route's own gatheringId (already known, the
    // gathering itself was already created successfully before this
    // screen even loaded), not the fetched `gathering` state, so it works
    // fine here too -- a real, working escape, not just a retry loop.
    return (
      <View style={styles.loadingContainer}>
        <LoadErrorState message="Couldn't load your gathering." onRetry={load} />
        <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel="Continue to your gathering" accessibilityRole="button">
          <Text style={styles.doneLink}>Continue to your gathering →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const categoryStyle = categoryStyleFor(gathering?.interest_tag);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl, alignItems: 'center' }}>
        <Text style={styles.celebrateIcon}>{isFirstHosted ? '🎉🌟' : '🎉'}</Text>
        <Text style={styles.title}>{isFirstHosted ? 'Your First Gathering Is Live!' : 'Your gathering is live!'}</Text>
        <Text style={styles.subtitle}>
          {isFirstHosted ? "You're officially a host — let's help people discover it." : "Now let's help people discover it."}
        </Text>

        <View style={[styles.summaryCard, { borderColor: categoryStyle.color }]}>
          <Text style={styles.summaryIcon}>{categoryStyle.icon}</Text>
          <Text style={styles.summaryTitle}>{gathering?.title}</Text>
        </View>

        {businessesAsked && (
          <Text style={styles.businessAskedNote}>🍽️ We'll look for local business options once real people have joined — check back on your gathering to see.</Text>
        )}

        {/* Phase 4 (see CLAUDE.md's "build everything" plan): "Make a
            plan" sends invites as part of its own one-tap Confirm, before
            ever landing here -- an honest count, not a fabricated
            "invites sent!" claim, since a partial failure among the
            selected friends is a real, disclosed possibility (this whole
            phase deliberately isn't one atomic transaction). */}
        {preInviteResult && (
          <Text style={styles.businessAskedNote}>
            🤝 We invited {preInviteResult.sent} of {preInviteResult.total} {preInviteResult.total === 1 ? 'person' : 'people'} you picked.
          </Text>
        )}

        {!showInvite ? (
          <View style={{ width: '100%' }}>
            <TouchableOpacity style={styles.actionButton} onPress={handleShare} activeOpacity={0.85} accessibilityLabel="Share Gathering" accessibilityRole="button">
              <Text style={styles.actionButtonText}>🔗 Share Gathering</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} onPress={handleOpenInvite} activeOpacity={0.85} accessibilityLabel="Invite Connections" accessibilityRole="button">
              <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>🤝 Invite Connections</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.doneLink}>I'll do this later</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: '100%' }}>
            <Text style={styles.inviteHeader}>Invite Connections</Text>
            <Text style={styles.inviteSubtext}>Only people you're already friends with — never nearby strangers.</Text>
            {!loadingFriends && circles.length > 0 && (
              <View style={styles.circleRow}>
                {circles.map((circle) => {
                  const targetCount = circleInviteTargets(circle).length;
                  const isEmpty = circle.memberIds.length === 0;
                  const allInvited = !isEmpty && targetCount === 0;
                  const label = allInvited
                    ? `✓ ${circle.name}`
                    : isEmpty
                    ? `${circle.name} (empty)`
                    : `🏷️ Invite ${circle.name} (${targetCount})`;
                  return (
                    <TouchableOpacity
                      key={circle.id}
                      style={[styles.circleChip, (allInvited || isEmpty) && styles.circleChipDone]}
                      onPress={() => handleInviteCircle(circle)}
                      disabled={invitingCircleId === circle.id || targetCount === 0}
                      accessibilityLabel={allInvited ? `Everyone in ${circle.name} already invited` : isEmpty ? `${circle.name} has no members yet` : `Invite everyone in ${circle.name}`}
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
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : friends.length === 0 ? (
              <Text style={styles.emptyText}>Add some friends first to be able to invite them here.</Text>
            ) : (
              friends.map((f) => (
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
                    accessibilityLabel={invitedIds[f.id] ? 'Invite sent' : `Invite ${f.display_name}`}
                    accessibilityRole="button"
                  >
                    {invitingId === f.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.inviteButtonText}>{invitedIds[f.id] ? '✓ Sent' : 'Invite'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity onPress={handleDone} style={{ marginTop: spacing.lg }} accessibilityLabel="Done" accessibilityRole="button">
              <Text style={styles.doneLink}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
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
  friendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: {},
  friendName: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  friendContext: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  inviteButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  inviteButtonSent: { backgroundColor: colors.success },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
