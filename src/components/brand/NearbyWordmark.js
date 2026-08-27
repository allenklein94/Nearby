import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import NearbyMark from './NearbyMark';

/**
 * The full brand lockup — the N Connection mark beside the "Nearby"
 * wordmark. Use this (not the mark alone) wherever the full brand name
 * should read alongside the logo, e.g. a welcome/auth screen.
 *
 * textVariant:
 *  - 'auto' (default) — theme text color (dark text in light mode, light
 *    text in dark mode).
 *  - 'white' — forces white text + a solid-white mark, for placing the
 *    lockup directly on a coral/dark image background.
 */
export default function NearbyWordmark({ size = 32, textVariant = 'auto', style }) {
  const theme = useTheme();
  const isWhite = textVariant === 'white';
  const textColor = isWhite ? '#FFFFFF' : theme?.colors?.textPrimary ?? '#2D2420';

  return (
    <View style={[styles.row, style]}>
      <NearbyMark size={size} variant={isWhite ? 'white' : 'gradient'} />
      <Text style={[styles.text, { color: textColor, fontSize: size * 0.72 }]}>Nearby</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { fontWeight: '800', letterSpacing: -0.5 },
});
