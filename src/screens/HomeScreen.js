import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getHomeDashboard, getSocialForecast, getContinueYourCommunities, getUnlockedPerksCount, getHomeInsight, getPendingInvitesCount } from '../services/homeDashboard';
import { getMostRecentUnratedGathering } from '../services/gatherings';
import GatheringFeedbackModal from '../components/GatheringFeedbackModal';
import GatheringStatusBadge from '../components/GatheringStatusBadge';
import { supabase } from '../services/supabase';
import * as Location from 'expo-location';
import StartSomethingModal from '../components/StartSomethingModal';
import QuickPicksEditModal from '../components/QuickPicksEditModal';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { iconNameForCategory } from '../constants/quickPickIcons';
import LoadErrorState from '../components/LoadErrorState';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getGreeting, getTimePeriod, getPersonalizedQuickPicks, getPinnedQuickPicks, formatHeroDateTime } from '../utils/timeContext';

const PERIOD_DATE_FILTER = { morning: 'today', afternoon: 'today', evening: 'today', weekend: 'weekend' };

const PERIOD_SECTION_LABELS = { morning: 'Good Morning', afternoon: 'This Afternoon', evening: 'Tonight', weekend: 'This Weekend' };

const PERIOD_SUBTITLES = {
  morning: 'What sounds good this morning?',
  afternoon: 'What sounds good this afternoon?',
  evening: 'What sounds good tonight?',
  weekend: 'What sounds good this weekend?',
};

// "Coffee" / "Coffee & Outdoors" / "Coffee, Outdoors & Music" — the real
// top categories this section is drawn from, not just the first result.
function formatCategoryList(categories) {
  if (!categories || categories.length === 0) return '';
  if (categories.length === 1) return categories[0];
  return `${categories.slice(0, -1).join(', ')} & ${categories[categories.length - 1]}`;
}

