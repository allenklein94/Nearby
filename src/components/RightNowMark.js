import React from 'react';
import { StyleSheet, View } from 'react-native';

// Owner item 27 (2026-10-11): the "Right Now" radar mark -- a dot inside one faint ring, beside Home's Nearby Right Now and
// Discover's Happening Now headings. Drawn and still: it never moves on its own (items 15 + 22: no idle loop, no motion
// without a real event). The only motion is item 26's one ring (motion/HappeningRipple.js) when genuinely new activity
// appears; Reduce Motion = this mark alone. Decorative, so hidden from screen readers (the heading carries the label).
const SIZE = 14;
const DOT = 6;

export default function RightNowMark({ color, style }) {
  return (
    <View style={[styles.mark, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[styles.ring, { borderColor: color }]} />
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 1, opacity: 0.45 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
