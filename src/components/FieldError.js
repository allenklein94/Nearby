// The inline explanation under a blocked field (owner UX audit, 2026-11-21); same look as Create Gathering's.
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';

export default function FieldError({ message, style }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <Text style={[styles.text, { color: colors.danger }, style]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({ text: { fontSize: 13, marginTop: spacing.xs, marginBottom: spacing.xs } });
