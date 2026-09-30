import React, { useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import { getGoogleMapsRequestHeaders } from '../services/places';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

// Lets a host either search for an address or fine-tune by dragging
// the pin directly, rather than being locked to wherever their
// phone's GPS happens to be at the moment of creating the gathering.
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

  async function useMyCurrentLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('ui.selectLocation.locationNeeded'), t('ui.selectLocation.locationPermissionIsRequiredTo'));
      return;
    }
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const coords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    setPinCoords(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
  }

  async function handleSearch() {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchText)}&key=${GOOGLE_MAPS_API_KEY}`,
        { headers: getGoogleMapsRequestHeaders() }
      );
      const result = await response.json();

      if (result.status !== 'OK' || !result.results?.[0]) {
        if (result.status === 'ZERO_RESULTS') {
          Alert.alert(t('ui.selectLocation.notFound'), t('ui.selectLocation.couldntFindThatAddressTry'));
        } else {
          // A non-ZERO_RESULTS status means Google rejected the request itself
          // (bad/restricted API key, Geocoding API not enabled, billing, quota) --
          // surface the real reason instead of the misleading "try being more
          // specific" copy, which only applies to a genuinely bad address.
          Alert.alert(t('ui.selectLocation.addressLookupFailed'), `${result.status}${result.error_message ? `: ${result.error_message}` : ''}`);
        }
        setSearching(false);
        return;
      }

      const { lat, lng } = result.results[0].geometry.location;
      const coords = { latitude: lat, longitude: lng };
      setPinCoords(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 500);
    } catch (e) {
      Alert.alert(t('ui.selectLocation.error'), t('ui.selectLocation.somethingWentWrongSearchingFor'));
    }
    setSearching(false);
  }

  function handleConfirm() {
    navigation.navigate({
      name: 'CreateGathering',
      params: { selectedLat: pinCoords.latitude, selectedLng: pinCoords.longitude },
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

      <MapView
        ref={mapRef}
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
  currentLocationButton: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 12, alignItems: 'center',
  },
  currentLocationText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});