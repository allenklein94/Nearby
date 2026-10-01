import React, { useState, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { presentRecoverableError } from '../utils/recoverableError';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NLoader } from '../motion';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { getSharedNight, leaveSharedExperience, experienceStopStateLabel } from '../services/plans';
import { nightDateLabel } from '../utils/nightDate';

const PLAN_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled']; // shown through ui.planDetail.status.<status>

// A night a friend shared with me: strictly read-only. It shows the stops and where each one stands and offers exactly one
// action -- leave. Nothing here can request, cancel, reorder or change anything (the server allows none of it for a viewer).
export default function SharedNightScreen({ navigation, route }) {
  const { t } = useLanguage();
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
    Alert.alert(t('ui.sharedNight.leaveThisNight'), t('ui.sharedNight.itWillDisappearFromYour'), [
      { text: t('ui.sharedNight.stay'), style: 'cancel' },
      {
        text: t('ui.sharedNight.leave'),
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveSharedExperience(planId);
            navigation.goBack();
          } catch (e) {
            presentRecoverableError(Alert, { what: 'complete that', error: e, onRetry: () => confirmLeave() });
          }
        },
      },
    ]);
  }

  if (error) return <SafeAreaView style={styles.container}><LoadErrorState message={t('ui.sharedNight.couldntLoadThisNight')} onRetry={load} /></SafeAreaView>;
  if (night === undefined) return <SafeAreaView style={styles.container}><NLoader fullScreen={false} size="compact" caption={t('ui.sharedNight.pullingThisNightTogether')} /></SafeAreaView>;
  if (!night) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.muted}>{t('ui.sharedNight.thisNightIsntSharedWith')}</Text>
          <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('Plans')} accessibilityRole="button">
            <Text style={styles.link}>{t('ui.sharedNight.seeYourPlans')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>✨ {night.title || t('ui.sharedNight.aNightOut')}</Text>
        <Text style={styles.muted}>
          {[PLAN_STATUSES.includes(night.status) ? t(`ui.planDetail.status.${night.status}`) : night.status, nightDateLabel(night.nightDate), night.hostDisplayName ? t('ui.sharedNight.sharedBy', { name: night.hostDisplayName }) : null].filter(Boolean).join(' · ')}
        </Text>

        <Text style={styles.sectionLabel}>{t('ui.sharedNight.theNight')}</Text>
        <View style={styles.card}>
          {night.stops.map((s, i) => (
            <View key={`${s.order}-${i}`} style={[styles.stepRow, i > 0 && styles.stepDivider]}>
              <Text style={styles.stepMark}>{s.state === 'booked' || s.state === 'done' ? '✓' : s.order}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>{s.componentLabel}</Text>
                <Text style={styles.muted}>{[s.title, s.subtitle && s.subtitle !== s.title ? s.subtitle : null].filter(Boolean).join(' · ')}</Text>
                {s.stopType === 'business_availability' && <Text style={styles.muted}>{experienceStopStateLabel(s.state)}</Text>}
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.muted}>{night.hostDisplayName ? t('ui.sharedNight.viewingBy', { name: night.hostDisplayName }) : t('ui.sharedNight.viewingByFriend')}</Text>

        <TouchableOpacity style={styles.linkButton} onPress={confirmLeave} accessibilityRole="button" accessibilityLabel={t('ui.sharedNight.leaveThisSharedNightA11y')}>
          <Text style={[styles.link, { color: colors.danger }]}>{t('ui.sharedNight.leaveThisNight2')}</Text>
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
