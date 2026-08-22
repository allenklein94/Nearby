import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, FlatList, Image, StyleSheet, SafeAreaView, ActivityIndicator, Linking } from 'react-native';
import * as Location from 'expo-location';
import { searchNearbyPlaces, getPlacePhotoUrl, priceLevelLabel } from '../services/places';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

const CATEGORIES = [
  { key: 'coffee', icon: '☕', label: 'Coffee Shops' },
  { key: 'restaurants', icon: '🍽️', label: 'Restaurants' },
  { key: 'parks', icon: '🌳', label: 'Parks' },
  { key: 'hubs', icon: '🏛️', label: 'Community Hubs' },
];

export default function PlacesScreen() {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [category, setCategory] = useState('coffee');
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationDenied, setLocationDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    load();
  }, [category]);

  async function load() {
    // Guards against a race condition when someone rapidly taps
    // between category chips — an older, slower request finishing
    // after a newer one would otherwise overwrite the correct,
    // already-loaded results with stale data for the wrong category.
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
      const results = await searchNearbyPlaces(location.coords.latitude, location.coords.longitude, category);
      if (thisRequestId === requestIdRef.current) setPlaces(results);
    } catch (e) {
      console.error('PlacesScreen load error', e);
      if (thisRequestId === requestIdRef.current) setLoadError(true);
    }
    if (thisRequestId === requestIdRef.current) setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">Places</Text>
      <Text style={styles.subtitle}>Real spots nearby, worth checking out</Text>

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
              onPress={() => setCategory(item.key)}
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
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : locationDenied ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📍</Text>
          <Text style={styles.emptyText}>Enable location to discover places nearby.</Text>
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
              <Text style={styles.emptyText}>Nothing found nearby in this category.</Text>
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
                <Image source={{ uri: getPlacePhotoUrl(item.photoRef) }} style={styles.placeImage} />
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
  title: { ...typography.display, color: colors.textPrimary, marginBottom: 2, paddingHorizontal: spacing.lg },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
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
});