import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Shows gatherings as pins on a real map. Pin positions come from
// each gathering's fuzzed_lat/fuzzed_lng (server-computed, jittered
// by roughly a quarter mile) — the app never has access to a
// gathering's exact coordinates on the client, by design, matching
// the same promise made in the Privacy Policy.
export default function GatheringsMapView({ gatherings, onSelectGathering, userLocation }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const mapRef = useRef(null);

  const pinnable = gatherings.filter((g) => g.latitude != null && g.longitude != null);

  const initialRegion = userLocation
    ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : pinnable.length > 0
      ? {
          latitude: pinnable[0].latitude,
          longitude: pinnable[0].longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }
      : {
          latitude: 26.4615,
          longitude: -80.0728,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        };

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      initialRegion={initialRegion}
      showsUserLocation
      showsMyLocationButton
    >
      {pinnable.map((g) => {
        const categoryStyle = categoryStyleFor(g.interest_tag);
        return (
          <Marker
            key={g.id}
            coordinate={{ latitude: g.latitude, longitude: g.longitude }}
            pinColor={categoryStyle.color}
            accessibilityLabel={`${g.title}, hosted by ${g.host?.display_name}, approximate location`}
          >
            <Callout onPress={() => onSelectGathering(g)} tooltip={false}>
              <View style={styles.calloutCard}>
                <Text style={styles.calloutTitle} numberOfLines={1}>{categoryStyle.icon} {g.title}</Text>
                <Text style={styles.calloutHost} numberOfLines={1}>by {g.host?.display_name}</Text>
                <Text style={styles.calloutDistance}>{g.distanceLabel}</Text>
                <Text style={styles.calloutAction}>Tap to view details</Text>
              </View>
            </Callout>
          </Marker>
        );
      })}
    </MapView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  map: { flex: 1 },
  calloutCard: { padding: spacing.sm, minWidth: 160, maxWidth: 220 },
  calloutTitle: { ...typography.bodyBold, color: '#1a1a1a', fontSize: 14 },
  calloutHost: { color: '#666', fontSize: 12, marginTop: 2 },
  calloutDistance: { color: '#888', fontSize: 11, marginTop: 2 },
  calloutAction: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 6 },
});