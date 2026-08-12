import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, SafeAreaView, Modal, FlatList, TextInput, ActivityIndicator, Linking } from 'react-native';
import * as Location from 'expo-location';
import { Video } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import { getSignedStoryUrl, getPublicStoriesGrouped, getGatheringStoriesGrouped } from '../services/stories';
import { getSignedPhotoUrl } from '../services/photos';
import { getNearbyGatherings, searchGatherings, getSignedGatheringPhotoUrl, getGatheringFitReasons } from '../services/gatherings';
import { getPublicCommunities, getMyCommunities, searchPublicCommunities } from '../services/communities';
import { getActiveOffers, getNearbyBusinesses, searchOffers } from '../services/brandOffers';
import { searchNearbyPlaces, getPlacePhotoUrl } from '../services/places';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import StoryViewerModal from '../components/StoryViewerModal';
import GatheringsMapView from '../components/GatheringsMapView';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'gatherings', label: 'Gatherings' },
  { key: 'communities', label: 'Communities' },
  { key: 'places', label: 'Places' },
  { key: 'perks', label: 'Perks' },
];

const PLACE_CATEGORIES = [
  { key: 'coffee', icon: '☕', label: 'Coffee' },
  { key: 'restaurants', icon: '🍽️', label: 'Restaurants' },
  { key: 'parks', icon: '🌳', label: 'Parks' },
  { key: 'hubs', icon: '🏛️', label: 'Hubs' },
];

const PREVIEW_COUNT = 3;

