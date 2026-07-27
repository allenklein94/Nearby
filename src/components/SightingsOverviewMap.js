import React, { useRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Shows all of a person's Crossed Paths encounters on one map at
// once, using each match's avatar as the pin. Every position here is
// the same fuzzed, historical coordinate already used by the
// single-sighting map (~0.24 mile jitter, never a live location) —
// this is purely a different visual arrangement of data that was
// already safe to show, not a new category of exposure.
export default function SightingsOverviewMap({ sightings, photoUrls, userLocation, onSelectSighting }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const mapRef = useRef(null);

  const pinnable = sightings.filter((s) => s.sightingLat != null && s.sightingLng != null);

  const initialRegion = userLocation
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : pinnable[0]
      ? { latitude: pinnable[0].sightingLat, longitude: pinnable[0].sightingLng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
      : { latitude: 26.4615, longitude: -80.0728, latitudeDelta: 0.08, longitudeDelta: 0.08 };

  return (
    <MapView ref={mapRef} style={styles.map} initialRegion={initialRegion} showsUserLocation>
      {pinnable.map((s) => (
        <Marker
          key={s.id}
          coordinate={{ latitude: s.sightingLat, longitude: s.sightingLng }}
          accessibilityLabel={`Crossed paths with ${s.profiles?.display_name}, approximate location`}
        >
          <View style={styles.avatarPin}>
            {photoUrls[s.id] ? (
              <Image source={{ uri: photoUrls[s.id] }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarImage, styles.avatarPlaceholder]} />
            )}
          </View>
          <Callout onPress={() => onSelectSighting(s)} tooltip={false}>
            <View style={styles.calloutCard}>
              <Text style={styles.calloutTitle}>{s.profiles?.display_name}</Text>
              <Text style={styles.calloutAction}>Tap to view profile</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </MapView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  map: { flex: 1 },
  avatarPin: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, borderColor: colors.primary,
    overflow: 'hidden', backgroundColor: colors.surfaceElevated,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarPlaceholder: {},
  calloutCard: { padding: spacing.sm, minWidth: 140 },
  calloutTitle: { ...typography.bodyBold, color: '#1a1a1a', fontSize: 13 },
  calloutAction: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 4 },
});