import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { geocodeAddress } from '../services/places';
import { pinProvenance } from '../utils/locationProvenance';
import GoogleMapsAttribution from '../components/GoogleMapsAttribution';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Business website version of the location picker (react-native-maps has no web build). Same contract as the native
// screen -- it hands selectedLat/selectedLng back to CreateGathering -- with the choices a host can actually use on
// a desktop: their own business address (the usual place a business hosts), an address search, or the browser's
// location. There is no draggable pin; the chosen coordinates are shown so the host can see what will be used.
// Owner 2026-10-22: same provenance hand-back as the native screen (utils/locationProvenance.js); an address search
// claims the shared daily Google budget, and a Google address shown here (no map) carries "Google Maps" beside it.

export default function SelectGatheringLocationScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState(
    route.params?.initialLat != null && route.params?.initialLng != null
      ? {
        latitude: route.params.initialLat, longitude: route.params.initialLng,
        label: route.params?.googlePlaceName ?? 'Current location',
        origin: route.params?.googlePlaceId
          ? { kind: 'google', placeId: route.params.googlePlaceId, point: { latitude: route.params.initialLat, longitude: route.params.initialLng } }
          : null,
      }
      : null
  );
  const [businessSpot, setBusinessSpot] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;
      const { data: profile } = await supabase.from('profiles').select('managed_partner_id').eq('id', uid).single();
      if (!profile?.managed_partner_id) return;
      const { data: partner } = await supabase.from('brand_partners').select('name, address, latitude, longitude').eq('id', profile.managed_partner_id).single();
      if (partner?.latitude != null && partner?.longitude != null) {
        const point = { latitude: partner.latitude, longitude: partner.longitude };
        const spot = { ...point, label: partner.address || partner.name, origin: { kind: 'business_profile', point } };
        setBusinessSpot(spot);
        setPin((p) => p ?? spot);
      }
    })();
  }, []);

  async function handleSearch() {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      const found = await geocodeAddress(searchText);
      if (found.status === 'ok') {
        setPin({ ...found.point, label: found.label, origin: { kind: 'google', placeId: found.placeId, point: found.point } });
      } else if (found.status === 'none') {
        Alert.alert('Not found', "Couldn't find that address. Try being more specific.");
      } else {
        Alert.alert('Address search unavailable', "Address search isn't available right now. You can still use your business location or your current location.");
      }
    } catch (e) {
      Alert.alert('Error', 'Something went wrong searching for that address.');
    }
    setSearching(false);
  }

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      Alert.alert('Location unavailable', 'Your browser cannot share its location. Search for an address instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setPin({ ...point, label: 'Your current location', origin: { kind: 'device', point } });
      },
      () => Alert.alert('Location needed', 'Allow location in your browser, or search for an address instead.')
    );
  }

  function handleConfirm() {
    if (!pin) return;
    const prov = pinProvenance({ origin: pin.origin, confirmed: pin });
    navigation.navigate({
      name: route.params?.returnTo ?? 'CreateGathering',
      params: {
        selectedLat: pin.latitude, selectedLng: pin.longitude,
        selectedLocationSource: prov?.source ?? 'host_pin',
        selectedPlaceId: prov?.googlePlaceId ?? null,
        selectedPlaceName: prov?.googlePlaceId && prov.googlePlaceId === route.params?.googlePlaceId ? route.params?.googlePlaceName ?? null : null,
      },
      merge: true,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        {businessSpot && (
          <TouchableOpacity style={styles.optionButton} onPress={() => setPin(businessSpot)} accessibilityRole="button" accessibilityLabel="Use my business location">
            <Text style={styles.optionText}>🏪 Use my business location</Text>
            <Text style={styles.subtle}>{businessSpot.label}</Text>
          </TouchableOpacity>
        )}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for an address or venue..."
            placeholderTextColor={colors.textTertiary}
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={handleSearch}
            accessibilityLabel="Search for a location"
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={searching} accessibilityRole="button" accessibilityLabel="Search">
            {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchButtonText}>Go</Text>}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.optionButton} onPress={useBrowserLocation} accessibilityRole="button" accessibilityLabel="Use my current location">
          <Text style={styles.optionText}>📍 Use my current location</Text>
        </TouchableOpacity>
        <Text style={styles.subtle}>{pin ? `Selected: ${pin.label ?? 'Pinned spot'}` : 'Pick a location above.'}</Text>
        {pin?.origin?.kind === 'google' ? <GoogleMapsAttribution /> : null}
        <TouchableOpacity style={[styles.confirmButton, !pin && { opacity: 0.5 }]} onPress={handleConfirm} disabled={!pin} accessibilityRole="button" accessibilityLabel="Confirm this location">
          <Text style={styles.confirmButtonText}>Confirm Location</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.lg, gap: spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  searchInput: { flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border },
  searchButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  searchButtonText: { color: '#fff', fontWeight: '700' },
  optionButton: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  optionText: { ...typography.bodyBold, color: colors.textPrimary },
  subtle: { color: colors.textSecondary, fontSize: 13 },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: '700' },
});