// A real unified search + filter + map/list surface across the four
// browsable, listable content types (gatherings, communities, places,
// perks). People are deliberately kept as a separate entry card, not
// folded into unified text search — this is a proximity dating app,
// and search-by-name over nearby people is a stalking vector this
// codebase has never built anywhere else; Browse/Crossed Paths on the
// dedicated Nearby screen remains the only way to find people. "Card"
// view (the doc's third view style) was also left out: DiscoveryScreen
// already owns a dedicated swipe-card interaction for people, and a
// generic "everything" card view would need a bespoke action per
// content type with no single natural gesture — not built here.
// "AI recommendations" is a real, signal-based "Recommended for you"
// section (getGatheringFitReasons, the same pure scorer already used
// by Home's bestPick and GatheringDetailScreen) rather than a new LLM
// call, matching this codebase's existing no-new-API-cost convention.
export default function DiscoverHubScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  const [publicStories, setPublicStories] = useState([]);
  const [gatheringStories, setGatheringStories] = useState([]);
  const [gatheringStoryViewer, setGatheringStoryViewer] = useState(null);
  const [storyPhotoUrls, setStoryPhotoUrls] = useState({});
  const [viewerTarget, setViewerTarget] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewStyle, setViewStyle] = useState('list');
  const [placesCategory, setPlacesCategory] = useState('coffee');
  const [userLocation, setUserLocation] = useState(null);

  const [gatherings, setGatherings] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [offers, setOffers] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [places, setPlaces] = useState([]);
  const [coverPhotoUrls, setCoverPhotoUrls] = useState({});

  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const placesRequestId = useRef(0);

  // Real search results for gatherings/communities, fetched server-side via
  // searchGatherings()/searchPublicCommunities() (indexed ILIKE queries)
  // instead of filtering the already-fetched `gatherings`/`communities`
  // arrays client-side. Only populated once a real search is active — see
  // the debounced effect below.
  const [searchedGatherings, setSearchedGatherings] = useState([]);
  const [searchedCommunities, setSearchedCommunities] = useState([]);
  const [searchedOffers, setSearchedOffers] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const searchRequestId = useRef(0);
  const joinedCommunityIdsRef = useRef(new Set());

  useFocusEffect(
    useCallback(() => {
      loadPublicStories();
      loadGatheringStories();
      loadCore();
    }, [])
  );

  async function loadCore() {
    setLoadingCore(true);
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      let loc = null;
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
        if (position) {
          loc = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setUserLocation(loc);
        }
      }

      const [gatheringsData, publicCommunities, myCommunities, offersData, businessesData] = await Promise.all([
        getNearbyGatherings('wide'),
        getPublicCommunities(),
        getMyCommunities(),
        getActiveOffers(loc?.latitude ?? null, loc?.longitude ?? null),
        getNearbyBusinesses(loc?.latitude ?? null, loc?.longitude ?? null),
      ]);

      const joinedCommunityIds = new Set(myCommunities.map((c) => c.id));
      joinedCommunityIdsRef.current = joinedCommunityIds;
      setGatherings(gatheringsData);
      setCommunities(publicCommunities.filter((c) => !joinedCommunityIds.has(c.id)));
      setOffers(offersData);
      setBusinesses(businessesData);

      const coverEntries = await Promise.all(
        gatheringsData.map(async (g) => {
          if (!g.cover_photo_path) return null;
          const url = await getSignedGatheringPhotoUrl(g.cover_photo_path);
          return [g.id, url];
        })
      );
      setCoverPhotoUrls(Object.fromEntries(coverEntries.filter(Boolean)));
    } catch (e) {
      console.error('Discover loadCore failed', e);
    }
    setLoadingCore(false);
  }

  // Places is a metered external API (Google Places), so unlike the
  // three sources above it's fetched on-demand only: when someone
  // actually looks at Places, or types a real search with location
  // available — never on every keystroke across every section.
  useEffect(() => {
    const wantsPlaces = typeFilter === 'places' || (typeFilter === 'all' && searchQuery.trim().length >= 2);
    if (!wantsPlaces || !userLocation) return;
    const thisRequestId = ++placesRequestId.current;
    const timer = setTimeout(async () => {
      setLoadingPlaces(true);
      try {
        const category = typeFilter === 'places' ? placesCategory : null;
        const keyword = searchQuery.trim().length >= 2 ? searchQuery.trim() : null;
        const results = await searchNearbyPlaces(userLocation.latitude, userLocation.longitude, category, keyword);
        if (thisRequestId === placesRequestId.current) setPlaces(results);
      } catch (e) {
        console.error('Discover places search failed', e);
      }
      if (thisRequestId === placesRequestId.current) setLoadingPlaces(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [typeFilter, placesCategory, searchQuery, userLocation]);

  // Real gathering/community search, server-side and indexed (trigram GIN
  // indexes, 20260809_indexed_text_search.sql) rather than downloading every
  // future gathering / public community and filtering it client-side.
  // Same 2-character minimum and 350ms debounce as the Places search above,
  // for the same reason — no query fired on every keystroke.
  useEffect(() => {
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchedGatherings([]);
      setSearchedCommunities([]);
      setSearchedOffers([]);
      return;
    }
    const thisRequestId = ++searchRequestId.current;
    const timer = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const [gatheringResults, communityResults, offerResults] = await Promise.all([
          searchGatherings(term, 'wide'),
          searchPublicCommunities(term),
          searchOffers(term, userLocation?.latitude ?? null, userLocation?.longitude ?? null),
        ]);
        if (thisRequestId === searchRequestId.current) {
          setSearchedGatherings(gatheringResults);
          setSearchedCommunities(communityResults.filter((c) => !joinedCommunityIdsRef.current.has(c.id)));
          setSearchedOffers(offerResults);
        }
      } catch (e) {
        console.error('Discover search failed', e);
      }
      if (thisRequestId === searchRequestId.current) setLoadingSearch(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, userLocation]);

  async function loadPublicStories() {
    try {
      const grouped = await getPublicStoriesGrouped();
      setPublicStories(grouped);
      const urlEntries = await Promise.all(
        grouped.map(async (g) => {
          if (!g.photoUrl) return [g.userId, null];
          const url = await getSignedPhotoUrl(g.photoUrl);
          return [g.userId, url];
        })
      );
      setStoryPhotoUrls(Object.fromEntries(urlEntries));
    } catch (e) {
      console.error('loadPublicStories failed', e);
    }
  }
  async function loadGatheringStories() {
    try {
      const grouped = await getGatheringStoriesGrouped();
      setGatheringStories(grouped);
    } catch (e) {
      console.error('loadGatheringStories failed', e);
    }
  }

  const q = searchQuery.trim().toLowerCase();
  // 2-character minimum, matching the Places search's own established
  // threshold (and the debounced effect above, which only fires a real
  // gatherings/communities query at this same length) — a single keystroke
  // doesn't count as "searching" anywhere else on this screen either.
  const isSearching = q.length >= 2;

  // Gatherings/communities: real server-side, indexed search results
  // (searchedGatherings/searchedCommunities, populated by the debounced
  // effect above) once actively searching, instead of client-side
  // .filter().includes() over the full already-fetched browse lists.
  const filteredGatherings = isSearching ? searchedGatherings : gatherings;
  const filteredCommunities = isSearching ? searchedCommunities : communities;
  // Offers: real server-side, indexed search results (searchedOffers,
  // populated by the debounced effect above — a genuine cross-table search
  // over brand_offers.title/description and brand_partners.name via the new
  // search_offer_ids() RPC) once actively searching, instead of the
  // client-side .filter().includes() this used before.
  const filteredOffers = isSearching ? searchedOffers : offers;

  const recommended = !isSearching && (typeFilter === 'all' || typeFilter === 'gatherings')
    ? filteredGatherings
        .map((g) => ({ ...g, fit: getGatheringFitReasons(g) }))
        .filter((g) => g.fit.score >= 5)
        .sort((a, b) => b.fit.score - a.fit.score)
        .slice(0, 3)
    : [];

  // Same signal/threshold Home's own "🔥 Trending Near You" already uses
  // (homeDashboard.js's trendingGatherings) — Discover had no trending
  // section at all before this, even though the underlying gathering
  // list is already fetched here for search.
  const trending = !isSearching && (typeFilter === 'all' || typeFilter === 'gatherings')
    ? [...filteredGatherings]
        .sort((a, b) => (b.approvedAttendees?.length ?? 0) - (a.approvedAttendees?.length ?? 0))
        .slice(0, 3)
    : [];

  const showGatherings = typeFilter === 'all' || typeFilter === 'gatherings';
  const showCommunities = typeFilter === 'all' || typeFilter === 'communities';
  const showPlaces = typeFilter === 'all' || typeFilter === 'places';
  const showPerks = typeFilter === 'all' || typeFilter === 'perks';
  const showViewToggle = typeFilter === 'all' || typeFilter === 'gatherings' || typeFilter === 'perks';
  const isAll = typeFilter === 'all';

  const gatheringsToShow = isAll ? filteredGatherings.slice(0, PREVIEW_COUNT) : filteredGatherings;
  const communitiesToShow = isAll ? filteredCommunities.slice(0, PREVIEW_COUNT) : filteredCommunities;
  const offersToShow = isAll ? filteredOffers.slice(0, PREVIEW_COUNT) : filteredOffers;
  const placesToShow = isAll ? places.slice(0, PREVIEW_COUNT) : places;

  const mapDeals = showPerks ? filteredOffers.filter((o) => o.latitude != null && o.longitude != null) : [];
  const mapBusinesses = showPerks ? businesses : [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>What are you looking for?</Text>

        <View style={styles.searchBarWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search gatherings, communities, places, perks"
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search Discover"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.conciergeRow}
          onPress={() => navigation.navigate('AIConcierge')}
          activeOpacity={0.85}
          accessibilityLabel="Ask the AI Concierge what you're looking for"
          accessibilityRole="button"
        >
          <Text style={styles.conciergeRowText}>✨ Ask AI Concierge what to do</Text>
          <Text style={styles.conciergeRowChevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {TYPE_FILTERS.map((f) => {
              const active = typeFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setTypeFilter(f.key)}
                  accessibilityLabel={f.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {showViewToggle && (
            <TouchableOpacity
              style={styles.viewToggleButton}
              onPress={() => setViewStyle(viewStyle === 'list' ? 'map' : 'list')}
              accessibilityLabel={viewStyle === 'list' ? 'Switch to map view' : 'Switch to list view'}
              accessibilityRole="button"
            >
              <Text style={styles.viewToggleIcon}>{viewStyle === 'list' ? '🗺️' : '📋'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {typeFilter === 'places' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
            {PLACE_CATEGORIES.map((c) => {
              const active = placesCategory === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setPlacesCategory(c.key)}
                  accessibilityLabel={c.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={styles.filterChipIcon}>{c.icon}</Text>
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {viewStyle === 'map' && showViewToggle ? (
        <View style={{ flex: 1 }}>
          <GatheringsMapView
            gatherings={showGatherings ? filteredGatherings : []}
            deals={mapDeals}
            businesses={mapBusinesses}
            userLocation={userLocation}
            onSelectGathering={(g) => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
            onSelectDeal={(d) => navigation.navigate('BrandOffers', { highlightOfferId: d.id })}
            onSelectBusiness={(b) => navigation.navigate('BusinessProfile', { partnerId: b.id })}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {isAll && (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('Nearby')}
              activeOpacity={0.85}
              accessibilityLabel="Meet People, find people nearby"
              accessibilityRole="button"
            >
              <Text style={styles.cardIcon}>👥</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Meet People</Text>
                <Text style={styles.cardSubtitle}>Find people nearby</Text>
              </View>
              <Text style={styles.cardChevron}>›</Text>
            </TouchableOpacity>
          )}

          {isAll && (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
              <TouchableOpacity
                style={styles.quickTimeCard}
                onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'today' })}
                activeOpacity={0.85}
                accessibilityLabel="Gatherings happening tonight"
                accessibilityRole="button"
              >
                <Text style={styles.quickTimeCardIcon}>🌙</Text>
                <Text style={styles.quickTimeCardText}>Tonight</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickTimeCard}
                onPress={() => navigation.navigate('Gatherings', { initialDateFilter: 'weekend' })}
                activeOpacity={0.85}
                accessibilityLabel="Gatherings happening this weekend"
                accessibilityRole="button"
              >
                <Text style={styles.quickTimeCardIcon}>📅</Text>
                <Text style={styles.quickTimeCardText}>This Weekend</Text>
              </TouchableOpacity>
            </View>
          )}

          {loadingCore && (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          )}

          {recommended.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Recommended For You</Text>
              {recommended.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${g.title}, ${g.fit.reasons.join(', ')}`}
                  accessibilityRole="button"
                >
                  {coverPhotoUrls[g.id] ? (
                    <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
                  ) : (
                    <Text style={styles.cardIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{g.title}</Text>
                    <Text style={styles.cardSubtitle} numberOfLines={1}>{g.fit.reasons.join(' · ')}</Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {trending.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>🔥 Trending Near You</Text>
              {trending.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${g.title}, ${g.approvedAttendees?.length ?? 0} attending`}
                  accessibilityRole="button"
                >
                  {coverPhotoUrls[g.id] ? (
                    <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
                  ) : (
                    <Text style={styles.cardIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{g.title}</Text>
                    <Text style={styles.cardSubtitle}>{g.approvedAttendees?.length ?? 0} attending · {g.distanceLabel}</Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {showGatherings && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            </>
          )}

          {showGatherings && isSearching && !loadingSearch && gatheringsToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              <Text style={styles.emptyText}>No gatherings match "{searchQuery.trim()}".</Text>
            </>
          )}

          {showGatherings && !(isSearching && loadingSearch) && gatheringsToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Gatherings</Text>
              {gatheringsToShow.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('GatheringDetail', { gatheringId: g.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${g.title}, ${g.distanceLabel}`}
                  accessibilityRole="button"
                >
                  {coverPhotoUrls[g.id] ? (
                    <Image source={{ uri: coverPhotoUrls[g.id] }} style={styles.cardImage} />
                  ) : (
                    <Text style={styles.cardIcon}>{categoryStyleFor(g.interest_tag).icon}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{g.title}</Text>
                    <Text style={styles.cardSubtitle}>{g.distanceLabel}</Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('Gatherings')} accessibilityLabel="See all gatherings" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Gatherings →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showCommunities && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            </>
          )}

          {showCommunities && isSearching && !loadingSearch && communitiesToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              <Text style={styles.emptyText}>No communities match "{searchQuery.trim()}".</Text>
            </>
          )}

          {showCommunities && !(isSearching && loadingSearch) && communitiesToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Communities</Text>
              {communitiesToShow.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })}
                  activeOpacity={0.85}
                  accessibilityLabel={c.name}
                  accessibilityRole="button"
                >
                  <Text style={styles.cardIcon}>🏘️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {c.description ? <Text style={styles.cardSubtitle} numberOfLines={1}>{c.description}</Text> : null}
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('Communities')} accessibilityLabel="See all communities" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Communities →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showPlaces && (
            <>
              <Text style={styles.sectionHeader}>Places</Text>
              {!userLocation ? (
                <Text style={styles.emptyText}>Enable location to discover places nearby.</Text>
              ) : loadingPlaces ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
              ) : placesToShow.length === 0 ? (
                <Text style={styles.emptyText}>Nothing found nearby{typeFilter === 'places' ? ' in this category' : ''}.</Text>
              ) : (
                placesToShow.map((p) => (
                  <TouchableOpacity
                    key={p.placeId}
                    style={styles.card}
                    onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}&query_place_id=${p.placeId}`)}
                    activeOpacity={0.85}
                    accessibilityLabel={p.name}
                    accessibilityRole="button"
                  >
                    {p.photoRef ? (
                      <Image source={{ uri: getPlacePhotoUrl(p.photoRef) }} style={styles.cardImage} />
                    ) : (
                      <Text style={styles.cardIcon}>📍</Text>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{p.name}</Text>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        {[p.rating !== null ? `⭐ ${p.rating}` : null, p.gatheringCount > 0 ? `🎉 ${p.gatheringCount} gathering${p.gatheringCount === 1 ? '' : 's'} here` : null]
                          .filter(Boolean)
                          .join('  ·  ') || p.address}
                      </Text>
                    </View>
                    <Text style={styles.cardChevron}>›</Text>
                  </TouchableOpacity>
                ))
              )}
              {isAll && places.length > 0 && (
                <TouchableOpacity onPress={() => navigation.navigate('Places')} accessibilityLabel="See all places" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Places →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showPerks && isSearching && loadingSearch && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            </>
          )}

          {showPerks && isSearching && !loadingSearch && offersToShow.length === 0 && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              <Text style={styles.emptyText}>No perks match "{searchQuery.trim()}".</Text>
            </>
          )}

          {showPerks && !(isSearching && loadingSearch) && offersToShow.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Perks</Text>
              {offersToShow.map((o) => (
                <TouchableOpacity
                  key={o.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('BrandOffers', { highlightOfferId: o.id })}
                  activeOpacity={0.85}
                  accessibilityLabel={`${o.title}, ${o.brand_partners?.name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.cardIcon}>🎁</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{o.title}</Text>
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {o.brand_partners?.name}{o.target_interest_tag ? ' · Matches your interests' : ''}
                    </Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
              {isAll && (
                <TouchableOpacity onPress={() => navigation.navigate('BrandOffers')} accessibilityLabel="See all perks" accessibilityRole="button">
                  <Text style={styles.seeAll}>See all in Perks →</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {isAll && gatheringStories.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Gathering Memories</Text>
              {gatheringStories.map((group) => (
                <TouchableOpacity
                  key={group.gatheringId}
                  style={styles.card}
                  onPress={() => setGatheringStoryViewer(group)}
                  activeOpacity={0.85}
                  accessibilityLabel={`${group.gatheringTitle}, ${group.stories.length} stories`}
                  accessibilityRole="button"
                >
                  <Text style={styles.cardIcon}>🎉</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{group.gatheringTitle}</Text>
                    <Text style={styles.cardSubtitle}>{group.stories.length} stor{group.stories.length === 1 ? 'y' : 'ies'}</Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          {isAll && publicStories.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Public Stories Near You</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
                {publicStories.map((group) => (
                  <TouchableOpacity
                    key={group.userId}
                    style={styles.storyRing}
                    onPress={() => setViewerTarget(group)}
                    accessibilityLabel={`${group.displayName}'s public story`}
                    accessibilityRole="button"
                  >
                    {storyPhotoUrls[group.userId] ? (
                      <Image source={{ uri: storyPhotoUrls[group.userId] }} style={styles.storyAvatar} />
                    ) : (
                      <View style={[styles.storyAvatar, styles.storyAvatarPlaceholder]} />
                    )}
                    <Text style={styles.storyName} numberOfLines={1}>{group.displayName}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </ScrollView>
      )}

      <StoryViewerModal
        visible={!!viewerTarget}
        group={viewerTarget}
        onClose={() => {
          setViewerTarget(null);
          loadPublicStories();
        }}
      />
      <Modal visible={!!gatheringStoryViewer} animationType="slide" onRequestClose={() => setGatheringStoryViewer(null)}>
        <SafeAreaView style={styles.container}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.lg }}>
            <Text style={styles.title}>{gatheringStoryViewer?.gatheringTitle}</Text>
            <TouchableOpacity onPress={() => setGatheringStoryViewer(null)} accessibilityLabel="Close" accessibilityRole="button">
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={gatheringStoryViewer?.stories ?? []}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <GatheringStoryItem story={item} colors={colors} />}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function GatheringStoryItem({ story, colors }) {
  const [url, setUrl] = useState(null);
  React.useEffect(() => {
    getSignedStoryUrl(story.media_path).then(setUrl);
  }, [story.media_path]);
  return (
    <View style={{ marginBottom: spacing.lg, paddingHorizontal: spacing.lg }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }}>{story.profiles?.display_name}</Text>
      {url ? (
        story.media_type === 'video' ? (
          <Video
            source={{ uri: url }}
            style={{ width: '100%', height: 400, borderRadius: radius.lg }}
            resizeMode="cover"
            useNativeControls
            accessibilityLabel={`${story.profiles?.display_name}'s video story`}
          />
        ) : (
          <Image source={{ uri: url }} style={{ width: '100%', height: 400, borderRadius: radius.lg }} resizeMode="cover" />
        )
      ) : (
        <View style={{ width: '100%', height: 400, borderRadius: radius.lg, backgroundColor: colors.surfaceElevated }} />
      )}
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  scrollContent: { padding: spacing.lg, paddingTop: spacing.md },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.md,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.sm, fontSize: 14 },
  searchClear: { color: colors.textTertiary, fontSize: 16, paddingLeft: spacing.sm },
  conciergeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primaryMuted,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  conciergeRowText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  conciergeRowChevron: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  filterChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  filterChipIcon: { fontSize: 13, marginRight: 4 },
  filterChipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  filterChipTextActive: { color: colors.primary },
  viewToggleButton: {
    width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  viewToggleIcon: { fontSize: 15 },
  quickTimeCard: {
    flex: 1, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md,
  },
  quickTimeCardIcon: { fontSize: 22, marginBottom: 4 },
  quickTimeCardText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
  },
  cardImage: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md },
  cardIcon: { fontSize: 32, marginRight: spacing.md },
  cardTitle: { ...typography.headline, color: colors.textPrimary },
  cardSubtitle: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  cardChevron: { color: colors.textTertiary, fontSize: 24 },
  sectionHeader: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  seeAll: { color: colors.primary, fontWeight: '700', fontSize: 13, marginBottom: spacing.lg },
  emptyText: { color: colors.textTertiary, marginBottom: spacing.lg },
  storyRing: { alignItems: 'center', width: 64 },
  storyAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#e1306c', marginBottom: 4, backgroundColor: colors.surfaceElevated },
  storyAvatarPlaceholder: {},
  storyName: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
});
