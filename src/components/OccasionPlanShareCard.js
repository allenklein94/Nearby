import React, { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import NearbyMark from './brand/NearbyMark';

// Item 107 (CLAUDE.md): "Build the occasion around a beautiful shareable
// card." A finalized plan (Item 90's own "Plan" summary card --
// title/dateLabel/timeLabel/location/partySize) rendered as a fixed-look,
// theme-independent branded graphic -- captured off-screen via
// react-native-view-shot (see BusinessRequestDetailScreen.js's
// handleSharePlanCard) and shared as a real image through the native
// share sheet, "a recognizable visual artifact" per the user's own
// framing. Deliberately NOT theme-aware (no useTheme()) -- a shared image
// should look the same regardless of the sharer's own light/dark setting,
// same reasoning docs/invite.html hardcodes its own light palette rather
// than reading the recipient's OS theme.
const CARD_WIDTH = 320;
const CARD_HEIGHT = 400;

const OccasionPlanShareCard = forwardRef(function OccasionPlanShareCard(
  { title, dateLabel, timeLabel, location, partySize },
  ref
) {
  const whenLine = [dateLabel, timeLabel].filter(Boolean).join(' · ');
  return (
    <View ref={ref} collapsable={false} style={styles.container}>
      <LinearGradient colors={['#FF6B5B', '#FFA35C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View style={styles.brandRow}>
          <NearbyMark size={22} variant="white" />
          <Text style={styles.brandText}>Nearby</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={3}>{title}</Text>
          {!!whenLine && <Text style={styles.line}>{whenLine}</Text>}
          {!!location && <Text style={styles.line}>📍 {location}</Text>}
          {partySize != null && <Text style={styles.line}>👥 {partySize} going</Text>}
        </View>

        <View style={styles.viewPlanPill}>
          <Text style={styles.viewPlanText}>View Plan</Text>
        </View>
      </LinearGradient>
    </View>
  );
});

export default OccasionPlanShareCard;
export { CARD_WIDTH, CARD_HEIGHT };

const styles = StyleSheet.create({
  container: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 28, overflow: 'hidden' },
  gradient: { flex: 1, padding: 28, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  body: { flex: 1, justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '800', fontSize: 26, letterSpacing: -0.3, marginBottom: 14 },
  line: { color: 'rgba(255,255,255,0.92)', fontWeight: '600', fontSize: 16, marginTop: 6 },
  viewPlanPill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10,
  },
  viewPlanText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
