import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';

export default function ConfidenceModeBanner({ onDismiss }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View style={styles.banner}>
      <Text style={styles.emoji}>💛</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Take a moment for yourself</Text>
        <Text style={styles.text}>
          You've reached out to a lot of people lately without a match yet. That's genuinely hard, and it says nothing about your worth. No pressure to keep going right now.
        </Text>
      </View>
      <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
        <Text style={styles.dismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg,
    padding: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  emoji: { fontSize: 24, marginRight: spacing.sm },
  title: { ...typography.bodyBold, color: colors.textPrimary, fontSize: 14, marginBottom: 4 },
  text: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  dismissButton: { padding: spacing.xs },
  dismissText: { color: colors.textTertiary, fontSize: 16 },
});