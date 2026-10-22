// Google Places attribution (owner decision 2026-10-22; Google's Places policies): every list of Google Places results that
// is not on a Google map carries "Google Maps" beside it, in the same container, always visible. Text form (allowed by
// Google's policy where space is limited); never localized, never on one line wrapped, Roboto (system sans fallback), 12sp,
// weight 400, #5E5E5E (light) / white (dark). The optional `label` is Nearby's own words (e.g. "Not Nearby partners").
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

export const GOOGLE_MAPS_ATTRIBUTION = 'Google Maps';

export default function GoogleMapsAttribution({ label = null, style }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[styles.row, style]}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>{label}</Text> : <View style={{ flex: 1 }} />}
      <Text style={[styles.google, { color: isDark ? '#FFFFFF' : '#5E5E5E' }]} numberOfLines={1} accessibilityLabel={GOOGLE_MAPS_ATTRIBUTION}>
        {GOOGLE_MAPS_ATTRIBUTION}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  label: { flex: 1, fontSize: 12, marginRight: spacing.sm },
  google: {
    fontFamily: Platform.OS === 'android' ? 'Roboto' : undefined,
    fontSize: 12, fontWeight: '400', fontStyle: 'normal', letterSpacing: 0, flexShrink: 0,
  },
});
