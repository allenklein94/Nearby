import React, { useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { geocodeAddress } from '../services/places';
import { pinProvenance } from '../utils/locationProvenance';

// Lets a host either search for an address or fine-tune by dragging
// the pin directly, rather than being locked to wherever their
// phone's GPS happens to be at the moment of creating the gathering.
// Owner 2026-10-22 (Google storage fix): also the ONE place a Google venue becomes a stored point. A Google result (Create's
// venue list, the business sign-up, or the address search here) only centres the pin; the person confirms or moves it,
// and the confirmed pin goes back with its provenance (utils/locationProvenance.js) + Google's place ID. Google results are
// shown only on a Google map (Google's terms), so this map is always PROVIDER_GOOGLE.
// `returnTo` = the screen to hand the pin back to (default CreateGathering; BusinessPartnerApply for the sign-up).
export default function SelectGatheringLocationScreen({ navigation, route }) {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [region, setRegion] = useState({
    latitude: route.params?.initialLat ?? 26.4615,
    longitude: route.params?.initialLng ?? -80.0728,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [pinCoords, setPinCoords] = useState({
    latitude: route.params?.initialLat ?? 26.4615,
    longitude: route.params?.initialLng ?? -80.0728,
  });
  const mapRef = useRef(null);
  // What last placed the pin (pinProvenance's origin): a Google venue passed in, else nothing (the host's own pin).
  const [origin, setOrigin] = useState(() => (
    route.params?.googlePlaceId && route.params?.initialLat != null && route.params?.initialLng != null
      ? { kind: 'google', placeId: route.params.googlePlaceId, point: { latitude: route.params.initialLat, longitude: route.params.initialLng } }
      : null
  ));
  const placeName = origin?.kind === 'google' && origin.placeId === route.params?.googlePlaceId ? route.params?.googlePlaceName ?? null : null;

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
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
  }

  async function handleSearch() {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      const found = await geocodeAddress(searchText);
      if (found.status === 'ok') {
        setPinCoords(found.point);
        setOrigin({ kind: 'google', placeId: found.placeId, point: found.point });
        mapRef.current?.animateToRegion({ ...found.point, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
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

  function handleConfirm() {
    const prov = pinProvenance({ origin, confirmed: pinCoords });
    navigation.navigate({
      name: route.params?.returnTo ?? 'CreateGathering',
      params: {
        selectedLat: pinCoords.latitude,
        selectedLng: pinCoords.longitude,
        selectedLocationSource: prov?.source ?? 'host_pin',
        selectedPlaceId: prov?.googlePlaceId ?? null,
        // Shown on the returning screen only (never stored): Google's venue name while the pin is still that venue's.
        selectedPlaceName: prov?.googlePlaceId && prov.googlePlaceId === route.params?.googlePlaceId ? placeName : null,
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
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          accessibilityLabel={t('ui.selectLocation.searchForALocationA11y')}
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={searching} accessibilityLabel={t('ui.selectLocation.searchA11y')} accessibilityRole="button">
          {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchButtonText}>{t('ui.selectLocation.go')}</Text>}
        </TouchableOpacity>
      </View>

      {placeName ? <Text style={styles.placeHint} numberOfLines={2}>{t('ui.selectLocation.confirmPlaceHint', { name: placeName })}</Text> : null}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={region}
      >
        <Marker
          coordinate={pinCoords}
          draggable
          onDragEnd={(e) => setPinCoords(e.nativeEvent.coordinate)}
          accessibilityLabel={t('ui.selectLocation.gatheringLocationPinDragToA11y')}
        />
      </MapView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.currentLocationButton} onPress={useMyCurrentLocation} accessibilityLabel={t('ui.selectLocation.useMyCurrentLocationA11y')} accessibilityRole="button">
          <Text style={styles.currentLocationText}>{t('ui.selectLocation.useMyCurrentLocation')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm} accessibilityLabel={t('ui.selectLocation.confirmThisLocationA11y')} accessibilityRole="button">
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