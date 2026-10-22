// Google Places attribution (owner decisions 2026-10-22; Google's Places policies, "Google Maps logo and text attribution"):
// every list of Google Places results that is not on a Google map carries Google's attribution beside it, in the same
// container, always visible. The LOGO form (Google: "Attribution should take the form of the Google Maps logo whenever
// possible"): Google's official files, unmodified (assets/google/, from Google's "Google Maps attribution assets" download,
// fetched 2026-10-22), the non-outlined logo on Nearby's plain backgrounds (gray on light, white on dark), 18dp high (Google:
// 16-19dp) at its own aspect ratio, clear space 10dp left/right/top and 5dp below, screen-reader label "Google Maps".
// If the image cannot be shown, the text form Google allows takes its place: "Google Maps", never localized, one line,
// Roboto (system sans fallback), 12sp, weight 400, #5E5E5E (light) / white (dark). The optional `label` is Nearby's own words
// (e.g. "Not Nearby partners").
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

export const GOOGLE_MAPS_ATTRIBUTION = 'Google Maps';
// Google's 1x file is 98 x 18; the @2x/@3x files are the same artwork at higher density.
export const GOOGLE_MAPS_LOGO_SIZE = Object.freeze({ width: 98, height: 18 });
export const GOOGLE_MAPS_LOGO_CLEAR_SPACE = Object.freeze({ left: 10, right: 10, top: 10, bottom: 5 });
const LOGO = {
  light: require('../../assets/google/google_maps_logo_gray.png'),
  dark: require('../../assets/google/google_maps_logo_white.png'),
};

export default function GoogleMapsAttribution({ label = null, style }) {
  const { colors, isDark } = useTheme();
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <View style={[styles.row, style]}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>{label}</Text> : <View style={{ flex: 1 }} />}
      {logoFailed ? (
        <Text style={[styles.google, { color: isDark ? '#FFFFFF' : '#5E5E5E' }]} numberOfLines={1} accessibilityLabel={GOOGLE_MAPS_ATTRIBUTION}>
          {GOOGLE_MAPS_ATTRIBUTION}
        </Text>
      ) : (
        <View style={styles.logoClearSpace}>
          <Image
            source={isDark ? LOGO.dark : LOGO.light}
            style={styles.logo}
            resizeMode="contain"
            onError={() => setLogoFailed(true)}
            accessible
            accessibilityRole="image"
            accessibilityLabel={GOOGLE_MAPS_ATTRIBUTION}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  label: { flex: 1, fontSize: 12, marginRight: spacing.sm },
  logoClearSpace: {
    paddingLeft: GOOGLE_MAPS_LOGO_CLEAR_SPACE.left, paddingRight: GOOGLE_MAPS_LOGO_CLEAR_SPACE.right,
    paddingTop: GOOGLE_MAPS_LOGO_CLEAR_SPACE.top, paddingBottom: GOOGLE_MAPS_LOGO_CLEAR_SPACE.bottom, flexShrink: 0,
  },
  logo: { width: GOOGLE_MAPS_LOGO_SIZE.width, height: GOOGLE_MAPS_LOGO_SIZE.height },
  google: {
    fontFamily: Platform.OS === 'android' ? 'Roboto' : undefined,
    fontSize: 12, fontWeight: '400', fontStyle: 'normal', letterSpacing: 0, flexShrink: 0,
  },
});
