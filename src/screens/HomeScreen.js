import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getHomeDashboard, getSocialForecast, getContinueYourCommunity, getUnlockedPerksCount } from '../services/homeDashboard';
import { supabase } from '../services/supabase';
import * as Location from 'expo-location';
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
  const [socialForecast, setSocialForecast] = useState(null);
  const [continueCommunity, setContinueCommunity] = useState(null);
  const [perksCount, setPerksCount] = useState(0);

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
    try {
      const community = await getContinueYourCommunity();
      setContinueCommunity(community);
      const perks = await getUnlockedPerksCount();
      setPerksCount(perks);
    } catch (e) {
      // These are supplementary cards, not core functionality — a
      // failure here should never block social forecast/location
      // code that runs afterward in the same function.
      console.error('Continue Community / Perks fetch failed', e);
    }

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (location) {
        const forecast = await getSocialForecast(location.coords.latitude, location.coords.longitude);
        setSocialForecast(forecast);
      }
    }
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

        {socialForecast && (
          <View style={styles.forecastCard}>
            <Text style={styles.forecastLabel}>☀️ Social Forecast</Text>
            <Text style={styles.forecastValue}>{socialForecast.forecast_label}</Text>
            <Text style={styles.forecastDetail}>{socialForecast.forecast_detail}</Text>
          </View>
        )}

        {continueCommunity && (
          <TouchableOpacity
            style={styles.continueCommunityCard}
            onPress={() => navigation.navigate('CommunityDetail', { communityId: continueCommunity.id })}
            activeOpacity={0.85}
            accessibilityLabel={`Continue ${continueCommunity.name}${continueCommunity.recentMessageCount > 0 ? `, ${continueCommunity.recentMessageCount} recent messages` : ''}`}
            accessibilityRole="button"
          >
            <Text style={styles.continueCommunityLabel}>🏘️ Continue Your Community</Text>
            <Text style={styles.continueCommunityName}>{continueCommunity.name}</Text>
            {continueCommunity.recentMessageCount > 0 && (
              <Text style={styles.continueCommunityDetail}>{continueCommunity.recentMessageCount} new message{continueCommunity.recentMessageCount === 1 ? '' : 's'} in the last day</Text>
            )}
          </TouchableOpacity>
        )}
        {perksCount > 0 && (
          <TouchableOpacity
            style={styles.perksBanner}
            onPress={() => navigation.navigate('BrandOffers')}
            activeOpacity={0.85}
            accessibilityLabel={`${perksCount} perks available to redeem`}
            accessibilityRole="button"
          >
            <Text style={styles.perksBannerText}>🎁 {perksCount} perk{perksCount === 1 ? '' : 's'} unlocked nearby</Text>
            <Text style={styles.perksBannerArrow}>›</Text>
          </TouchableOpacity>
        )}
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

        {dashboard?.friendsActivity?.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>👥 Friends' Activity</Text>
            {dashboard.friendsActivity.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={styles.trendingCard}
                onPress={() => navigation.navigate('Gatherings')}
                accessibilityLabel={`${g.profiles?.display_name} is hosting ${g.title}`}
                accessibilityRole="button"
              >
                <Text style={styles.trendingTitle}>{g.profiles?.display_name} is hosting</Text>
                <Text style={styles.trendingMeta}>{g.title}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {dashboard?.upcomingPlans?.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>📅 Upcoming Plans</Text>
            {dashboard.upcomingPlans.map((plan) => (
              <TouchableOpacity
                key={plan.id}
                style={styles.trendingCard}
                onPress={() => navigation.navigate('Gatherings')}
                accessibilityLabel={`${plan.title}, you're ${plan.role}`}
                accessibilityRole="button"
              >
                <Text style={styles.trendingTitle}>{plan.title}</Text>
                <Text style={styles.trendingMeta}>{plan.role === 'hosting' ? 'Hosting' : 'Attending'} · {new Date(plan.scheduled_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
              </TouchableOpacity>
            ))}
          </>
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

        {dashboard?.weeklyRecap && (dashboard.weeklyRecap.gatheringsAttended > 0 || dashboard.weeklyRecap.newFriends > 0) && (
          <View style={styles.recapCard}>
            <Text style={styles.recapTitle}>This Week</Text>
            {dashboard.weeklyRecap.gatheringsAttended > 0 && (
              <Text style={styles.recapItem}>✓ Attended {dashboard.weeklyRecap.gatheringsAttended} gathering{dashboard.weeklyRecap.gatheringsAttended === 1 ? '' : 's'}</Text>
            )}
            {dashboard.weeklyRecap.newFriends > 0 && (
              <Text style={styles.recapItem}>✓ Made {dashboard.weeklyRecap.newFriends} new friend{dashboard.weeklyRecap.newFriends === 1 ? '' : 's'}</Text>
            )}
          </View>
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

        {!dashboard?.bestPick && (!dashboard?.trendingGatherings || dashboard.trendingGatherings.length === 0) && (dashboard?.nearbyPeopleCount ?? 0) === 0 && (
          <View style={styles.quietCard}>
            <Text style={styles.quietTitle}>Quiet night nearby</Text>
            <Text style={styles.quietText}>Nothing notable happening right now — but that can change fast. Browse anyway, or check back later.</Text>
          </View>
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
  continueCommunityCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  continueCommunityLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  continueCommunityName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  continueCommunityDetail: { color: colors.primary, fontSize: 12, marginTop: 2 },
  perksBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.md,
  },
  perksBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  perksBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  forecastCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  forecastLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  forecastValue: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  forecastDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
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
  recapCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  recapTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  recapItem: { color: colors.textPrimary, fontSize: 13, marginBottom: 2 },
  trendingCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  trendingTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  trendingMeta: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  quietCard: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
  },
  quietTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.xs },
  quietText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  browseButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.md },
  browseButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});