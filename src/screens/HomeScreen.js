import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getHomeDashboard } from '../services/homeDashboard';
import { supabase } from '../services/supabase';
import StartSomethingModal from '../components/StartSomethingModal';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [dashboard, setDashboard] = useState(null);
  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) {
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', myId).single();
      setMyName(profile?.display_name?.split(' ')[0] ?? '');
    }
    const result = await getHomeDashboard();
    setDashboard(result);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>{getGreeting()}{myName ? `, ${myName}` : ''} 👋</Text>

        {dashboard?.sinceAway && (dashboard.sinceAway.newPeopleCount > 0 || dashboard.sinceAway.newGatheringsCount > 0) && (
          <View style={styles.sinceAwayBanner}>
            <Text style={styles.sinceAwayTitle}>Since you were away</Text>
            {dashboard.sinceAway.newPeopleCount > 0 && (
              <Text style={styles.sinceAwayItem}>👥 {dashboard.sinceAway.newPeopleCount} new {dashboard.sinceAway.newPeopleCount === 1 ? 'person' : 'people'} nearby</Text>
            )}
            {dashboard.sinceAway.newGatheringsCount > 0 && (
              <Text style={styles.sinceAwayItem}>🎉 {dashboard.sinceAway.newGatheringsCount} new gathering{dashboard.sinceAway.newGatheringsCount === 1 ? '' : 's'}</Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.startSomethingButton}
          onPress={() => setStartModalVisible(true)}
          accessibilityLabel="Start something spontaneous"
          accessibilityRole="button"
        >
          <Text style={styles.startSomethingText}>+ Start Something</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Nearby')} accessibilityLabel={`${dashboard?.nearbyPeopleCount ?? 0} people nearby, tap to view`} accessibilityRole="button">
            <Text style={styles.cardIcon}>👥</Text>
            <Text style={styles.cardText}>{dashboard?.nearbyPeopleCount ?? 0} people nearby</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Gatherings')} accessibilityLabel={`${dashboard?.gatheringsTodayCount ?? 0} gatherings today, tap to view`} accessibilityRole="button">
            <Text style={styles.cardIcon}>🎉</Text>
            <Text style={styles.cardText}>{dashboard?.gatheringsTodayCount ?? 0} gatherings today</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          {dashboard?.mostRecentSighting && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('ViewProfile', { userId: dashboard.mostRecentSighting.otherUserId })} accessibilityLabel={`You crossed paths with ${dashboard.mostRecentSighting.profiles?.display_name}`} accessibilityRole="button">
                <Text style={styles.cardIcon}>📍</Text>
                <Text style={styles.cardText}>Crossed paths with {dashboard.mostRecentSighting.profiles?.display_name}</Text>
                <Text style={styles.cardChevron}>›</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Matches')} accessibilityLabel={`${dashboard?.unreadCount ?? 0} unread messages, tap to view`} accessibilityRole="button">
            <Text style={styles.cardIcon}>💬</Text>
            <Text style={styles.cardText}>{dashboard?.unreadCount ?? 0} unread message{dashboard?.unreadCount === 1 ? '' : 's'}</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {dashboard?.bestPick && (
          <>
            <Text style={styles.sectionHeader}>⭐ Best Pick Tonight</Text>
            <TouchableOpacity
              style={styles.bestPickCard}
              onPress={() => navigation.navigate('Gatherings')}
              accessibilityLabel={`${dashboard.bestPick.title}, ${dashboard.bestPick.reasons.join(', ')}`}
              accessibilityRole="button"
            >
              <Text style={styles.bestPickTitle}>{dashboard.bestPick.title}</Text>
              <View style={styles.bestPickReasons}>
                {dashboard.bestPick.reasons.map((reason, i) => (
                  <Text key={i} style={styles.bestPickReason}>✓ {reason}</Text>
                ))}
              </View>
              <Text style={styles.bestPickAction}>View →</Text>
            </TouchableOpacity>
          </>
        )}

        {dashboard?.trendingGatherings?.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>🔥 Trending Near You</Text>
            {dashboard.trendingGatherings.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={styles.trendingCard}
                onPress={() => navigation.navigate('Gatherings')}
                accessibilityLabel={`${g.title}, ${g.approvedAttendees?.length ?? 0} attending`}
                accessibilityRole="button"
              >
                <Text style={styles.trendingTitle}>{g.title}</Text>
                <Text style={styles.trendingMeta}>{g.approvedAttendees?.length ?? 0} attending · {g.distanceLabel}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <TouchableOpacity style={styles.browseButton} onPress={() => navigation.navigate('Nearby')} accessibilityLabel="Continue browsing" accessibilityRole="button">
          <Text style={styles.browseButtonText}>Continue Browsing →</Text>
        </TouchableOpacity>
      </ScrollView>

      <StartSomethingModal
        visible={startModalVisible}
        onClose={() => setStartModalVisible(false)}
        navigation={navigation}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greeting: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.lg },
  sinceAwayBanner: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  sinceAwayTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  sinceAwayItem: { color: colors.textPrimary, fontSize: 13, marginBottom: 2 },
  startSomethingButton: {
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md,
    alignItems: 'center', marginBottom: spacing.lg,
  },
  startSomethingText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  cardIcon: { fontSize: 20, marginRight: spacing.sm },
  cardText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardChevron: { color: colors.textTertiary, fontSize: 18 },
  divider: { height: 1, backgroundColor: colors.border },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  bestPickCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  bestPickTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  bestPickReasons: { marginBottom: spacing.sm },
  bestPickReason: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  bestPickAction: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  trendingCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  trendingTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  trendingMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  browseButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.md },
  browseButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});