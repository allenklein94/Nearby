import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { pinProvenance } from '../utils/locationProvenance';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// Business website version of the location picker (react-native-maps has no web build). Same contract as the native
// screen -- it hands selectedLat/selectedLng back to CreateGathering -- with the choices a host can actually use on
// a desktop: their own business address (the usual place a business hosts), an address search, or the browser's
// location. There is no draggable pin; the chosen coordinates are shown so the host can see what will be used.
// Owner decisions 2026-10-22 (final, Option B): a stored point is never Google's, and there is no map here to place a pin on,
// so this screen has NO Google address search and never starts from a Google venue: the choices are the business's own
// location and the browser's location (same provenance hand-back as the native screen, utils/locationProvenance.js). A
// Google venue passed in is named only, with the way to place it (the Nearby app's map).

export default function SelectGatheringLocationScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const googleVenue = route.params?.googlePlaceId ? route.params?.googlePlaceName ?? null : null;
  // A point the calling screen already holds (the person's own earlier pin) is kept; a Google venue's point never is.
  const [pin, setPin] = useState(
    !route.params?.googlePlaceId && route.params?.initialLat != null && route.params?.initialLng != null
      ? { latitude: route.params.initialLat, longitude: route.params.initialLng, label: 'Pinned spot', origin: null }
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

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      Alert.alert('Location unavailable', 'Your browser cannot share its location. Use your business location, or place the pin in the Nearby app.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setPin({ ...point, label: 'Your current location', origin: { kind: 'device', point } });
      },
      () => Alert.alert('Location needed', 'Allow location in your browser, or use your business location.')
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
        selectedPlaceId: null,
        selectedPlaceName: null,
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
        {googleVenue ? (
          <Text style={styles.subtle}>To meet at {googleVenue}, place the pin on the map in the Nearby app, or choose a location below.</Text>
        ) : null}
        <TouchableOpacity style={styles.optionButton} onPress={useBrowserLocation} accessibilityRole="button" accessibilityLabel="Use my current location">
          <Text style={styles.optionText}>📍 Use my current location</Text>
        </TouchableOpacity>
        <Text style={styles.subtle}>{pin ? `Selected: ${pin.label ?? 'Pinned spot'}` : 'Pick a location above.'}</Text>
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
  optionButton: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  optionText: { ...typography.bodyBold, color: colors.textPrimary },
  subtle: { color: colors.textSecondary, fontSize: 13 },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: '700' },
});
