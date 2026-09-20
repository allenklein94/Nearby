import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NLoader } from '../motion';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { getPlanOverview, getPlanStops, navigateToExperienceStop, reorderExperienceStops, removeExperienceStop, EXPERIENCE_STOP_STATE_LABEL } from '../services/plans';
import { supabase } from '../services/supabase';
import ExperienceSharePanel from '../components/ExperienceSharePanel';
import { canEditNight, canRemoveStop, moveStopIds, removeStopCopy } from '../utils/experienceStopEdit';
import { buildPlanJourney } from '../utils/planJourney';
import { OCCASION_OPTIONS } from '../constants/businessAttributes';

const STATUS_LABEL = { draft: 'Planning', confirmed: 'Confirmed', completed: 'Done', cancelled: 'Cancelled' };

// One Plan, read through get_plan_overview (20261203_plan_read_layer.sql): the whole Occasion -> People -> Activity ->
// Business -> Offer -> Reservation picture in one place. Read-only; every action hands off to an existing screen.
export default function PlanDetailScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const planId = route.params?.planId;
  const [overview, setOverview] = useState(null);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [myId, setMyId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const ov = await getPlanOverview(planId);
      const { data: sess } = await supabase.auth.getSession();
      setMyId(sess?.session?.user?.id ?? null);
      setOverview(ov);
      setStops(ov?.plan?.plan_type === 'experience' ? await getPlanStops(planId) : []);
    } catch (e) {
      setError(true);
    }
    setLoading(false);
  }, [planId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <SafeAreaView style={styles.container}><NLoader fullScreen={false} size="compact" caption="Pulling this plan together…" /></SafeAreaView>;
  if (error) return <SafeAreaView style={styles.container}><LoadErrorState message="Couldn't load this plan." onRetry={load} /></SafeAreaView>;
  if (!overview) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.muted}>This plan isn't available to you.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { plan, who, match, groupPlan, activity, businessRequest, offers, reservation, parent, children } = overview;
  const meta = OCCASION_OPTIONS.find((o) => o.key === plan.occasion_type);
  const journey = buildPlanJourney(overview);
  const nothingYet = journey.every((s) => !s.done);
  const dateLabel = plan.scheduled_at
    ? new Date(plan.scheduled_at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  const isMatchPlan = !!match;
  const matchTitle = match ? `${match.kind === 'friend' ? '🤝' : '❤️'} You & ${match.other_display_name || 'them'}` : null;
  const matchedLabel = match?.matched_at
    ? `${match.kind === 'friend' ? 'Friends' : 'Matched'} since ${new Date(match.matched_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    : null;

  const isExperiencePlan = plan.plan_type === 'experience';
  const isGatheringPlan = activity?.kind === 'gathering' && (plan.plan_type === 'gathering' || plan.plan_type === 'friend_hangout');
  const isRequestPlan = plan.plan_type === 'business_request' && !!businessRequest;

  const canEdit = isExperiencePlan && canEditNight(plan.status, !!myId && who.host?.id === myId);

  async function moveStop(index, delta) {
    const ids = moveStopIds(stops, index, delta);
    if (!ids || busy) return;
    setBusy(true);
    try {
      await reorderExperienceStops(planId, ids);
      setStops(await getPlanStops(planId));
    } catch (e) {
      Alert.alert("Couldn't reorder", e.message);
    }
    setBusy(false);
  }

  function confirmRemove(stop) {
    const copy = removeStopCopy(stop);
    Alert.alert(copy.title, copy.message, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: copy.action,
        style: 'destructive',
        onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            await removeExperienceStop(stop.id);
            await load();
          } catch (e) {
            Alert.alert("Couldn't remove it", e.message);
          }
          setBusy(false);
        },
      },
    ]);
  }

  function startPlanning() {
    if (match) { navigation.navigate('DateProposal', { matchId: match.id, matchName: match.other_display_name }); return; }
    if (groupPlan) navigation.navigate('GroupOccasionPlan', { planId: groupPlan.id });
    else navigation.navigate('CelebrateSomething');
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>{isMatchPlan ? matchTitle : `${meta?.icon ? `${meta.icon} ` : ''}${plan.title || 'Untitled plan'}`}</Text>
        <Text style={styles.muted}>
          {isMatchPlan
            ? matchedLabel
            : [STATUS_LABEL[plan.status] || plan.status, dateLabel, who.forName ? `For ${who.forName}` : null].filter(Boolean).join(' · ')}
        </Text>
        {parent ? <Text style={styles.muted}>Part of: {parent.title}</Text> : null}

        {isExperiencePlan && (
          <>
            <View style={styles.nightHeader}>
              <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>Your night</Text>
              {canEdit && (
                <TouchableOpacity onPress={() => setEditing((v) => !v)} accessibilityRole="button" accessibilityLabel={editing ? 'Done editing your night' : 'Edit your night'}>
                  <Text style={styles.stopLink}>{editing ? 'Done' : 'Edit'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.card}>
              {stops.map((s, i) => (
                <View key={s.id} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
                  <Text style={styles.stepMark}>{s.state === 'booked' || s.state === 'done' ? '✓' : s.order}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepLabel}>{s.componentLabel}</Text>
                    <Text style={styles.muted}>{[s.title, s.subtitle && s.subtitle !== s.title ? s.subtitle : null].filter(Boolean).join(' · ')}</Text>
                    {s.stopType === 'business_availability' && <Text style={styles.muted}>{EXPERIENCE_STOP_STATE_LABEL[s.state] ?? ''}</Text>}
                  </View>
                  {canEdit && editing ? (
                    <View style={styles.editControls}>
                      <TouchableOpacity disabled={busy || i === 0} onPress={() => moveStop(i, -1)} accessibilityRole="button" accessibilityLabel={`Move ${s.title} up`}>
                        <Text style={[styles.editIcon, (busy || i === 0) && styles.editIconOff]}>↑</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={busy || i === stops.length - 1} onPress={() => moveStop(i, 1)} accessibilityRole="button" accessibilityLabel={`Move ${s.title} down`}>
                        <Text style={[styles.editIcon, (busy || i === stops.length - 1) && styles.editIconOff]}>↓</Text>
                      </TouchableOpacity>
                      {canRemoveStop(s, stops.length) && (
                        <TouchableOpacity disabled={busy} onPress={() => confirmRemove(s)} accessibilityRole="button" accessibilityLabel={`Remove ${s.title}`}>
                          <Text style={[styles.editIcon, { color: colors.danger }]}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                  <TouchableOpacity
                    onPress={() => navigateToExperienceStop(navigation, s, { partySize: plan.party_size })}
                    accessibilityRole="button"
                    accessibilityLabel={`Continue with ${s.title}`}
                  >
                    <Text style={styles.stopLink}>{s.requestId && s.state !== 'chosen' && s.state !== 'cancelled' ? 'View →' : 'Continue →'}</Text>
                  </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
            <Text style={styles.muted}>Each stop is confirmed by its business with you; this plan keeps them together and updates as they do.</Text>
            {canEdit && <ExperienceSharePanel planId={planId} planTitle={plan.title} />}
          </>
        )}

        {!isExperiencePlan && <Text style={styles.sectionLabel}>The plan so far</Text>}
        {!isExperiencePlan && <View style={styles.card}>
          {journey.map((s, i) => (
            <View key={s.key} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
              <Text style={styles.stepMark}>{s.done ? '✓' : '○'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepLabel, !s.done && styles.muted]}>{s.label}</Text>
                <Text style={styles.muted}>{s.detail}</Text>
              </View>
            </View>
          ))}
        </View>}

        {!isMatchPlan && (who.participants.length > 0 || who.organizers.length > 0) && (
          <>
            <Text style={styles.sectionLabel}>People</Text>
            <View style={styles.card}>
              {who.host && <Text style={styles.line}>{who.host.display_name} · Host</Text>}
              {who.organizers.map((p) => <Text key={p.id} style={styles.line}>{p.display_name} · Organizer</Text>)}
              {who.participants.map((p) => (
                <Text key={p.user_id} style={styles.line}>{p.display_name} · {p.status}</Text>
              ))}
              {who.guestCount > 0 && <Text style={styles.line}>{who.guestCount} invited by link</Text>}
            </View>
          </>
        )}

        {offers.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Offers</Text>
            <View style={styles.card}>
              {offers.map((o) => (
                <Text key={o.id} style={styles.line}>
                  {o.business_name || 'A business'}{o.title ? ` · ${o.title}` : ''}{o.price != null ? ` · $${o.price}${o.price_is_per_person ? '/person' : ''}` : ''} · {o.status}
                </Text>
              ))}
              {reservation && <Text style={styles.line}>Reservation: {reservation.status}</Text>}
            </View>
          </>
        )}

        {children.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Made from this plan</Text>
            <View style={styles.card}>
              {children.map((c) => <Text key={c.id} style={styles.line}>{c.title || c.plan_type} · {STATUS_LABEL[c.status] || c.status}</Text>)}
            </View>
          </>
        )}

        {isGatheringPlan && (
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('GatheringDetail', { gatheringId: activity.id })} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Open the gathering">
            <Text style={styles.buttonText}>Open the gathering →</Text>
          </TouchableOpacity>
        )}
        {isRequestPlan && (
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('BusinessRequestDetail', { requestId: businessRequest.id })} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Open the request">
            <Text style={styles.buttonText}>Open the request →</Text>
          </TouchableOpacity>
        )}
        {(isMatchPlan || (nothingYet && (plan.plan_type === 'occasion' || plan.plan_type === 'group_occasion') && plan.status !== 'cancelled')) && (
          <TouchableOpacity style={styles.button} onPress={startPlanning} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={isMatchPlan ? 'Plan something together' : 'Plan something'}>
            <Text style={styles.buttonText}>{isMatchPlan ? 'Plan something together →' : 'Plan something →'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary },
  muted: { color: colors.textSecondary, marginTop: 2 },
  sectionLabel: { color: colors.textSecondary, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadow.card },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  stepDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  stepMark: { width: 28, color: colors.primary, fontSize: 16, fontWeight: '700' },
  stepLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 16 },
  stopLink: { color: colors.primary, fontWeight: '700' },
  nightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  editControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  editIcon: { color: colors.textPrimary, fontWeight: '700', fontSize: 18, paddingHorizontal: spacing.xs },
  editIconOff: { opacity: 0.3 },
  line: { color: colors.textPrimary, paddingVertical: 3 },
  button: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
