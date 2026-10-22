import React, { useEffect, useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { geocodeAddress } from '../services/places';
import { initialPin, pinProvenance } from '../utils/locationProvenance';

// Lets a host either search for an address or fine-tune by dragging
// the pin directly, rather than being locked to wherever their
// phone's GPS happens to be at the moment of creating the gathering.
// Owner decisions 2026-10-22 (final, Option B): the ONE place a location the person chooses becomes a point. A Google result
// (Create's venue list, the business sign-up / profile, or the address search here) only MOVES THE MAP and is kept as a
// reference (its place ID); no pin appears until the person taps the spot themselves, and only that tap (and any drag after
// it) goes back, with its provenance (utils/locationProvenance.js). Google's coordinates are never handed back or stored.
// Google results are shown only on a Google map (Google's terms), so this map is always PROVIDER_GOOGLE.
// `returnTo` = the screen to hand the pin back to (default CreateGathering; BusinessPartnerApply / BusinessDashboard for a
// business); `searchText` = an address to look up once on open (the business's own typed address), so nobody starts from scratch.
export default function SelectGatheringLocationScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [start] = useState(() => initialPin(route.params ?? {}));
  const [searchText, setSearchText] = useState(route.params?.searchText ?? '');
  const [searching, setSearching] = useState(false);
  const [region] = useState({
    latitude: start.center?.latitude ?? 26.4615,
    longitude: start.center?.longitude ?? -80.0728,
    latitudeDelta: start.center ? 0.005 : 0.05,
    longitudeDelta: start.center ? 0.005 : 0.05,
  });
  // null = nothing placed yet (Confirm is off): a Google result never places the pin.
  const [pinCoords, setPinCoords] = useState(start.pin);
  const mapRef = useRef(null);
  // What last placed the pin (pinProvenance's origin): 'device' for "my location", else null (the person's own tap).
  const [origin, setOrigin] = useState(start.origin);
  // The Google venue / address the person searched for: a reference (place ID, its name shown here only), never a point.
  const [reference, setReference] = useState(start.reference);
  const placeName = reference?.name ?? null;

  function placePin(coordinate) {
    setPinCoords(coordinate);
    setOrigin(null);
  }

  async function useMyCurrentLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('ui.selectLocation.locationNeeded'), t('ui.selectLocation.locationPermissionIsRequiredTo'));
      return;
    }
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    setPinCoords(coords);
    setOrigin({ kind: 'device', point: coords });
    setReference(null);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
  }

  async function handleSearch(text = searchText) {
    if (!String(text ?? '').trim()) return;
    setSearching(true);
    try {
      const found = await geocodeAddress(text);
      if (found.status === 'ok') {
        // Google's point only centres the map; the person taps the exact spot (the old pin, if any, is cleared).
        setPinCoords(null);
        setOrigin(null);
        setReference(found.placeId ? { placeId: found.placeId, name: found.label ?? null } : null);
        mapRef.current?.animateToRegion({ ...found.point, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
      } else if (found.status === 'none') {
        Alert.alert(t('ui.selectLocation.notFound'), t('ui.selectLocation.couldntFindThatAddressTry'));
      } else {
        // Budget used up or Google refused: not "no such address". The pin still works by hand.
        Alert.alert(t('ui.selectLocation.addressLookupFailed'), t('ui.placesToGo.googleUnavailablePin'));
      }
    } catch (e) {
      Alert.alert(t('ui.selectLocation.error'), t('ui.selectLocation.somethingWentWrongSearchingFor'));
    }
    setSearching(false);
  }

  // A business's typed address is looked up once on open (centres the map only), unless the map already has a place.
  useEffect(() => {
    if (route.params?.searchText && !start.center) handleSearch(route.params.searchText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConfirm() {
    const prov = pinProvenance({ origin, confirmed: pinCoords, reference });
    if (!prov) return;
    navigation.navigate({
      name: route.params?.returnTo ?? 'CreateGathering',
      params: {
        selectedLat: pinCoords.latitude,
        selectedLng: pinCoords.longitude,
        selectedLocationSource: prov.source,
        selectedPlaceId: prov.googlePlaceId,
        // Shown on the returning screen only (never stored): the name of the Google venue the person searched for.
        selectedPlaceName: prov.googlePlaceId ? placeName : null,
      },
      merge: true,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('ui.selectLocation.searchForAnAddressOr')}
          placeholderTextColor={colors.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={() => handleSearch()}
          returnKeyType="search"
          accessibilityLabel={t('ui.selectLocation.searchForALocationA11y')}
        />
        <TouchableOpacity style={styles.searchButton} onPress={() => handleSearch()} disabled={searching} accessibilityLabel={t('ui.selectLocation.searchA11y')} accessibilityRole="button">
          {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchButtonText}>{t('ui.selectLocation.go')}</Text>}
        </TouchableOpacity>
      </View>

      {!pinCoords ? (
        <Text style={styles.placeHint} numberOfLines={2} accessibilityLiveRegion="polite">
          {placeName ? t('ui.selectLocation.confirmPlaceHint', { name: placeName }) : t('ui.selectLocation.tapToPlacePin')}
        </Text>
      ) : null}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={region}
        onPress={(e) => placePin(e.nativeEvent.coordinate)}
      >
        {pinCoords ? (
          <Marker
            coordinate={pinCoords}
            draggable
            onDragEnd={(e) => placePin(e.nativeEvent.coordinate)}
            accessibilityLabel={t('ui.selectLocation.gatheringLocationPinDragToA11y')}
          />
        ) : null}
      </MapView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.currentLocationButton} onPress={useMyCurrentLocation} accessibilityLabel={t('ui.selectLocation.useMyCurrentLocationA11y')} accessibilityRole="button">
          <Text style={styles.currentLocationText}>{t('ui.selectLocation.useMyCurrentLocation')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.confirmButton, !pinCoords && { opacity: 0.5 }]} onPress={handleConfirm} disabled={!pinCoords} accessibilityLabel={t('ui.selectLocation.confirmThisLocationA11y')} accessibilityRole="button" accessibilityState={{ disabled: !pinCoords }}>
          <Text style={styles.confirmButtonText}>{t('ui.selectLocation.confirmLocation')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', padding: spacing.md, gap: spacing.sm },
  searchInput: {
    flex: 1, backgroundColor: colors.surface, color: colors.textPrimary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  searchButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '700' },
  bottomBar: { padding: spacing.md, gap: spacing.sm },
  placeHint: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  currentLocationButton: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 12, alignItems: 'center',
  },
  currentLocationText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});