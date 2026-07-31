import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl, Alert, Image, ScrollView, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getNearbyGatherings, getMyGatherings, getMyAttendingGatherings, getFellowAttendees, expressInterest, approveInterest, getMyTopGatheringCategories, cancelGathering } from '../services/gatherings';
import { getMyFriends } from '../services/friends';
import { getPublicStoriesOnMap } from '../services/stories';
import InviteFriendsModal from '../components/InviteFriendsModal';
import NewcomerBadge from '../components/NewcomerBadge';
import BusinessHostBadge from '../components/BusinessHostBadge';
import { checkGatheringInterestLimit } from '../services/gatheringLimits';
import { isPremium } from '../services/purchases';
import { sendNoticeTo } from '../services/noticeActions';
import { getSignedPhotoUrl } from '../services/photos';
import { supabase } from '../services/supabase';
import { usePostHog } from 'posthog-react-native';
import ReportBlockModal from '../components/ReportBlockModal';
import AnimatedListItem from '../components/AnimatedListItem';
import SkeletonCard from '../components/SkeletonCard';
import GatheringsMapView from '../components/GatheringsMapView';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { getActiveOffers, getMyRedemptions } from '../services/brandOffers';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { typography, spacing, radius } from '../theme';

const INTEREST_OPTIONS = [
  'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
  'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
  'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
  'Volunteering', 'Meditation', 'Running', 'Faith & Spirituality',
];

const DATE_OPTIONS = [
  { key: 'anytime', label: 'Anytime' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'weekend', label: 'This Weekend' },
  { key: 'week', label: 'This Week' },
];

function matchesDateFilter(scheduledAt, filterKey) {
  if (filterKey === 'anytime') return true;
  const date = new Date(scheduledAt);
  const now = new Date();

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStart = startOfDay(now);

  if (filterKey === 'today') {
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    return date >= todayStart && date < tomorrowStart;
  }

  if (filterKey === 'tomorrow') {
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    return date >= tomorrowStart && date < dayAfterStart;
  }

  if (filterKey === 'weekend') {
    const dayOfWeek = todayStart.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    const saturdayStart = new Date(todayStart);
    saturdayStart.setDate(saturdayStart.getDate() + daysUntilSaturday);
    const mondayStart = new Date(saturdayStart);
    mondayStart.setDate(mondayStart.getDate() + 2);
    return date >= saturdayStart && date < mondayStart;
  }

  if (filterKey === 'week') {
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return date >= todayStart && date < weekEnd;
  }

  return true;
}

