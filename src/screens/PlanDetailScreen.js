import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NLoader } from '../motion';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { getPlanOverview } from '../services/plans';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setOverview(await getPlanOverview(planId));
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

  const { plan, who, groupPlan, activity, businessRequest, offers, reservation, parent, children } = overview;
  const meta = OCCASION_OPTIONS.find((o) => o.key === plan.occasion_type);
  const journey = buildPlanJourney(overview);
  const nothingYet = journey.every((s) => !s.done);
  const dateLabel = plan.scheduled_at
    ? new Date(plan.scheduled_at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  function startPlanning() {
    if (groupPlan) navigation.navigate('GroupOccasionPlan', { planId: groupPlan.id });
    else navigation.navigate('CelebrateSomething');
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>{meta?.icon ? `${meta.icon} ` : ''}{plan.title || 'Untitled plan'}</Text>
        <Text style={styles.muted}>
          {[STATUS_LABEL[plan.status] || plan.status, dateLabel, who.forName ? `For ${who.forName}` : null].filter(Boolean).join(' · ')}
        </Text>
        {parent ? <Text style={styles.muted}>Part of: {parent.title}</Text> : null}

        <Text style={styles.sectionLabel}>The plan so far</Text>
        <View style={styles.card}>
          {journey.map((s, i) => (
            <View key={s.key} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
              <Text style={styles.stepMark}>{s.done ? '✓' : '○'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepLabel, !s.done && styles.muted]}>{s.label}</Text>
                <Text style={styles.muted}>{s.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        {(who.participants.length > 0 || who.organizers.length > 0) && (
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

        {nothingYet && (plan.plan_type === 'occasion' || plan.plan_type === 'group_occasion') && plan.status !== 'cancelled' && (
          <TouchableOpacity style={styles.button} onPress={startPlanning} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Plan something">
            <Text style={styles.buttonText}>Plan something →</Text>
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
  line: { color: colors.textPrimary, paddingVertical: 3 },
  button: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
