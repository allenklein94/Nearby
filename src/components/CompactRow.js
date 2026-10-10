import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';

// Discover's compact row (design review 2026-10-10): no card chrome, a round thumbnail (the item's own real photo when it
// has one, else its icon on a tint of its real category color), a title, ONE metadata line and a hairline divider. Used for
// communities, places, perks and the ordinary gatherings in Tonight / This Weekend, so the section heroes carry the visual
// weight. Presentation only: every caller passes the same title, meta, action and tap it already had.
//
// action: optional { label, isState, onPress, accessibilityLabel }. A live action (Join, Redeem...) is coral; a state
// ("Going", "Redeemed ✓") is muted text, never a button. With its own onPress the action is a separate touchable (the row
// body keeps its own tap); without one it is just the row's label. No action = a chevron.
export const COMPACT_ROW_MIN_HEIGHT = 56;
export const COMPACT_THUMB_SIZE = 40;

export default function CompactRow({
  icon = '•',
  photoUrl = null,
  photoHeaders,
  tintColor = null,
  title,
  meta = null,
  metaIsWarning = false,
  action = null,
  onPress,
  accessibilityLabel,
  accessibilityState,
  divider = true,
  style,
  testID,
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const actionStyle = action?.isState ? styles.stateLabel : styles.actionLabel;

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.row, divider && styles.divider, style]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel ?? [title, meta].filter(Boolean).join(', ')}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl, headers: photoHeaders }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.iconWrap, { backgroundColor: tintColor ? `${tintColor}29` : colors.surfaceElevated }]}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {meta ? (
          <Text style={[styles.meta, metaIsWarning && { color: colors.danger }]} numberOfLines={1}>{meta}</Text>
        ) : null}
      </View>
      {action?.label ? (
        action.onPress && !action.isState ? (
          <TouchableOpacity
            onPress={action.onPress}
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={actionStyle} numberOfLines={1}>{action.label}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={actionStyle} numberOfLines={1}>{action.label}</Text>
        )
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </TouchableOpacity>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', minHeight: COMPACT_ROW_MIN_HEIGHT,
      paddingVertical: spacing.sm + 2,
    },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    thumb: { width: COMPACT_THUMB_SIZE, height: COMPACT_THUMB_SIZE, borderRadius: COMPACT_THUMB_SIZE / 2, marginRight: spacing.md },
    iconWrap: { alignItems: 'center', justifyContent: 'center' },
    icon: { fontSize: 19 },
    info: { flex: 1, marginRight: spacing.sm },
    title: { ...typography.headline, fontSize: 15, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
    chevron: { color: colors.textTertiary, fontSize: 22 },
    actionLabel: { color: colors.primary, fontWeight: '700', fontSize: 13 },
    stateLabel: { color: colors.textTertiary, fontWeight: '600', fontSize: 12 },
  });
