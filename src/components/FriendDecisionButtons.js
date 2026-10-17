import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { FRIEND_DECISIONS } from '../utils/friendDiscoveryView';

// Owner idea 156: the labelled Pass / Connect pair, shared by Friends discovery's list rows and its optional deck, so both
// modes offer the same two explicit, worded choices (never a bare ✕ / 🤝). `compact` = the list row's size.
export default function FriendDecisionButtons({ name, onDecide, compact = false, disabled = false }) {
  const { t } = useLanguage();
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const { pass, connect } = FRIEND_DECISIONS;
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <TouchableOpacity
        style={[styles.pass, compact && styles.compact]}
        onPress={() => onDecide(pass.direction)}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityLabel={t(pass.a11yKey, { name })}
        accessibilityRole="button"
      >
        <Text style={styles.passText}>{t(pass.labelKey)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.connect, compact && styles.compact]}
        onPress={() => onDecide(connect.direction)}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityLabel={t(connect.a11yKey, { name })}
        accessibilityRole="button"
      >
        <Text style={styles.connectText}>{t(connect.labelKey)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors, shadow) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  rowCompact: { gap: spacing.sm },
  pass: {
    backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, ...shadow.card,
  },
  connect: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, ...shadow.button,
  },
  compact: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  passText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  connectText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
