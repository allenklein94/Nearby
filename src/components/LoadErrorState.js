import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, typography } from '../theme';

// Shared "couldn't load, try again" state for screens whose initial data
// fetch has no error handling at all — previously a thrown error (e.g. no
// connection) left the screen showing its loading spinner forever, with no
// message and no way to recover short of leaving and coming back. This is
// the load-side counterpart to useChatComposer's send-side recovery: same
// idea (don't fail silently, let the user retry), different half of the
// request lifecycle.
export default function LoadErrorState({ message, onRetry }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Couldn't load this</Text>
      <Text style={styles.message}>{message ?? 'Check your connection and try again.'}</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={onRetry}
        accessibilityLabel="Try again"
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    container: { padding: spacing.xl, alignItems: 'center' },
    title: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs },
    message: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });
