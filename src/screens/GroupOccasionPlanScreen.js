import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
} from '../services/occasionGroupPlans';
import { getMyFriends } from '../services/friends';
import { ACTIVITY_OPTIONS, resolveDecidedGroupPlanParams, formatBudgetRange } from '../services/celebrateSomething';
import { OCCASION_OPTIONS, occasionLabel } from '../constants/businessAttributes';
import { WHEN_PRESETS } from '../utils/whenPresets';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

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
function activityMeta(activityType) {
  return ACTIVITY_OPTIONS.find((o) => o.key === activityType) ?? { icon: '💡', label: activityType };
}

function formatWhen(whenPreset, scheduledDate) {
  const preset = WHEN_PRESETS.find((p) => p.key === whenPreset);
  const dateLabel = scheduledDate
    ? new Date(`${scheduledDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : null;
  if (preset && preset.key !== 'custom') return dateLabel ? `${preset.label} · ${dateLabel}` : preset.label;
  return dateLabel ?? 'Date not set';
}

const PARTICIPANT_STATUS_COPY = {
  invited: 'Invited',
  joined: 'In',
  declined: "Can't make it",
};

export default function GroupOccasionPlanScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const planId = route.params?.planId;

  const [myId, setMyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [acting, setActing] = useState(false);
  const [proposeType, setProposeType] = useState(null);
  const [proposeLabel, setProposeLabel] = useState('');

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

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      setMyId(sessionData?.session?.user?.id ?? null);
      const result = await getOccasionGroupPlanDetail(planId);
      setDetail(result);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
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
      Alert.alert('Error', e.message);
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

  function handlePropose() {
    if (!proposeType) {
      return Alert.alert('Pick something', 'What are you proposing?');
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
    Alert.alert(
      `Go with "${option.label || activityMeta(option.activityType).label}"?`,
      "This locks in the group's choice and takes you to find real options nearby.",
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: 'Decide',
          onPress: async () => {
            const decided = await runAction(() => decideOccasionGroupPlan(planId, option.id));
            if (decided) {
              navigation.replace('CelebrateSomething', resolveDecidedGroupPlanParams(decided, planId));
            }
          },
        },
      ]
    );
  }

  function handleCancel() {
    Alert.alert('Cancel this group plan?', 'Everyone will be told voting is closed.', [
      { text: 'Never mind', style: 'cancel' },
      { text: 'Cancel Plan', style: 'destructive', onPress: () => runAction(() => cancelOccasionGroupPlan(planId)) },
    ]);
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
      Alert.alert('Error', e.message);
    }
    setInvitingMore(false);
  }

  if (loading && !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load this plan." onRetry={load} />
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
          {occasionLabel(detail.occasionType)} · {formatWhen(detail.whenPreset, detail.scheduledDate)}
          {detail.isHost ? ' · You\'re hosting' : ''}
        </Text>
        {budgetLabel && <Text style={[styles.subheader, { marginTop: 2 }]}>💰 {budgetLabel}</Text>}

        {/* Item 65 (CLAUDE.md): the one collaborator-facing surface this
            change added a real indicator to -- surpriseMode is already
            enforced server-side (the person it's for can never actually be
            a participant here), this is just making that fact visible so
            invited friends know to keep it quiet. */}
        {detail.surpriseMode && (
          <View style={styles.surpriseBanner}>
            <Text style={styles.surpriseBannerText}>
              🔒 Surprise mode — {detail.whoForName || 'the person this is for'} isn't part of this plan and won't be notified. Keep it quiet!
            </Text>
          </View>
        )}

        {detail.status === 'cancelled' && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>This plan was cancelled.</Text>
          </View>
        )}

        {detail.myStatus === 'invited' && detail.status === 'voting' && (
          <View style={styles.inviteRow}>
            <TouchableOpacity style={styles.declineButton} onPress={() => handleRespond(false)} disabled={acting} accessibilityRole="button" accessibilityLabel="Decline invite">
              <Text style={styles.declineButtonText}>Can't Make It</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptButton} onPress={() => handleRespond(true)} disabled={acting} accessibilityRole="button" accessibilityLabel="Join and vote">
              <Text style={styles.acceptButtonText}>Join & Vote</Text>
            </TouchableOpacity>
          </View>
        )}

        {(detail.status === 'decided' || detail.status === 'fulfilled') && winningOption && (
          <View style={styles.decidedCard}>
            <Text style={styles.decidedLabel}>{detail.status === 'fulfilled' ? '✅ Turned into a real plan!' : "🎉 It's decided!"}</Text>
            <Text style={styles.decidedChoice}>
              {activityMeta(winningOption.activityType).icon} {winningOption.label || activityMeta(winningOption.activityType).label}
            </Text>
            {/* "fulfilled" means someone already turned this into a real gathering/business
                request (linkOccasionGroupPlanToPlan) -- the button stays available so anyone
                else who still wants their own separate options can keep going, per this
                object's own multi-actor shape (any joined participant can submit their own). */}
            <TouchableOpacity style={styles.decideButton} onPress={goFindBusinesses} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Find businesses for this">
              <Text style={styles.decideButtonText}>{detail.status === 'fulfilled' ? 'Find More Options →' : 'Find Options Nearby →'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {detail.status === 'voting' && (
          <>
            {/* Item 66 (CLAUDE.md, "Add collaborative planning"): Organizers
                (host + anyone promoted) get a named section of their own,
                matching the user's own mock -- everyone else is a Guest,
                a real honest count broken down by status rather than a
                second wall of names. */}
            <Text style={styles.sectionLabel}>Organizers</Text>
            <View style={styles.participantsWrap}>
              {organizers.map((p) => {
                const isSelf = p.userId === myId;
                const canDemote = detail.isHost && !isSelf;
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={styles.participantChip}
                    disabled={!canDemote}
                    activeOpacity={canDemote ? 0.7 : 1}
                    onPress={() => canDemote && Alert.alert(
                      `Remove ${p.displayName} as organizer?`,
                      "They'll stay a regular guest -- still able to propose and vote.",
                      [{ text: 'Never mind', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => handleToggleOrganizer(p) }]
                    )}
                    accessibilityRole={canDemote ? 'button' : undefined}
                    accessibilityLabel={canDemote ? `Remove ${p.displayName} as organizer` : undefined}
                  >
                    <Text style={styles.participantText}>
                      {p.userId === detail.hostId ? '👑 ' : '🎗️ '}{p.displayName}{isSelf ? ' (You)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>
              Guests · {[
                guestCounts.invited ? `${guestCounts.invited} invited` : null,
                guestCounts.joined ? `${guestCounts.joined} joined` : null,
                guestCounts.declined ? `${guestCounts.declined} can't make it` : null,
              ].filter(Boolean).join(' · ') || 'none yet'}
            </Text>
            <View style={styles.participantsWrap}>
              {guests.map((p) => {
                const isSelf = p.userId === myId;
                const canPromote = detail.isHost && !isSelf && p.status === 'joined';
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={styles.participantChip}
                    disabled={!canPromote}
                    activeOpacity={canPromote ? 0.7 : 1}
                    onPress={() => canPromote && Alert.alert(
                      `Make ${p.displayName} an organizer?`,
                      'They\'ll be able to invite more guests to help plan.',
                      [{ text: 'Never mind', style: 'cancel' }, { text: 'Make Organizer', onPress: () => handleToggleOrganizer(p) }]
                    )}
                    accessibilityRole={canPromote ? 'button' : undefined}
                    accessibilityLabel={canPromote ? `Make ${p.displayName} an organizer` : undefined}
                  >
                    <Text style={styles.participantText}>
                      {p.displayName}{isSelf ? ' (You)' : ''} · {PARTICIPANT_STATUS_COPY[p.status] ?? p.status}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {guests.length === 0 && <Text style={styles.helperText}>No other guests yet.</Text>}
            </View>

            {canInviteMore && (
              <View style={{ marginBottom: spacing.md }}>
                <TouchableOpacity onPress={openInviteMore} accessibilityRole="button" accessibilityLabel="Invite more guests">
                  <Text style={styles.inviteMoreLink}>{inviteMoreOpen ? '− Invite More Guests' : '+ Invite More Guests'}</Text>
                </TouchableOpacity>
                {inviteMoreOpen && (
                  <View style={styles.inviteMorePanel}>
                    {loadingFriends && <ActivityIndicator color={colors.primary} />}
                    {!loadingFriends && friendsLoaded && inviteMoreCandidates.length === 0 && (
                      <Text style={styles.helperText}>Everyone you're connected with is already part of this plan.</Text>
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
                                activeOpacity={0.8}
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
                          accessibilityLabel={`Invite ${selectedNewInviteeIds.size} more`}
                        >
                          <Text style={styles.addOptionButtonText}>{invitingMore ? 'Inviting…' : `Invite (${selectedNewInviteeIds.size})`}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            )}

            <Text style={styles.sectionLabel}>What Should We Do?</Text>
            {detail.options.length === 0 && (
              <Text style={styles.helperText}>No ideas yet — be the first to propose one below.</Text>
            )}
            {detail.options.map((option) => {
              const meta = activityMeta(option.activityType);
              return (
                <View key={option.id} style={styles.optionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{meta.icon} {option.label || meta.label}</Text>
                    <Text style={styles.optionSubtitle}>{option.voteCount} vote{option.voteCount === 1 ? '' : 's'}</Text>
                  </View>
                  {canVote && (
                    <TouchableOpacity
                      style={[styles.voteButton, option.myVote && styles.voteButtonActive]}
                      onPress={() => handleToggleVote(option)}
                      disabled={acting}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={option.myVote ? 'Remove vote' : 'Vote for this'}
                    >
                      <Text style={[styles.voteButtonText, option.myVote && styles.voteButtonTextActive]}>{option.myVote ? '✓ Voted' : 'Vote'}</Text>
                    </TouchableOpacity>
                  )}
                  {detail.isHost && (
                    <TouchableOpacity
                      style={styles.decideLink}
                      onPress={() => handleDecide(option)}
                      disabled={acting}
                      accessibilityRole="button"
                      accessibilityLabel={`Decide on ${option.label || meta.label}`}
                    >
                      <Text style={styles.decideLinkText}>Pick →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {canVote && detail.options.length < 8 && (
              <View style={styles.proposeCard}>
                <Text style={styles.sublabel}>Propose an idea</Text>
                <View style={styles.chipRow}>
                  {ACTIVITY_OPTIONS.map((o) => {
                    const selected = proposeType === o.key;
                    return (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => { Haptics.selectionAsync(); setProposeType(o.key); }}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={o.label}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.icon} {o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Add a short note (optional, e.g. Italian dinner)"
                  placeholderTextColor={colors.textTertiary}
                  value={proposeLabel}
                  onChangeText={setProposeLabel}
                  accessibilityLabel="Optional note for this idea"
                />
                <TouchableOpacity style={styles.addOptionButton} onPress={handlePropose} disabled={acting} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Add this idea">
                  <Text style={styles.addOptionButtonText}>{acting ? 'Adding…' : 'Add Idea'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {detail.isHost && (
              <TouchableOpacity style={styles.cancelLink} onPress={handleCancel} disabled={acting} accessibilityRole="button" accessibilityLabel="Cancel this plan">
                <Text style={styles.cancelLinkText}>Cancel This Plan</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { ...typography.title, color: colors.textPrimary },
  subheader: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs, marginBottom: spacing.lg },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyText: { color: colors.textTertiary },
  surpriseBanner: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.sm, marginBottom: spacing.lg,
  },
  surpriseBannerText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
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
