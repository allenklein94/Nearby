import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Image, StyleSheet, SafeAreaView, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { searchNearbyPlaces, getPlacePhotoUrl, priceLevelLabel, getGoogleMapsRequestHeaders } from '../services/places';
import { PLACE_CATEGORIES as CATEGORIES } from '../constants/placeCategories';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// This screen is reached as a top-level stack push (not a bottom tab),
// headerShown: false in RootNavigator -- the same "reachable, but no
// visible way back" shape found and fixed on FriendDiscoveryScreen for a
// real user-reported dead end. Closed here for the identical reason,
// not something a screen with no navigation prop can leave otherwise.
export default function PlacesScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [category, setCategory] = useState('food_drink');
  // Item 40 (CLAUDE.md, "categories should be the fallback, not the
  // primary burden"): this screen used to have no search box at all --
  // 19 category chips were the *only* way in, even though the parent
  // screen it's reached from (Discover's own embedded Places section)
  // already supports a free-text keyword search. A real, debounced search
  // now sits above the chips; while it's active, the search overrides the
  // category as the API's own type filter (see load()'s own comment) so a
  // genuine ask isn't silently narrowed by whichever chip happened to
  // still be selected from earlier browsing. Categories still work exactly
  // as before once the search is cleared -- this is additive, not a
  // replacement for category browsing.
  const [searchQuery, setSearchQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestIdRef = useRef(0);

  const isSearching = searchQuery.trim().length >= 2;

  // Same 350ms debounce + 2-character minimum Discover's own embedded
  // Places search already established -- a category chip tap fires
  // through the same debounce rather than a separate instant path, same
  // precedent DiscoverHubScreen's own combined places effect already
  // sets (typeFilter/placesCategory/searchQuery all in one debounced
  // effect).
  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 350);
    return () => clearTimeout(timer);
  }, [category, searchQuery]);

  async function load() {
    // Guards against a race condition when someone rapidly taps
    // between category chips (or keeps typing) — an older, slower
    // request finishing after a newer one would otherwise overwrite the
    // correct, already-loaded results with stale data.
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(false);
    let status;
    try {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    } catch (e) {
      console.error('PlacesScreen load error', e);
      if (thisRequestId === requestIdRef.current) {
        setLoadError(true);
        setLoading(false);
      }
      return;
    }
    if (status !== 'granted') {
      if (thisRequestId === requestIdRef.current) {
        setLocationDenied(true);
        setLoading(false);
      }
      return;
    }
    if (thisRequestId === requestIdRef.current) setLocationDenied(false);
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (!location) {
      if (thisRequestId === requestIdRef.current) setLoading(false);
      return;
    }
    try {
      // Item 40: while actively searching, the category chip stops acting
      // as a hard type filter (Google's Nearby Search ANDs type+keyword
      // together, so leaving a stale "Coffee" chip selected while typing
      // "board games" would silently return nothing) -- null here lets the
      // keyword alone decide, matching Discover's own identical choice for
      // its "All" tab keyword search (`category: typeFilter === 'places'
      // ? placesCategory : null`).
      const effectiveCategory = isSearching ? null : category;
      const keyword = isSearching ? searchQuery.trim() : null;
      const results = await searchNearbyPlaces(location.coords.latitude, location.coords.longitude, effectiveCategory, keyword);
      if (thisRequestId === requestIdRef.current) setPlaces(results);
    } catch (e) {
      console.error('PlacesScreen load error', e);
      if (thisRequestId === requestIdRef.current) setLoadError(true);
    }
    if (thisRequestId === requestIdRef.current) setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Go back"
        accessibilityRole="button"
      >
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title} accessibilityRole="header">Places</Text>
      <Text style={styles.subtitle}>Real spots nearby, worth checking out</Text>

      <View style={styles.searchBarWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder='Try "coffee shop" or "something fun"'
          placeholderTextColor={colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search places"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Item 40: a small, honest label reinforcing that categories are a
          secondary browse aid, not the primary way in -- the search box
          above is. Two clean, distinct modes rather than one confusing
          combined state: tapping a chip switches back to plain category
          browsing (clearing any active search text), and typing a search
          switches into search mode (see load()'s own comment for why the
          chip stops acting as a hard type filter once that happens).
          Categories still work exactly as they always did once you're in
          that mode. */}
      <Text style={styles.orBrowseLabel}>Or browse by category</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIES}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        style={{ flexGrow: 0, marginBottom: spacing.md }}
        renderItem={({ item }) => {
          const active = category === item.key;
          return (
            <TouchableOpacity
              style={[styles.categoryChip, active && styles.categoryChipActive]}
              onPress={() => {
                setCategory(item.key);
                if (isSearching) setSearchQuery('');
              }}
              accessibilityLabel={item.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={styles.categoryChipIcon}>{item.icon}</Text>
              <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        }}
      />

      {loading ? (
        <View style={{ marginTop: spacing.xl }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.emptyText}>{isSearching ? `Searching for "${searchQuery.trim()}"…` : 'Finding places nearby…'}</Text>
        </View>
      ) : locationDenied ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyText}>Enable location to discover places nearby.</Text>
          <TouchableOpacity onPress={load} accessibilityLabel="Enable location" accessibilityRole="button">
            <Text style={styles.emptyActionText}>Enable Location →</Text>
          </TouchableOpacity>
        </View>
      ) : loadError ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>⚠️</Text>
          <Text style={styles.emptyText}>Couldn't load places right now. Pull down to try again.</Text>
        </View>
      ) : (
        <FlatList
          data={places}
          keyExtractor={(item) => item.placeId}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyText}>
                {isSearching ? `No places match "${searchQuery.trim()}" nearby.` : 'Nothing found nearby in this category.'}
              </Text>
              {/* Item 26 escape hatch: a real place can't be "created" the
                  way a gathering/community can, but a user can ask
                  businesses directly -- same AskBusinessScreen the Create
                  tab's own "With businesses" row (item 20) and Home's
                  ask-box fallback already use. Free-text prefill only --
                  PLACE_CATEGORIES and AskBusinessScreen's own leaf-tag
                  category chips are deliberately separate vocabularies
                  (see placeCategories.js's header comment), so this never
                  silently pre-selects a chip that might not actually match.
                  Item 40: prefills from the real typed search when one was
                  active, not just the category -- "something fun with my
                  girlfriend Saturday" deserves to reach the business ask
                  verbatim, not collapsed down to whatever category chip
                  happened to still be selected. */}
              <TouchableOpacity
                onPress={() => navigation.navigate('AskBusiness', {
                  prefillText: isSearching
                    ? searchQuery.trim()
                    : `Looking for ${CATEGORIES.find((c) => c.key === category)?.label || 'something'} nearby`,
                })}
                accessibilityLabel="Ask nearby businesses"
                accessibilityRole="button"
              >
                <Text style={styles.emptyActionText}>Ask Nearby Businesses →</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.placeCard}
              onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}&query_place_id=${item.placeId}`)}
              activeOpacity={0.85}
              accessibilityLabel={`${item.name}${item.openNow !== null ? (item.openNow ? ', open now' : ', closed now') : ''}${item.gatheringCount > 0 ? `, ${item.gatheringCount} gatherings hosted here` : ''}`}
              accessibilityRole="button"
            >
              {item.photoRef ? (
                <Image source={{ uri: getPlacePhotoUrl(item.photoRef), headers: getGoogleMapsRequestHeaders() }} style={styles.placeImage} />
              ) : (
                <View style={[styles.placeImage, styles.placeImagePlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.placeName}>{item.name}</Text>
                {item.address ? <Text style={styles.placeAddress}>{item.address}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 }}>
                  {item.rating !== null && (
                    <Text style={styles.placeRating}>
                      ⭐ {item.rating}{item.reviewCount !== null ? ` (${item.reviewCount})` : ''}
                    </Text>
                  )}
                  {priceLevelLabel(item.priceLevel) !== null && (
                    <Text style={styles.placePriceLevel}>{priceLevelLabel(item.priceLevel)}</Text>
                  )}
                  {item.openNow !== null && (
                    <Text style={item.openNow ? styles.placeOpenNow : styles.placeClosedNow}>
                      {item.openNow ? '● Open now' : '● Closed'}
                    </Text>
                  )}
                  {item.gatheringCount > 0 && (
                    <Text style={styles.placeGatherings}>🎉 {item.gatheringCount} gathering{item.gatheringCount === 1 ? '' : 's'} here</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.sm },
  backButton: { padding: spacing.xs, marginLeft: spacing.sm, marginBottom: spacing.xs, alignSelf: 'flex-start' },
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2, paddingHorizontal: spacing.lg },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  // Item 40: same visual language as Discover's own searchBarWrap/
  // searchIcon/searchInput/searchClear, just with an explicit horizontal
  // margin added since this screen's own container (unlike Discover's
  // padded ScrollView) has none.
  searchBarWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.sm, fontSize: 14 },
  searchClear: { color: colors.textTertiary, fontSize: 16, paddingLeft: spacing.sm },
  orBrowseLabel: {
    ...typography.caption, color: colors.textTertiary, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, paddingHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  categoryChipActive: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
  categoryChipIcon: { fontSize: 14, marginRight: 6 },
  categoryChipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  categoryChipTextActive: { color: colors.primary },
  placeCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  placeImage: { width: 64, height: 64, borderRadius: radius.md, marginRight: spacing.md },
  placeImagePlaceholder: { backgroundColor: colors.surfaceElevated },
  placeName: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 15 },
  placeAddress: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  placeRating: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  placePriceLevel: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  placeOpenNow: { color: colors.success, fontSize: 12, fontWeight: '700' },
  placeClosedNow: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  placeGatherings: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyEmoji: { fontSize: 36, marginBottom: spacing.md },
  emptyText: { color: colors.textTertiary, textAlign: 'center' },
  emptyActionText: { color: colors.primary, fontWeight: '700', marginTop: spacing.md },
});