export default function GatheringsScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const { t } = useLanguage();
  const posthog = usePostHog();
  const styles = getStyles(colors, shadow);
  const [tab, setTab] = useState('nearby');
  const [radiusTier, setRadiusTier] = useState('local');
  const [nearby, setNearby] = useState([]);
  const [hosting, setHosting] = useState({ upcoming: [], past: [] });
  const [attending, setAttending] = useState({ upcoming: [], past: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState({});
  const [attendeePhotoUrls, setAttendeePhotoUrls] = useState({});
  const [reportTarget, setReportTarget] = useState(null);
  const [expandedGathering, setExpandedGathering] = useState(null);
  const [fellowAttendees, setFellowAttendees] = useState({});
  const [fellowPhotoUrls, setFellowPhotoUrls] = useState({});
  const [loadingFellows, setLoadingFellows] = useState(false);
  const [sentNoticeTo, setSentNoticeTo] = useState({});
  const [interestFilter, setInterestFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState('anytime');
  const [forYouActive, setForYouActive] = useState(false);
  const [topCategories, setTopCategories] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [newOfferCount, setNewOfferCount] = useState(0);
  const [viewStyle, setViewStyle] = useState('list');
  const [myFriendIds, setMyFriendIds] = useState(new Set());
  const [inviteModalGathering, setInviteModalGathering] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [expandedFilterSection, setExpandedFilterSection] = useState(null);
  const [mapDeals, setMapDeals] = useState([]);
  const [mapStories, setMapStories] = useState([]);
  const [mapStoryPhotoUrls, setMapStoryPhotoUrls] = useState({});
  const [attendingPastExpanded, setAttendingPastExpanded] = useState(false);
  const [hostingPastExpanded, setHostingPastExpanded] = useState(false);
  const [attendingPastSort, setAttendingPastSort] = useState('newest');
  const [hostingPastSort, setHostingPastSort] = useState('newest');

  const load = useCallback(async () => {
    const [nearbyResults, hostingResults, attendingResults, topCats] = await Promise.all([
      getNearbyGatherings(radiusTier),
      getMyGatherings(),
      getMyAttendingGatherings(),
      getMyTopGatheringCategories(),
    ]);
    setNearby(nearbyResults);
    setHosting(hostingResults);
    setAttending(attendingResults);
    setTopCategories(topCats);

    const urlEntries = await Promise.all(
      nearbyResults.map(async (g) => {
        const path = g.host?.photo_url;
        if (!path) return [g.id, null];
        const url = await getSignedPhotoUrl(path);
        return [g.id, url];
      })
    );
    setPhotoUrls(Object.fromEntries(urlEntries));

    const attendeeUrlEntries = await Promise.all(
      nearbyResults.flatMap((g) =>
        (g.approvedAttendees ?? []).map(async (a) => {
          const path = a.profiles?.photo_url;
          if (!path) return null;
          const url = await getSignedPhotoUrl(path);
          return [`${g.id}-${path}`, url];
        })
      )
    );
    setAttendeePhotoUrls(Object.fromEntries(attendeeUrlEntries.filter(Boolean)));

    const [offersData, redemptionsData] = await Promise.all([getActiveOffers(), getMyRedemptions()]);
    const unredeemed = offersData.filter((o) => !redemptionsData.includes(o.id));
    setNewOfferCount(unredeemed.length);
    setMapDeals(offersData.filter((o) => o.latitude != null && o.longitude != null));

    const publicStories = await getPublicStoriesOnMap();
    setMapStories(publicStories);
    const storyPosterIds = [...new Set(publicStories.map((s) => s.user_id))];
    if (storyPosterIds.length > 0) {
      const { data: posterProfiles } = await supabase.from('profiles').select('id, photo_url').in('id', storyPosterIds);
      const urlEntries = await Promise.all(
        (posterProfiles ?? []).map(async (p) => {
          if (!p.photo_url) return [p.id, null];
          const url = await getSignedPhotoUrl(p.photo_url);
          return [p.id, url];
        })
      );
      setMapStoryPhotoUrls(Object.fromEntries(urlEntries));
    }

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (location) {
        setUserLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
      }
    }

    const friendsList = await getMyFriends();
    setMyFriendIds(new Set(friendsList.map((f) => f.id)));

    setInitialLoading(false);
  }, [radiusTier]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  React.useEffect(() => {
    let channel;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`gathering-interest:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'gathering_interest' },
          () => {
            load();
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  async function onRefresh() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function toggleExpandGathering(gatheringId) {
    if (expandedGathering === gatheringId) {
      setExpandedGathering(null);
      return;
    }

    setExpandedGathering(gatheringId);

    if (!fellowAttendees[gatheringId]) {
      setLoadingFellows(true);
      const fellows = await getFellowAttendees(gatheringId);
      setFellowAttendees((prev) => ({ ...prev, [gatheringId]: fellows }));

      const urlEntries = await Promise.all(
        fellows.map(async (f) => {
          const path = f.profiles?.photo_url;
          if (!path) return null;
          const url = await getSignedPhotoUrl(path);
          return [f.user_id, url];
        })
      );
      setFellowPhotoUrls((prev) => ({ ...prev, ...Object.fromEntries(urlEntries.filter(Boolean)) }));
      setLoadingFellows(false);
    }
  }

  async function handleSendNoticeToFellow(userId) {
    try {
      await sendNoticeTo(userId, false);
      setSentNoticeTo((prev) => ({ ...prev, [userId]: true }));
    } catch (e) {
      if (e.message === 'ALREADY_SENT') {
        Alert.alert('Already sent', "You've already noticed this person.");
      } else {
        Alert.alert('Error', e.message);
      }
    }
  }

  async function handleExpressInterest(gatheringId) {
    const isUserPremium = await isPremium().catch(() => false);
    const limitCheck = await checkGatheringInterestLimit(isUserPremium);
    if (!limitCheck.allowed) {
      Alert.alert(
        'Daily limit reached',
        limitCheck.reason,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
        ]
      );
      return;
    }

    try {
      const result = await expressInterest(gatheringId);
      posthog.capture('gathering_interest_expressed');
      if (result?.autoApproved) {
        Alert.alert("You're In! ✓", "This gathering is public, so you're confirmed to attend — you can chat with the host anytime.", [
          { text: 'Keep Browsing', style: 'cancel' },
          { text: 'Send a Message', onPress: () => navigation.navigate('Matches') },
        ]);
      } else {
        Alert.alert("You're interested!", "The host will review and let you know.");
      }
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleApprove(interest) {
    try {
      await approveInterest(interest.id);
      Alert.alert('Approved!', 'A match was created — you can now chat with them.');
      load();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function confirmCancelGathering(gathering) {
    Alert.alert(
      `Cancel "${gathering.title}"?`,
      "This removes the gathering completely. Anyone who expressed interest won't be notified automatically.",
      [
        { text: 'Keep It', style: 'cancel' },
        {
          text: 'Cancel Gathering',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelGathering(gathering.id);
              load();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function toggleForYou() {
    if (forYouActive) {
      setForYouActive(false);
    } else {
      setForYouActive(true);
      setInterestFilter(null);
      posthog.capture('gatherings_for_you_used');
    }
  }

  function selectInterestFilter(option) {
    setInterestFilter(interestFilter === option ? null : option);
    setForYouActive(false);
  }

  function toggleFilterSection(section) {
    setExpandedFilterSection((prev) => (prev === section ? null : section));
  }

  const distanceSummary = radiusTier === 'local' ? 'Local (~1 mi)' : 'Wider Area (~15 mi)';
  const dateSummaryLabel = DATE_OPTIONS.find((d) => d.key === dateFilter)?.label ?? 'Anytime';
  const categorySummary = forYouActive ? 'For You' : (interestFilter || 'All Categories');

  const filteredNearby = nearby
    .filter((g) => forYouActive ? topCategories.includes(g.interest_tag) : (!interestFilter || g.interest_tag === interestFilter))
    .filter((g) => matchesDateFilter(g.scheduled_at, dateFilter))
    .filter((g) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return g.title?.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (!forYouActive) return 0;
      const aRank = topCategories.indexOf(a.interest_tag);
      const bRank = topCategories.indexOf(b.interest_tag);
      return aRank - bRank;
    });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('gatherings.title')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {(tab === 'nearby' || tab === 'attending' || tab === 'hosting') && (
            <TouchableOpacity
              style={styles.viewToggleButton}
              onPress={() => setViewStyle(viewStyle === 'map' ? 'list' : 'map')}
              accessibilityLabel={viewStyle === 'map' ? 'Currently on map view, switch to list view' : 'Currently on list view, switch to map view'}
              accessibilityRole="button"
            >
              <Text style={styles.viewToggleIcon}>{viewStyle === 'map' ? '📋' : '🗺️'}</Text>
              <Text style={styles.viewToggleLabel}>{viewStyle === 'map' ? 'List' : 'Map'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('CreateGathering')}
            accessibilityLabel="Host a new gathering"
            accessibilityRole="button"
          >
            <Text style={styles.createButtonText}>{t('gatherings.hostButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {newOfferCount > 0 && (
        <TouchableOpacity
          style={styles.offersBanner}
          onPress={() => navigation.navigate('BrandOffers')}
          activeOpacity={0.85}
          accessibilityLabel={`${newOfferCount} new offer${newOfferCount === 1 ? '' : 's'} available, tap to view`}
          accessibilityRole="button"
        >
          <Text style={styles.offersBannerText}>🎁 {newOfferCount} new offer{newOfferCount === 1 ? '' : 's'} available</Text>
          <Text style={styles.offersBannerArrow}>›</Text>
        </TouchableOpacity>
      )}

      <View style={styles.tabRow} accessibilityRole="tablist">
        <TouchableOpacity
          style={[styles.tab, tab === 'nearby' && styles.tabActive]}
          onPress={() => setTab('nearby')}
          accessibilityRole="tab"
          accessibilityLabel="Nearby gatherings"
          accessibilityState={{ selected: tab === 'nearby' }}
        >
          <Text style={[styles.tabText, tab === 'nearby' && styles.tabTextActive]}>{t('gatherings.nearbyTab')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'attending' && styles.tabActive]}
          onPress={() => setTab('attending')}
          accessibilityRole="tab"
          accessibilityLabel="Gatherings you're attending"
          accessibilityState={{ selected: tab === 'attending' }}
        >
          <Text style={[styles.tabText, tab === 'attending' && styles.tabTextActive]}>{t('gatherings.attendingTab')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'hosting' && styles.tabActive]}
          onPress={() => setTab('hosting')}
          accessibilityRole="tab"
          accessibilityLabel="Gatherings you're hosting"
          accessibilityState={{ selected: tab === 'hosting' }}
        >
          <Text style={[styles.tabText, tab === 'hosting' && styles.tabTextActive]}>{t('gatherings.hostingTab')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'nearby' && (
        <>
        <View style={styles.searchBarWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search gatherings..."
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search gatherings by title or description"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.accordionContainer}>
          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => toggleFilterSection('distance')}
            accessibilityLabel={`Distance: ${distanceSummary}, ${expandedFilterSection === 'distance' ? 'tap to collapse' : 'tap to expand'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: expandedFilterSection === 'distance' }}
          >
            <Text style={styles.accordionHeaderLabel}>📍 Distance</Text>
            <View style={styles.accordionHeaderRight}>
              <Text style={styles.accordionHeaderValue}>{distanceSummary}</Text>
              <Text style={styles.accordionChevron}>{expandedFilterSection === 'distance' ? '⌃' : '⌄'}</Text>
            </View>
          </TouchableOpacity>
          {expandedFilterSection === 'distance' && (
            <View style={styles.accordionBody}>
              <View style={styles.radiusToggleRow}>
                <TouchableOpacity
                  style={[styles.radiusToggle, radiusTier === 'local' && styles.radiusToggleActive]}
                  onPress={() => setRadiusTier('local')}
                  accessibilityLabel="Local gatherings, within about a mile"
                  accessibilityRole="button"
                  accessibilityState={{ selected: radiusTier === 'local' }}
                >
                  <Text style={[styles.radiusToggleText, radiusTier === 'local' && styles.radiusToggleTextActive]}>📍 Local (~1 mi)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.radiusToggle, radiusTier === 'wide' && styles.radiusToggleActive]}
                  onPress={() => setRadiusTier('wide')}
                  accessibilityLabel="Wider area gatherings, within about 15 miles"
                  accessibilityRole="button"
                  accessibilityState={{ selected: radiusTier === 'wide' }}
                >
                  <Text style={[styles.radiusToggleText, radiusTier === 'wide' && styles.radiusToggleTextActive]}>🗺️ Wider Area (~15 mi)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.accordionDivider} />

          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => toggleFilterSection('when')}
            accessibilityLabel={`When: ${dateSummaryLabel}, ${expandedFilterSection === 'when' ? 'tap to collapse' : 'tap to expand'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: expandedFilterSection === 'when' }}
          >
            <Text style={styles.accordionHeaderLabel}>📅 When</Text>
            <View style={styles.accordionHeaderRight}>
              <Text style={styles.accordionHeaderValue}>{dateSummaryLabel}</Text>
              <Text style={styles.accordionChevron}>{expandedFilterSection === 'when' ? '⌃' : '⌄'}</Text>
            </View>
          </TouchableOpacity>
          {expandedFilterSection === 'when' && (
            <View style={styles.accordionBody}>
              <View style={styles.chipsWrapInline}>
                {DATE_OPTIONS.map((option) => {
                  const active = dateFilter === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.dateChip, active && styles.dateChipActive]}
                      onPress={() => setDateFilter(option.key)}
                      accessibilityLabel={`Filter by ${option.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.accordionDivider} />

          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => toggleFilterSection('category')}
            accessibilityLabel={`Category: ${categorySummary}, ${expandedFilterSection === 'category' ? 'tap to collapse' : 'tap to expand'}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: expandedFilterSection === 'category' }}
          >
            <Text style={styles.accordionHeaderLabel}>🏷️ Category</Text>
            <View style={styles.accordionHeaderRight}>
              <Text style={styles.accordionHeaderValue}>{categorySummary}</Text>
              <Text style={styles.accordionChevron}>{expandedFilterSection === 'category' ? '⌃' : '⌄'}</Text>
            </View>
          </TouchableOpacity>
          {expandedFilterSection === 'category' && (
            <View style={styles.accordionBody}>
              <View style={styles.chipsWrapInline}>
                {topCategories.length > 0 ? (
                  <TouchableOpacity
                    style={[styles.forYouChip, forYouActive && styles.forYouChipActive]}
                    onPress={toggleForYou}
                    accessibilityLabel="For You — based on gatherings you've attended or shown interest in before"
                    accessibilityRole="button"
                    accessibilityState={{ selected: forYouActive }}
                  >
                    <Text style={[styles.forYouChipText, forYouActive && styles.forYouChipTextActive]}>⭐ For You</Text>
                  </TouchableOpacity>
                ) : (
                  <View
                    style={styles.forYouChipLocked}
                    accessibilityLabel="For You — will unlock once you've shown interest in a gathering"
                  >
                    <Text style={styles.forYouChipLockedText}>⭐ For You (soon)</Text>
                  </View>
                )}
                {INTEREST_OPTIONS.map((option) => {
                  const active = interestFilter === option;
                  const style = categoryStyleFor(option);
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.filterChip, active && { backgroundColor: style.color, borderColor: style.color }]}
                      onPress={() => selectInterestFilter(option)}
                      accessibilityLabel={`Filter by ${option}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{style.icon} {option}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

        </View>
        </>
      )}

      {tab === 'nearby' && initialLoading ? (
        <View>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : tab === 'nearby' && viewStyle === 'map' ? (
        <View style={{ flex: 1 }}>
          <GatheringsMapView
            gatherings={filteredNearby}
            deals={mapDeals}
            stories={mapStories}
            storyPhotoUrls={mapStoryPhotoUrls}
            userLocation={userLocation}
            onSelectGathering={(gathering) => {
              Alert.alert(
                gathering.title,
                `Hosted by ${gathering.host?.display_name}\n${gathering.distanceLabel}${gathering.description ? '\n\n' + gathering.description : ''}`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: t('gatherings.imInterested'), onPress: () => handleExpressInterest(gathering.id) },
                ]
              );
            }}
            onSelectStory={(story) => {
              Alert.alert('Public Story', 'View this story?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'View', onPress: () => navigation.navigate('ViewProfile', { userId: story.user_id }) },
              ]);
            }}
            onSelectDeal={(deal) => {
              Alert.alert(
                deal.title,
                `${deal.brand_partners?.name}${deal.description ? '\n\n' + deal.description : ''}`,
                [
                  { text: 'Close', style: 'cancel' },
                  {
                    text: 'Host a Gathering Here',
                    onPress: () => navigation.navigate('CreateGathering', {
                      selectedLat: deal.latitude,
                      selectedLng: deal.longitude,
                    }),
                  },
                ]
              );
            }}
          />
        </View>
      ) : tab === 'nearby' && (
        <FlatList
          data={filteredNearby}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            forYouActive ? (
              <Text style={styles.forYouHint}>Based on gatherings you've attended or shown interest in before.</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎉</Text>
              <Text style={styles.emptyText}>{forYouActive ? "Nothing matching your history right now — check back later." : ((interestFilter || dateFilter !== 'anytime') ? 'No gatherings match these filters right now.' : t('gatherings.emptyNearby'))}</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const categoryStyle = categoryStyleFor(item.interest_tag);
            return (
              <AnimatedListItem index={index}>
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }, item.matchesYourInterests && styles.matchCard]}>
                <View style={styles.cardTopRow}>
                  <View
                    style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}
                    accessibilityLabel={item.interest_tag ? `Category: ${item.interest_tag}` : 'Category: General'}
                  >
                    <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                  </View>
                  {photoUrls[item.id] && <Image source={{ uri: photoUrls[item.id] }} style={styles.hostAvatar} accessibilityLabel={`${item.host?.display_name}'s photo`} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.hostName}>{t('gatherings.hostedBy')} {item.host?.display_name}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.moreButton}
                    onPress={() => setReportTarget({ id: item.host_id, name: item.host?.display_name })}
                    accessibilityLabel={`Report or block ${item.host?.display_name}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.moreButtonText}>⋯</Text>
                  </TouchableOpacity>
                </View>
                {item.women_only && (
                  <View style={styles.womenOnlyBadge}>
                    <Text style={styles.womenOnlyBadgeText}>👩 Women Only</Text>
                  </View>
                )}
                {item.matchesYourInterests && (
                  <View style={styles.matchBadge}>
                    <Text style={styles.matchBadgeText}>{t('gatherings.matchesInterests')}</Text>
                  </View>
                )}
                {(() => {
                  const interestedFriendsCount = (item.approvedAttendees ?? []).filter((a) => myFriendIds.has(a.user_id)).length;
                  return interestedFriendsCount > 0 ? (
                    <View style={styles.friendsInterestedBadge}>
                      <Text style={styles.friendsInterestedText}>
                        🤝 {interestedFriendsCount} friend{interestedFriendsCount === 1 ? '' : 's'} interested
                      </Text>
                    </View>
                  ) : null;
                })()}
                <NewcomerBadge gatheringId={item.id} />
                <BusinessHostBadge hostingPartnerId={item.hosting_partner_id} />
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <View style={styles.metaRow}>
                  <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                  {item.distanceLabel && <Text style={styles.distance}>· {item.distanceLabel}</Text>}
                </View>

                {item.approvedAttendees?.length > 0 && (
                  <View style={styles.attendeesRow}>
                    <View style={styles.attendeeAvatars}>
                      {item.approvedAttendees.slice(0, 4).map((attendee, i) => {
                        const url = attendeePhotoUrls[`${item.id}-${attendee.profiles?.photo_url}`];
                        return url ? (
                          <Image
                            key={i}
                            source={{ uri: url }}
                            style={[styles.attendeeAvatar, { marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i }]}
                          />
                        ) : null;
                      })}
                    </View>
                    <Text style={styles.attendeesText}>
                      {item.approvedAttendees.length === 1
                        ? `${item.approvedAttendees[0].profiles?.display_name} is attending`
                        : `${item.approvedAttendees.length} people attending`}
                    </Text>
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity
                    style={[styles.interestButton, { backgroundColor: categoryStyle.color, flex: 1 }]}
                    onPress={() => handleExpressInterest(item.id)}
                    activeOpacity={0.85}
                    accessibilityLabel={`Express interest in ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.interestButtonText}>{t('gatherings.imInterested')}</Text>
                  </TouchableOpacity>
                  {myFriendIds.size > 0 && (
                    <TouchableOpacity
                      style={styles.inviteFriendsButton}
                      onPress={() => setInviteModalGathering(item)}
                      activeOpacity={0.85}
                      accessibilityLabel={`Invite friends to ${item.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.inviteFriendsButtonText}>🤝</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              </AnimatedListItem>
            );
          }}
        />
      )}

      {tab === 'attending' && viewStyle === 'map' ? (
        <View style={{ flex: 1 }}>
          <GatheringsMapView
            gatherings={attending.upcoming}
            userLocation={userLocation}
            onSelectGathering={(gathering) => {
              Alert.alert(
                gathering.title,
                `Hosted by ${gathering.host?.display_name}${gathering.description ? '\n\n' + gathering.description : ''}`,
                [{ text: 'OK' }]
              );
            }}
          />
        </View>
      ) : tab === 'attending' && (
        <FlatList
          data={[
            ...(attending.upcoming.length > 0 ? [{ type: 'header', key: 'upcoming-header', label: 'Upcoming' }] : []),
            ...attending.upcoming.map((g) => ({ type: 'gathering', key: g.id, gathering: g })),
            ...(attending.past.length > 0 ? [{ type: 'header', key: 'past-header', label: `Past (${attending.past.length})`, collapsible: true, expanded: attendingPastExpanded, onToggle: () => setAttendingPastExpanded((v) => !v), sortable: true, sortValue: attendingPastSort, onSortToggle: () => setAttendingPastSort((v) => v === 'newest' ? 'oldest' : 'newest') }] : []),
            ...(attendingPastExpanded ? [...attending.past].sort((a, b) => attendingPastSort === 'newest' ? new Date(b.scheduled_at) - new Date(a.scheduled_at) : new Date(a.scheduled_at) - new Date(b.scheduled_at)).map((g) => ({ type: 'gathering', key: `past-${g.id}`, gathering: g, isPast: true })) : []),
          ]}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>✅</Text>
              <Text style={styles.emptyText}>{t('gatherings.emptyAttending')}</Text>
            </View>
          }
          renderItem={({ item: row }) => {
            if (row.type === 'header') {
              if (row.collapsible) {
                return (
                  <View>
                    <TouchableOpacity onPress={row.onToggle} style={styles.collapsibleHeaderRow} accessibilityLabel={`${row.label}, ${row.expanded ? 'tap to collapse' : 'tap to expand'}`} accessibilityRole="button">
                      <Text style={styles.attendingSectionHeader}>{row.label}</Text>
                      <Text style={styles.collapsibleChevron}>{row.expanded ? '⌃' : '⌄'}</Text>
                    </TouchableOpacity>
                    {row.expanded && row.sortable && (
                      <TouchableOpacity onPress={row.onSortToggle} accessibilityLabel={`Sorted ${row.sortValue}, tap to switch`} accessibilityRole="button">
                        <Text style={styles.sortToggleText}>Sort: {row.sortValue === 'newest' ? 'Newest first' : 'Oldest first'} ⇅</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }
              return <Text style={styles.attendingSectionHeader}>{row.label}</Text>;
            }
            const item = row.gathering;
            const isPast = row.isPast;
            const categoryStyle = categoryStyleFor(item.interest_tag);
            const isExpanded = expandedGathering === item.id;
            const fellows = fellowAttendees[item.id] ?? [];
            return (
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }, isPast && styles.pastCard]}>
                <TouchableOpacity
                  onPress={() => !isPast && toggleExpandGathering(item.id)}
                  disabled={isPast}
                  activeOpacity={0.85}
                  accessibilityLabel={`${item.title}, ${isExpanded ? 'showing' : 'show'} who else is attending`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                >
                  <View style={styles.cardTopRow}>
                    <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
                      <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{item.title}</Text>
                      <Text style={styles.hostName}>{t('gatherings.hostedBy')} {item.host?.display_name}</Text>
                    </View>
                    <Text style={styles.expandChevron}>{isExpanded ? '⌃' : '⌄'}</Text>
                  </View>
                  {(() => {
                    const interestedFriendsCount = (item.approvedAttendees ?? []).filter((a) => myFriendIds.has(a.user_id)).length;
                    return interestedFriendsCount > 0 ? (
                      <View style={styles.friendsInterestedBadge}>
                        <Text style={styles.friendsInterestedText}>
                          🤝 {interestedFriendsCount} friend{interestedFriendsCount === 1 ? '' : 's'} also going
                        </Text>
                      </View>
                    ) : null;
                  })()}
                  {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                  <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                  <View style={[styles.attendingBadge, isPast && styles.pastBadge]}>
                    <Text style={[styles.attendingBadgeText, isPast && styles.pastBadgeText]}>{isPast ? '✓ Attended' : t('gatherings.youreGoing')}</Text>
                  </View>
                </TouchableOpacity>

                {!isPast && (
                  <TouchableOpacity
                    style={styles.groupChatButton}
                    onPress={() => navigation.navigate('GatheringChat', { gatheringId: item.id, gatheringTitle: item.title })}
                    accessibilityLabel={`Open group chat for ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.groupChatButtonText}>💬 Group Chat</Text>
                  </TouchableOpacity>
                )}
                {isExpanded && !isPast && (
                  <View style={styles.fellowSection}>
                    <Text style={styles.fellowSectionLabel}>{t('gatherings.whoElseGoing')}</Text>
                    {loadingFellows && !fellowAttendees[item.id] && (
                      <Text style={styles.emptyText}>{t('gatherings.loadingText')}</Text>
                    )}
                    {fellows.length === 0 && fellowAttendees[item.id] && (
                      <Text style={styles.fellowEmptyText}>{t('gatherings.noOneElseApproved')}</Text>
                    )}
                    {fellows.map((fellow) => (
                      <View key={fellow.user_id} style={styles.fellowRow}>
                        <TouchableOpacity
                          style={styles.fellowInfo}
                          onPress={() => navigation.navigate('ViewProfile', { userId: fellow.user_id })}
                          activeOpacity={0.85}
                          accessibilityLabel={`View ${fellow.profiles?.display_name}'s profile`}
                          accessibilityRole="button"
                        >
                          {fellowPhotoUrls[fellow.user_id] ? (
                            <Image source={{ uri: fellowPhotoUrls[fellow.user_id] }} style={styles.fellowAvatar} />
                          ) : (
                            <View style={[styles.fellowAvatar, styles.fellowAvatarPlaceholder]} />
                          )}
                          <Text style={styles.fellowName}>{fellow.profiles?.display_name}</Text>
                        </TouchableOpacity>
                        {sentNoticeTo[fellow.user_id] ? (
                          <Text style={styles.noticeSentText}>{t('gatherings.noticeSent')}</Text>
                        ) : (
                          <TouchableOpacity
                            style={styles.fellowNoticeButton}
                            onPress={() => handleSendNoticeToFellow(fellow.user_id)}
                            activeOpacity={0.85}
                            accessibilityLabel={`Send a notice to ${fellow.profiles?.display_name}`}
                            accessibilityRole="button"
                          >
                            <Text style={styles.fellowNoticeButtonText}>{t('gatherings.sendNotice')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {tab === 'hosting' && viewStyle === 'map' ? (
        <View style={{ flex: 1 }}>
          <GatheringsMapView
            gatherings={hosting.upcoming}
            userLocation={userLocation}
            onSelectGathering={(gathering) => {
              Alert.alert(
                gathering.title,
                gathering.description || 'No description',
                [{ text: 'OK' }]
              );
            }}
          />
        </View>
      ) : tab === 'hosting' && (
        <FlatList
          data={[
            ...(hosting.upcoming.length > 0 ? [{ type: 'header', key: 'hosting-upcoming-header', label: 'Upcoming' }] : []),
            ...hosting.upcoming.map((g) => ({ type: 'gathering', key: g.id, gathering: g })),
            ...(hosting.past.length > 0 ? [{ type: 'header', key: 'hosting-past-header', label: `Past (${hosting.past.length})`, collapsible: true, expanded: hostingPastExpanded, onToggle: () => setHostingPastExpanded((v) => !v), sortable: true, sortValue: hostingPastSort, onSortToggle: () => setHostingPastSort((v) => v === 'newest' ? 'oldest' : 'newest') }] : []),
            ...(hostingPastExpanded ? [...hosting.past].sort((a, b) => hostingPastSort === 'newest' ? new Date(b.scheduled_at) - new Date(a.scheduled_at) : new Date(a.scheduled_at) - new Date(b.scheduled_at)).map((g) => ({ type: 'gathering', key: `past-${g.id}`, gathering: g, isPast: true })) : []),
          ]}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyText}>{t('gatherings.emptyHosting')}</Text>
            </View>
          }
          renderItem={({ item: row }) => {
            if (row.type === 'header') {
             if (row.collapsible) {
                return (
                  <View>
                    <TouchableOpacity onPress={row.onToggle} style={styles.collapsibleHeaderRow} accessibilityLabel={`${row.label}, ${row.expanded ? 'tap to collapse' : 'tap to expand'}`} accessibilityRole="button">
                      <Text style={styles.attendingSectionHeader}>{row.label}</Text>
                      <Text style={styles.collapsibleChevron}>{row.expanded ? '⌃' : '⌄'}</Text>
                    </TouchableOpacity>
                    {row.expanded && row.sortable && (
                      <TouchableOpacity onPress={row.onSortToggle} accessibilityLabel={`Sorted ${row.sortValue}, tap to switch`} accessibilityRole="button">
                        <Text style={styles.sortToggleText}>Sort: {row.sortValue === 'newest' ? 'Newest first' : 'Oldest first'} ⇅</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }
              return <Text style={styles.attendingSectionHeader}>{row.label}</Text>;
            }
            const item = row.gathering;
            const isPast = row.isPast;
            const categoryStyle = categoryStyleFor(item.interest_tag);
            return (
              <View style={[styles.card, { borderLeftColor: categoryStyle.color, borderLeftWidth: 4 }, isPast && styles.pastCard]}>
                <View style={styles.cardTopRow}>
                  <View style={[styles.categoryBadge, { backgroundColor: categoryStyle.color + '30' }]}>
                    <Text style={styles.categoryBadgeIcon}>{categoryStyle.icon}</Text>
                  </View>
                  <Text style={[styles.title, { flex: 1 }]}>{item.title}</Text>
                  {!isPast && myFriendIds.size > 0 && (
                    <TouchableOpacity
                      onPress={() => setInviteModalGathering(item)}
                      style={{ marginRight: spacing.sm }}
                      accessibilityLabel={`Invite friends to ${item.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={{ fontSize: 18 }}>🤝</Text>
                    </TouchableOpacity>
                  )}
                  {!isPast && (
                    <TouchableOpacity
                      onPress={() => confirmCancelGathering(item)}
                      accessibilityLabel={`Cancel ${item.title}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cancelGatheringText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.time}>{formatDate(item.scheduled_at)}</Text>
                {!isPast && (
                  <TouchableOpacity
                    style={styles.groupChatButton}
                    onPress={() => navigation.navigate('GatheringChat', { gatheringId: item.id, gatheringTitle: item.title })}
                    accessibilityLabel={`Open group chat for ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.groupChatButtonText}>💬 Group Chat</Text>
                  </TouchableOpacity>
                )}
                {item.interested?.length > 0 ? (
                  item.interested.map((interest) => (
                    <View key={interest.id} style={styles.interestRow}>
                      <Text style={styles.interestName}>{interest.profiles?.display_name}</Text>
                      {isPast ? (
                        <Text style={styles.approvedLabel}>{interest.status === 'approved' ? '✓ Attended' : 'Did not attend'}</Text>
                      ) : interest.status === 'pending' ? (
                        <TouchableOpacity
                          style={styles.approveButton}
                          onPress={() => handleApprove(interest)}
                          accessibilityLabel={`Approve ${interest.profiles?.display_name}'s interest`}
                          accessibilityRole="button"
                        >
                          <Text style={styles.approveButtonText}>{t('gatherings.approve')}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.approvedLabel}>{t('gatherings.approved')}</Text>
                      )}
                    </View>
                  ))
                ) : (
                  <Text style={styles.noInterestText}>{t('gatherings.noInterestYet')}</Text>
                )}
              </View>
            );
          }}
        />
      )}

      <ReportBlockModal
        visible={!!reportTarget}
        onClose={() => {
          setReportTarget(null);
          load();
        }}
        onBlocked={() => {
          setReportTarget(null);
          load();
        }}
        reportedUserId={reportTarget?.id}
        reportedUserName={reportTarget?.name}
      />

      <InviteFriendsModal
        visible={!!inviteModalGathering}
        onClose={() => setInviteModalGathering(null)}
        gatheringId={inviteModalGathering?.id}
        gatheringTitle={inviteModalGathering?.title}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  headerTitle: { ...typography.title, color: colors.textPrimary },
  createButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  viewToggleButton: {
    flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  viewToggleIcon: { fontSize: 16, marginRight: 6 },
  viewToggleLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  offersBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.primaryMuted, borderRadius: radius.lg, padding: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md, borderWidth: 1, borderColor: colors.primary,
  },
  offersBannerText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  offersBannerArrow: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.xs },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  tabTextActive: { color: '#fff' },
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  searchClear: { color: colors.textTertiary, fontSize: 14, paddingHorizontal: spacing.xs },
  accordionContainer: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  accordionHeaderLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  accordionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  accordionHeaderValue: { color: colors.textTertiary, fontSize: 13 },
  accordionChevron: { color: colors.textTertiary, fontSize: 14 },
  accordionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  accordionDivider: { height: 1, backgroundColor: colors.border },
  chipsWrapInline: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  radiusToggleRow: { flexDirection: 'row', gap: spacing.xs },
  radiusToggle: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center',
  },
  radiusToggleActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  radiusToggleText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  radiusToggleTextActive: { color: colors.primary },
  filterRow: { flexGrow: 0, marginTop: spacing.md },
  forYouChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  forYouChipActive: { backgroundColor: colors.primary },
  forYouChipText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  forYouChipTextActive: { color: '#fff' },
  forYouChipLocked: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, opacity: 0.6,
  },
  forYouChipLockedText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
  forYouHint: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.md, fontStyle: 'italic' },
  dateChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dateChipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  dateChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  dateChipTextActive: { color: colors.background },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl },
  emptyEmoji: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...typography.body, color: colors.textTertiary, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  matchCard: { borderColor: colors.primary },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  categoryBadge: { width: 36, height: 36, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm },
  categoryBadgeIcon: { fontSize: 18 },
  hostAvatar: { width: 32, height: 32, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  title: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 16 },
  hostName: { ...typography.small, color: colors.textTertiary },
  moreButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  moreButtonText: { color: colors.textTertiary, fontSize: 18, fontWeight: '700' },
  expandChevron: { color: colors.textTertiary, fontSize: 16, paddingHorizontal: spacing.sm },
  matchBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm },
  matchBadgeText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  womenOnlyBadge: { alignSelf: 'flex-start', backgroundColor: '#f9a8d4', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm },
  womenOnlyBadgeText: { color: '#831843', fontSize: 11, fontWeight: '700' },
  friendsInterestedBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  friendsInterestedText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  description: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  time: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  distance: { ...typography.caption, color: colors.textTertiary },
  attendeesRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  attendeeAvatars: { flexDirection: 'row', marginRight: spacing.sm },
  attendeeAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.surface, backgroundColor: colors.surfaceElevated },
  attendeesText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  attendingSectionHeader: {
    ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  collapsibleHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  collapsibleChevron: { color: colors.textTertiary, fontSize: 14, marginTop: spacing.lg },
  sortToggleText: { color: colors.primary, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm },
  pastCard: { opacity: 0.6 },
  pastBadge: { backgroundColor: colors.surfaceElevated },
  pastBadgeText: { color: colors.textTertiary },
  attendingBadge: { alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm },
  attendingBadgeText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  groupChatButton: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  groupChatButtonText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  fellowSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  fellowSectionLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  fellowEmptyText: { color: colors.textTertiary, fontSize: 13 },
  fellowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  fellowInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  fellowAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
  fellowAvatarPlaceholder: {},
  fellowName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  fellowNoticeButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  fellowNoticeButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  noticeSentText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  interestButton: { borderRadius: radius.full, paddingVertical: 10, alignItems: 'center' },
  interestButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  inviteFriendsButton: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    width: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  inviteFriendsButtonText: { fontSize: 16 },
  interestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  interestName: { color: colors.textPrimary, fontSize: 14 },
  approveButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  approveButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  approvedLabel: { color: colors.success, fontSize: 12, fontWeight: '700' },
  noInterestText: { color: colors.textTertiary, fontSize: 13 },
  cancelGatheringText: { color: colors.primary, fontSize: 12, opacity: 0.7, fontWeight: '600' },
});