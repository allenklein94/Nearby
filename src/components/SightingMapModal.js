import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

// A single-pin map for one specific Crossed Paths encounter, using
// only the fuzzed coordinate (~0.24 mile jitter, same protection as
// gatherings) — never the actual precise location either person was
// really standing at.
export default function SightingMapModal({ visible, onClose, latitude, longitude, personName }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  if (!visible) return null;

  const hasCoords = latitude != null && longitude != null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Roughly where you crossed paths</Text>
          <Text style={styles.subtitle}>An approximate area, not an exact location</Text>

          {hasCoords ? (
            <MapView
              style={styles.map}
              initialRegion={{ latitude, longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
            >
              <Marker coordinate={{ latitude, longitude }} pinColor={colors.primary} title={personName} />
            </MapView>
          ) : (
            <View style={[styles.map, styles.mapPlaceholder]}>
              <Text style={styles.placeholderText}>Location not available for this crossing</Text>
            </View>
          )}

          <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg }} accessibilityLabel="Close map" accessibilityRole="button">
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: 2 },
  subtitle: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.md },
  map: { height: 300, borderRadius: radius.lg, overflow: 'hidden' },
  mapPlaceholder: { backgroundColor: colors.surfaceElevated, justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: colors.textTertiary, fontSize: 13 },
  closeText: { color: colors.textTertiary, textAlign: 'center', fontSize: 14 },
});