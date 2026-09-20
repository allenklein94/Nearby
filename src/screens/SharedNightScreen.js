import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NLoader } from '../motion';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { getSharedNight, leaveSharedExperience, EXPERIENCE_STOP_STATE_LABEL } from '../services/plans';

const STATUS_LABEL = { draft: 'Planning', confirmed: 'Confirmed', completed: 'Done', cancelled: 'Cancelled' };

// A night a friend shared with me: strictly read-only. It shows the stops and where each one stands and offers exactly one
// action -- leave. Nothing here can request, cancel, reorder or change anything (the server allows none of it for a viewer).
export default function SharedNightScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const planId = route.params?.planId;
  const [night, setNight] = useState(undefined); // undefined = loading, null = not available
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setNight(await getSharedNight(planId));
    } catch (e) {
      setError(true);
    }
  }, [planId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmLeave() {
    Alert.alert('Leave this night?', "It will disappear from your plans. Your friend can share it with you again.", [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveSharedExperience(planId);
            navigation.goBack();
          } catch (e) {
            Alert.alert("Couldn't leave", e.message);
          }
        },
      },
    ]);
  }

  if (error) return <SafeAreaView style={styles.container}><LoadErrorState message="Couldn't load this night." onRetry={load} /></SafeAreaView>;
  if (night === undefined) return <SafeAreaView style={styles.container}><NLoader fullScreen={false} size="compact" caption="Pulling this night together…" /></SafeAreaView>;
  if (!night) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.muted}>This night isn't shared with you anymore.</Text>
          <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('Plans')} accessibilityRole="button">
            <Text style={styles.link}>See your plans →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>✨ {night.title || 'A night out'}</Text>
        <Text style={styles.muted}>
          {[STATUS_LABEL[night.status] || night.status, night.hostDisplayName ? `Shared by ${night.hostDisplayName}` : null].filter(Boolean).join(' · ')}
        </Text>

        <Text style={styles.sectionLabel}>The night</Text>
        <View style={styles.card}>
          {night.stops.map((s, i) => (
            <View key={`${s.order}-${i}`} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
              <Text style={styles.stepMark}>{s.state === 'booked' || s.state === 'done' ? '✓' : s.order}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>{s.componentLabel}</Text>
                <Text style={styles.muted}>{[s.title, s.subtitle && s.subtitle !== s.title ? s.subtitle : null].filter(Boolean).join(' · ')}</Text>
                {s.stopType === 'business_availability' && <Text style={styles.muted}>{EXPERIENCE_STOP_STATE_LABEL[s.state] ?? ''}</Text>}
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.muted}>You're viewing this night. {night.hostDisplayName || 'Your friend'} makes the plans and keeps it up to date.</Text>

        <TouchableOpacity style={styles.linkButton} onPress={confirmLeave} accessibilityRole="button" accessibilityLabel="Leave this shared night">
          <Text style={[styles.link, { color: colors.danger }]}>Leave this night</Text>
        </TouchableOpacity>
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  stepDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stepMark: { width: 28, color: colors.primary, fontSize: 16, fontWeight: '700' },
  stepLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 16 },
  linkButton: { alignSelf: 'flex-start', marginTop: spacing.lg },
  link: { color: colors.primary, fontWeight: '700' },
});
