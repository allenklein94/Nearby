import React, { useRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { categoryStyleFor } from '../constants/gatheringCategoryStyles';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';

// Shows gatherings, brand deals, businesses, and public stories together
// on one map. Gatherings use fuzzed_lat/fuzzed_lng (server-computed,
// jittered by roughly a quarter mile) — the app never has access to
// a gathering's exact coordinates on the client, by design. Public
// stories use the same fuzzing treatment, since they're a personal
// post, not a business location. Deals and businesses use real
// coordinates — they're legitimate public business locations, not a
// private individual's whereabouts. People are deliberately never
// plotted here or anywhere else in this app: no client ever receives
// another person's coordinates, not even fuzzed (see proximity.js —
// "crossed paths" is computed entirely server-side from coarse area
// buckets). Communities aren't plotted either — communities have no
// location of their own anywhere in the schema, so there's no real
// coordinate to honestly show.
function isHappeningNow(scheduledAt) {
  if (!scheduledAt) return false;
  const start = new Date(scheduledAt).getTime();
  const now = Date.now();
  return now >= start - 30 * 60 * 1000 && now <= start + 2 * 60 * 60 * 1000;
}

export default function GatheringsMapView({ gatherings, deals = [], businesses = [], stories = [], storyPhotoUrls = {}, userLocation, onSelectGathering, onSelectDeal, onSelectBusiness, onSelectStory }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const mapRef = useRef(null);

  const pinnableGatherings = gatherings.filter((g) => g.latitude != null && g.longitude != null);
  const pinnableDeals = deals.filter((d) => d.latitude != null && d.longitude != null);
  const pinnableBusinesses = businesses.filter((b) => b.latitude != null && b.longitude != null);
  const pinnableStories = stories.filter((s) => s.fuzzed_lat != null && s.fuzzed_lng != null);

  const firstPin = pinnableGatherings[0] || pinnableDeals[0] || pinnableBusinesses[0] || pinnableStories[0];

  const initialRegion = userLocation
    ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : firstPin
      ? {
          latitude: firstPin.latitude ?? firstPin.fuzzed_lat,
          longitude: firstPin.longitude ?? firstPin.fuzzed_lng,
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
      {pinnableGatherings.map((g) => {
        const categoryStyle = categoryStyleFor(g.interest_tag);
        const live = isHappeningNow(g.scheduled_at);
        return (
          <Marker
            key={`gathering-${g.id}`}
            coordinate={{ latitude: g.latitude, longitude: g.longitude }}
            pinColor={live ? '#e63946' : categoryStyle.color}
            accessibilityLabel={`${g.title}, hosted by ${g.host?.display_name}, approximate location${live ? ', happening now' : ''}`}
          >
            <Callout onPress={() => onSelectGathering(g)} tooltip={false}>
              <View style={styles.calloutCard}>
                {live && <Text style={styles.liveBadge}>🔴 LIVE NOW</Text>}
                <Text style={styles.calloutTitle} numberOfLines={1}>{categoryStyle.icon} {g.title}</Text>
                <Text style={styles.calloutHost} numberOfLines={1}>by {g.host?.display_name}</Text>
                <Text style={styles.calloutDistance}>{g.distanceLabel}</Text>
                <Text style={styles.calloutAction}>Tap to view details</Text>
              </View>
            </Callout>
          </Marker>
        );
      })}
      {pinnableDeals.map((d) => (
        <Marker
          key={`deal-${d.id}`}
          coordinate={{ latitude: d.latitude, longitude: d.longitude }}
          pinColor="#f59e0b"
          accessibilityLabel={`Deal at ${d.brand_partners?.name}: ${d.title}`}
        >
          <Callout onPress={() => onSelectDeal(d)} tooltip={false}>
            <View style={styles.calloutCard}>
              <Text style={styles.calloutTitle} numberOfLines={1}>🎁 {d.title}</Text>
              <Text style={styles.calloutHost} numberOfLines={1}>{d.brand_partners?.name}</Text>
              {d.valid_from_time && d.valid_to_time && (
                <Text style={styles.calloutDistance}>{d.valid_from_time.slice(0, 5)} - {d.valid_to_time.slice(0, 5)}</Text>
              )}
              <Text style={styles.calloutAction}>Tap to view details</Text>
            </View>
          </Callout>
        </Marker>
      ))}
      {pinnableBusinesses.map((b) => (
        <Marker
          key={`business-${b.id}`}
          coordinate={{ latitude: b.latitude, longitude: b.longitude }}
          pinColor="#5B9AA0"
          accessibilityLabel={`${b.name}, business`}
        >
          <Callout onPress={() => onSelectBusiness(b)} tooltip={false}>
            <View style={styles.calloutCard}>
              <Text style={styles.calloutTitle} numberOfLines={1}>🏪 {b.name}</Text>
              <Text style={styles.calloutAction}>Tap to view profile</Text>
            </View>
          </Callout>
        </Marker>
      ))}
      {pinnableStories.map((s) => (
        <Marker
          key={`story-${s.id}`}
          coordinate={{ latitude: s.fuzzed_lat, longitude: s.fuzzed_lng }}
          accessibilityLabel="Public story, approximate location"
        >
          <View style={styles.storyPin}>
            {storyPhotoUrls[s.user_id] ? (
              <Image source={{ uri: storyPhotoUrls[s.user_id] }} style={styles.storyPinImage} />
            ) : (
              <View style={[styles.storyPinImage, styles.storyPinPlaceholder]} />
            )}
          </View>
          <Callout onPress={() => onSelectStory(s)} tooltip={false}>
            <View style={styles.calloutCard}>
              <Text style={styles.calloutTitle}>📸 Public Story</Text>
              <Text style={styles.calloutAction}>Tap to view</Text>
            </View>
          </Callout>
        </Marker>
      ))}
    </MapView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  map: { flex: 1 },
  storyPin: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, borderColor: '#e1306c',
    overflow: 'hidden', backgroundColor: colors.surfaceElevated,
  },
  storyPinImage: { width: '100%', height: '100%' },
  storyPinPlaceholder: {},
  calloutCard: { padding: spacing.sm, minWidth: 160, maxWidth: 220 },
  liveBadge: { color: '#e63946', fontSize: 10, fontWeight: '800', marginBottom: 2 },
  calloutTitle: { ...typography.bodyBold, color: '#1a1a1a', fontSize: 14 },
  calloutHost: { color: '#666', fontSize: 12, marginTop: 2 },
  calloutDistance: { color: '#888', fontSize: 11, marginTop: 2 },
  calloutAction: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 6 },
});