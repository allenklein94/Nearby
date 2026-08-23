import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, typography } from '../theme';

// Phase 2 of the "Build everything" plan (CLAUDE.md) -- the third of the
// three canonical card types (Person/Place/Plan). Photo (or a fallback
// icon), name, one real "why now" reason line -- open-now status, price/
// rating, a real active offer, or a matched-category signal, whatever the
// calling screen already computed, never invented here -- and one
// primary action (View/Get Offer/Navigate), always a whole-row tap since
// every real call site so far is a simple "go look at the real thing"
// row. Reuses the exact card chrome (radius/border/shadow) already
// established by DiscoverHubScreen.js's own generic row across its
// Gatherings/Communities/Places/Perks sections, so this genuinely
// standardizes on what was already the de facto shared shape there.
export default function PlaceCard({
  photoUrl,
  icon = '📍',
  title,
  reason,
  onPress,
  accessibilityLabel,
  style,
}) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);

  return (
    <TouchableOpacity
      style={[styles.row, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={accessibilityLabel ?? `${title}${reason ? `, ${reason}` : ''}`}
      accessibilityRole="button"
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.image} />
      ) : (
        <Text style={styles.icon}>{icon}</Text>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {reason ? (
          <Text style={styles.reason} numberOfLines={1}>
            {reason}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const getStyles = (colors, shadow) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
    },
    image: { width: 44, height: 44, borderRadius: radius.md, marginRight: spacing.md },
    icon: { fontSize: 32, marginRight: spacing.md },
    info: { flex: 1 },
    title: { ...typography.headline, color: colors.textPrimary },
    reason: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
    chevron: { color: colors.textTertiary, fontSize: 24 },
  });