function formatWeeklyRecap(recap) {
  const parts = [];
  if (recap.gatheringsAttended > 0) {
    parts.push(`${recap.gatheringsAttended} gathering${recap.gatheringsAttended === 1 ? '' : 's'}`);
  }
  if (recap.newFriends > 0) {
    parts.push(`${recap.newFriends} new connection${recap.newFriends === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export default function HomeScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors);
  const [dashboard, setDashboard] = useState(null);
  const [myName, setMyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [socialForecast, setSocialForecast] = useState(null);
  const [continueCommunities, setContinueCommunities] = useState([]);
  const [perksCount, setPerksCount] = useState(0);
  const [pendingInvitesCount, setPendingInvitesCount] = useState(0);
  const [unratedGathering, setUnratedGathering] = useState(null);
  const [pinnedQuickPicks, setPinnedQuickPicks] = useState(null);
  const [quickPicksEditVisible, setQuickPicksEditVisible] = useState(false);
  const period = getTimePeriod();

  const load = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const myId = sessionData?.session?.user?.id;
      if (myId) {
        const { data: profile } = await supabase.from('profiles').select('display_name, home_quick_pick_categories').eq('id', myId).single();
        setMyName(profile?.display_name?.split(' ')[0] ?? '');
        setPinnedQuickPicks(Array.isArray(profile?.home_quick_pick_categories) ? profile.home_quick_pick_categories : null);
      }
      const result = await getHomeDashboard();
      setDashboard(result);
      setLoadError(false);

      try {
        const communities = await getContinueYourCommunities();
        setContinueCommunities(communities);
        const perks = await getUnlockedPerksCount();
        setPerksCount(perks);
        const unrated = await getMostRecentUnratedGathering();
        setUnratedGathering(unrated);
        const pendingInvites = await getPendingInvitesCount(myId);
        setPendingInvitesCount(pendingInvites);
      } catch (e) {
        // These are supplementary cards, not core functionality — a
        // failure here should never block social forecast/location
        // code that runs afterward in the same function, nor the
        // core dashboard content that already rendered successfully.
        console.error('Continue Community / Perks / Feedback fetch failed', e);
      }

      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
          if (location) {
            const forecast = await getSocialForecast(location.coords.latitude, location.coords.longitude);
            setSocialForecast(forecast);
          }
        }
      } catch (e) {
        // Same reasoning as above — the weather card is a contextual
        // extra, not core content; a failure here shouldn't flip the
        // whole screen into an error state once the dashboard is up.
        console.error('Social forecast fetch failed', e);
      }
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
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

  function closeStartModal() {
    setStartModalVisible(false);
  }

  function handleQuickAction(item) {
    // Discover-first, unconditionally — every Quick Pick browses what
    // already exists in this category before offering to create one,
    // matching Home's own job ("what's happening in my life") as distinct
    // from Create's ("what can I make happen"). Previously, any category
    // with a StartSomethingModal SUB_OPTIONS entry (only "Dinner") silently
    // skipped this and opened the creation sub-grid instead — that
    // exception is closed; every chip now behaves the same way.
    // GatheringsScreen's own filtered-empty-state carries the "+ Start a
    // {category} Gathering" fallback, so the creation path isn't lost,
    // just reordered to after browsing turns up nothing.
    navigation.navigate('Gatherings', {
      initialCategoryFilter: item.category,
      initialDateFilter: PERIOD_DATE_FILTER[period],
    });
  }

  async function saveQuickPicks(categories) {
    setQuickPicksEditVisible(false);
    setPinnedQuickPicks(categories);
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) await supabase.from('profiles').update({ home_quick_pick_categories: categories }).eq('id', myId);
  }

  async function resetQuickPicksToAuto() {
    setQuickPicksEditVisible(false);
    setPinnedQuickPicks(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const myId = sessionData?.session?.user?.id;
    if (myId) await supabase.from('profiles').update({ home_quick_pick_categories: null }).eq('id', myId);
  }

  const quickPicks = pinnedQuickPicks && pinnedQuickPicks.length > 0
    ? getPinnedQuickPicks(pinnedQuickPicks, period, categoryStyleFor)
    : getPersonalizedQuickPicks(period, dashboard?.becauseYouLikeCategories, categoryStyleFor);
  const quickPicksAreCustom = pinnedQuickPicks && pinnedQuickPicks.length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        <Text style={styles.loadingText}>Finding what's happening near you...</Text>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadErrorState message="Couldn't load your home feed." onRetry={load} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>{getGreeting()}{myName ? `, ${myName}` : ''} 👋</Text>
        <Text style={styles.subtitle}>{PERIOD_SUBTITLES[period]}</Text>

        {(() => {
          const insight = getHomeInsight(dashboard);
          return insight ? <Text style={styles.insightLine}>{insight}</Text> : null;
        })()}

        {(pendingInvitesCount > 0 || perksCount > 0 || socialForecast || (dashboard?.sinceAway && (dashboard.sinceAway.newPeopleCount > 0 || dashboard.sinceAway.newGatheringsCount > 0))) && (
          <View style={{ marginBottom: spacing.md }}>
            {pendingInvitesCount > 0 && (
              <TouchableOpacity
                style={styles.pendingInvitesBanner}
                onPress={() => navigation.navigate('Matches', { initialSection: 'invitations' })}
                activeOpacity={0.85}
                accessibilityLabel={`${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'} and requests`}
                accessibilityRole="button"
              >
                <Text style={styles.pendingInvitesBannerText}>
                  🤝 {pendingInvitesCount} pending invite{pendingInvitesCount === 1 ? '' : 's'} &amp; request{pendingInvitesCount === 1 ? '' : 's'}
                </Text>
                <Text style={styles.pendingInvitesBannerArrow}>›</Text>
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
            {socialForecast && (
              <View style={styles.forecastCard}>
                <Text style={styles.forecastLabel}>🌤️ Right Now</Text>
                <Text style={styles.forecastValue}>{socialForecast.forecast_label}</Text>
                <Text style={styles.forecastDetail}>{socialForecast.forecast_detail}</Text>
                {socialForecast.forecast_label === 'Quiet' && dashboard?.indoorGatheringsToday?.length > 0 && (
                  <View style={styles.indoorSuggestions}>
                    <Text style={styles.indoorSuggestionsHeader}>
                      🏠 {dashboard.indoorGatheringsToday.length} indoor gathering{dashboard.indoorGatheringsToday.length === 1 ? '' : 's'} today
                    </Text>
                    {dashboard.indoorGatheringsToday.map((g) => (
                      <TouchableOpacity
                        key={g.id}
                        style={styles.indoorSuggestionRow}
                        onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                        activeOpacity={0.85}
                        accessibilityLabel={`${g.title}, ${formatHeroDateTime(g.scheduled_at)}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.indoorSuggestionIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                        <Text style={styles.indoorSuggestionText} numberOfLines={1}>{g.title}</Text>
                        <Text style={styles.indoorSuggestionTime}>{formatHeroDateTime(g.scheduled_at)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
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
          </View>
        )}

        {(dashboard?.plansGoing?.length > 0 || dashboard?.plansHosting?.length > 0) && (
          <>
            <Text style={styles.sectionHeader}>Your Plans</Text>
            <View style={styles.plansCard}>
              {dashboard.plansGoing.length > 0 && (
                <>
                  <Text style={styles.subLabel}>Going</Text>
                  {dashboard.plansGoing.map((plan) => (
                    <TouchableOpacity
                      key={plan.id}
                      style={styles.planRow}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                      activeOpacity={0.85}
                      accessibilityLabel={`${plan.title}, ${formatHeroDateTime(plan.scheduled_at)}, you're going`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.planIcon}>{categoryStyleFor(plan.interest_tag).icon}</Text>
                      <View style={styles.planInfo}>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                        <Text style={styles.planMeta}>
                          {formatHeroDateTime(plan.scheduled_at)} · <GatheringStatusBadge variant="inline" status="going" />
                        </Text>
                      </View>
                      <Text style={styles.planChevron}>›</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
              {dashboard.plansHosting.length > 0 && (
                <>
                  <Text style={[styles.subLabel, dashboard.plansGoing.length > 0 && styles.subLabelSpaced]}>Hosting</Text>
                  {dashboard.plansHosting.map((plan) => (
                    <TouchableOpacity
                      key={plan.id}
                      style={styles.planRow}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: plan.id })}
                      activeOpacity={0.85}
                      accessibilityLabel={`${plan.title}, ${formatHeroDateTime(plan.scheduled_at)}, you're hosting`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.planIcon}>{categoryStyleFor(plan.interest_tag).icon}</Text>
                      <View style={styles.planInfo}>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                        <Text style={styles.planMeta}>
                          {formatHeroDateTime(plan.scheduled_at)} · <GatheringStatusBadge variant="inline" status="hosting" />
                        </Text>
                      </View>
                      <Text style={styles.planChevron}>›</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
            <TouchableOpacity
              style={styles.seeAllPlansButton}
              onPress={() => navigation.navigate('Plans')}
              accessibilityLabel="See all plans"
              accessibilityRole="button"
            >
              <Text style={styles.seeAllPlansText}>See All Plans →</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.quickPicksHeaderRow}>
          <Text style={styles.sectionHeader}>{quickPicksAreCustom ? 'Quick Picks' : PERIOD_SECTION_LABELS[period]}</Text>
          <TouchableOpacity onPress={() => setQuickPicksEditVisible(true)} accessibilityRole="button" accessibilityLabel="Edit quick picks">
            <Text style={styles.quickPicksEditLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
          {quickPicks.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.quickActionChip}
              onPress={() => handleQuickAction(item)}
              activeOpacity={0.85}
              accessibilityLabel={item.label}
              accessibilityRole="button"
            >
              <Ionicons name={iconNameForCategory(item.category)} size={22} color={colors.primary} style={styles.quickActionIcon} />
              <Text style={styles.quickActionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {dashboard?.happeningNow?.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>🔥 Happening Near You</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
              {dashboard.happeningNow.map((g) => {
                const style = categoryStyleFor(g.interest_tag);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.happeningNowChip, { borderColor: style.color }]}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    activeOpacity={0.85}
                    accessibilityLabel={`${g.title}, ${g.interest_tag ?? 'General'}, happening now`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.happeningNowIcon}>{style.icon}</Text>
                    <Text style={styles.happeningNowLabel} numberOfLines={1}>{g.title}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {continueCommunities.length > 0 && (
          <>
            <Text style={styles.continueCommunityLabel}>🏘️ Your Communities</Text>
            {continueCommunities.map((community) => (
              <TouchableOpacity
                key={community.id}
                style={styles.continueCommunityCard}
                onPress={() => navigation.navigate('CommunityDetail', { communityId: community.id })}
                activeOpacity={0.85}
                accessibilityLabel={`Continue ${community.name}${community.recentMessageCount > 0 ? `, ${community.recentMessageCount} recent messages` : ''}`}
                accessibilityRole="button"
              >
                <Text style={styles.continueCommunityName}>{community.name}</Text>
                {community.recentMessageCount > 0 && (
                  <Text style={styles.continueCommunityDetail}>{community.recentMessageCount} new message{community.recentMessageCount === 1 ? '' : 's'} in the last day</Text>
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        <View style={styles.card}>
          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Nearby')} accessibilityLabel={`${dashboard?.nearbyPeopleCount ?? 0} people nearby, tap to view`} accessibilityRole="button">
            <Text style={styles.cardIcon}>👥</Text>
            <Text style={styles.cardText}>{dashboard?.nearbyPeopleCount ?? 0} people nearby</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'today' })} accessibilityLabel={`${dashboard?.gatheringsTodayCount ?? 0} gatherings today, tap to view`} accessibilityRole="button">
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

          <View style={styles.divider} />

          <TouchableOpacity style={styles.cardRow} onPress={() => navigation.navigate('Friends')} accessibilityLabel={`${dashboard?.friendsCount ?? 0} friends, tap to view`} accessibilityRole="button">
            <Text style={styles.cardIcon}>🤝</Text>
            <Text style={styles.cardText}>{dashboard?.friendsCount ?? 0} friend{dashboard?.friendsCount === 1 ? '' : 's'}</Text>
            <Text style={styles.cardChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {(dashboard?.bestPick || dashboard?.becauseYouLike?.length > 0 || dashboard?.trendingGatherings?.length > 0 || dashboard?.friendsActivity?.length > 0) && (
          <>
            <Text style={styles.sectionHeader}>✨ Because You Like…</Text>

            {dashboard?.becauseYouLike?.length > 0 && (
              <>
                <Text style={styles.subLabel}>💡 {formatCategoryList(dashboard.becauseYouLikeCategories)}</Text>
                {dashboard.becauseYouLike.map((g) => {
                  const style = categoryStyleFor(g.interest_tag);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.trendingCard}
                      onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                      accessibilityLabel={`${g.title}, ${g.interest_tag}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.trendingTitle}>{style.icon} {g.title}</Text>
                      <Text style={styles.trendingMeta}>{g.interest_tag} · {formatHeroDateTime(g.scheduled_at)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {dashboard?.bestPick && (
              <>
                <Text style={styles.subLabel}>⭐ Best Pick Tonight</Text>
                <TouchableOpacity
                  style={styles.bestPickCard}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: dashboard.bestPick.id })}
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
                <Text style={styles.subLabel}>🔥 Trending Near You</Text>
                {dashboard.trendingGatherings.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.trendingCard}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    accessibilityLabel={`${g.title}, ${g.approvedAttendees?.length ?? 0} attending`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.trendingTitle}>{g.title}</Text>
                    <Text style={styles.trendingMeta}>{g.approvedAttendees?.length ?? 0} attending · {g.distanceLabel}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {dashboard?.friendsActivity?.length > 0 && (
              <>
                <Text style={styles.subLabel}>👥 Friends' Activity</Text>
                {dashboard.friendsActivity.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.trendingCard}
                    onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                    accessibilityLabel={`${g.profiles?.display_name} is hosting ${g.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.trendingTitle}>{g.profiles?.display_name} is hosting</Text>
                    <Text style={styles.trendingMeta}>{g.title}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {dashboard?.weeklyRecap && (dashboard.weeklyRecap.gatheringsAttended > 0 || dashboard.weeklyRecap.newFriends > 0) && (
          <TouchableOpacity
            style={styles.recapCard}
            onPress={() => navigation.navigate('Momentum')}
            accessibilityLabel={`This week: ${formatWeeklyRecap(dashboard.weeklyRecap)}. View Momentum`}
            accessibilityRole="button"
          >
            <Text style={styles.recapSummary}>This week: {formatWeeklyRecap(dashboard.weeklyRecap)}</Text>
            <Text style={styles.recapLink}>View Momentum →</Text>
          </TouchableOpacity>
        )}

        {!dashboard?.bestPick && (!dashboard?.trendingGatherings || dashboard.trendingGatherings.length === 0) && (dashboard?.nearbyPeopleCount ?? 0) === 0 && (
          <View style={styles.quietCard}>
            <Text style={styles.quietTitle}>Quiet night nearby</Text>
            <Text style={styles.quietText}>Nothing notable happening right now — but that can change fast. Browse anyway, or check back later.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.browseButton} onPress={() => navigation.navigate('Discover')} accessibilityLabel="Continue browsing" accessibilityRole="button">
          <Text style={styles.browseButtonText}>Continue Browsing →</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, shadow.button]}
        onPress={() => setStartModalVisible(true)}
        activeOpacity={0.85}
        accessibilityLabel="Start something spontaneous"
        accessibilityRole="button"
      >
        <Text style={styles.fabText}>+ Start Something</Text>
      </TouchableOpacity>

      <StartSomethingModal
        visible={startModalVisible}
        onClose={closeStartModal}
        navigation={navigation}
      />
      <GatheringFeedbackModal
        visible={!!unratedGathering}
        gatheringId={unratedGathering?.id}
        navigation={navigation}
        onClose={() => setUnratedGathering(null)}
      />
      <QuickPicksEditModal
        visible={quickPicksEditVisible}
        onClose={() => setQuickPicksEditVisible(false)}
        initialPicks={pinnedQuickPicks ?? []}
        onSave={saveQuickPicks}
        onResetToAuto={resetQuickPicksToAuto}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greeting: { ...typography.title, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
  insightLine: { color: colors.primary, fontSize: 14, fontWeight: '600', marginBottom: spacing.lg, lineHeight: 19 },
  plansCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  planRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  planIcon: { fontSize: 22, marginRight: spacing.sm },
  planInfo: { flex: 1 },
  planTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  planMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  planChevron: { color: colors.textTertiary, fontSize: 18 },
  subLabelSpaced: { marginTop: spacing.md },
  seeAllPlansButton: { alignItems: 'center', paddingVertical: spacing.xs, marginBottom: spacing.lg },
  seeAllPlansText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  quickActionChip: {
    alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginRight: spacing.sm, minWidth: 84,
  },
  quickActionIcon: { marginBottom: 4 },
  quickActionLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  happeningNowChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1.5,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginRight: spacing.sm, maxWidth: 180,
  },
  happeningNowIcon: { fontSize: 16, marginRight: 6 },
  happeningNowLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
  pendingInvitesBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary,
    padding: spacing.md, marginBottom: spacing.md,
  },
  pendingInvitesBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  pendingInvitesBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  forecastCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  forecastLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  forecastValue: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  forecastDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  indoorSuggestions: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  indoorSuggestionsHeader: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  indoorSuggestionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  indoorSuggestionIcon: { fontSize: 14, marginRight: spacing.xs },
  indoorSuggestionText: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  indoorSuggestionTime: { color: colors.textTertiary, fontSize: 11, marginLeft: spacing.xs },
  sinceAwayBanner: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  sinceAwayTitle: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  sinceAwayItem: { color: colors.textPrimary, fontSize: 13, marginBottom: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.lg },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  cardIcon: { fontSize: 20, marginRight: spacing.sm },
  cardText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  cardChevron: { color: colors.textTertiary, fontSize: 18 },
  divider: { height: 1, backgroundColor: colors.border },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  quickPicksHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quickPicksEditLink: { ...typography.caption, color: colors.primary, marginBottom: spacing.sm },
  subLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.xs },
  bestPickCard: {
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  bestPickTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.sm },
  bestPickReasons: { marginBottom: spacing.sm },
  bestPickReason: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  bestPickAction: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  recapCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  recapSummary: { color: colors.textPrimary, fontSize: 13, flex: 1, marginRight: spacing.sm },
  recapLink: { color: colors.primary, fontWeight: '700', fontSize: 13 },
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