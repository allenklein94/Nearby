import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { mapPinGlyph, PIN_HEAD, PIN_TAIL, PIN_GLYPH_SIZE, PIN_BADGE } from '../utils/mapPinGlyph';

// Owner idea "346": a map pin = the pin's existing colour + a glyph for its type (utils/mapPinGlyph.js), drawn as a round
// head over a short tail whose point is the coordinate. Static (no animation); hidden from screen readers because the
// Marker carries the pin's label, unchanged.
export default function MapGlyphPin({ color, kind, live = false, categoryIcon = null }) {
  const { glyph, badge } = mapPinGlyph({ kind, live, categoryIcon });
  return (
    <View style={styles.box} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.head, { backgroundColor: color }]}>
        <Text style={styles.glyph} allowFontScaling={false}>{glyph}</Text>
      </View>
      <View style={[styles.tail, { borderTopColor: color }]} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeGlyph} allowFontScaling={false}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: PIN_HEAD + PIN_BADGE / 2, height: PIN_HEAD + PIN_TAIL, alignItems: 'center' },
  head: {
    width: PIN_HEAD, height: PIN_HEAD, borderRadius: PIN_HEAD / 2, borderWidth: 2, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
  },
  glyph: { fontSize: PIN_GLYPH_SIZE, lineHeight: PIN_GLYPH_SIZE + 3, textAlign: 'center' },
  tail: {
    width: 0, height: 0, marginTop: -1,
    borderLeftWidth: PIN_TAIL, borderRightWidth: PIN_TAIL, borderTopWidth: PIN_TAIL + 1,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  badge: {
    position: 'absolute', top: 0, right: 0, width: PIN_BADGE, height: PIN_BADGE, borderRadius: PIN_BADGE / 2,
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
  },
  badgeGlyph: { fontSize: PIN_BADGE - 4, lineHeight: PIN_BADGE - 1, textAlign: 'center' },
});
