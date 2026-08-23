import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing } from '../theme';

// Phase 2 of the "Build everything" plan (CLAUDE.md) -- the second of the
// three canonical card types (Person/Place/Plan). A presentational shell
// only: photo, name, an optional plain subtitle line, and up to 2 real
// context chips (shared interest, mutual-friend count, etc. -- reusing
// whatever real signal the calling screen already computed, never a
// fabricated one). The one primary action (Add/Accept/Message/View
// Profile, or a decline/circle-tag icon alongside it) stays with the
// caller via the `action` node, same reasoning PlanCard's own Interest/
// Invite buttons stayed with GatheringsScreen rather than being absorbed
// here -- action semantics genuinely differ per screen; the redundant
// part standardized here is only the photo+name+context presentation.
export default function PersonCard({
  photoUrl,
  name,
  subtitle,
  chips,
  distanceLabel,
  onPress,
  action,
  accessibilityLabel,
  style,
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const subtitleParts = [];
  if (subtitle) subtitleParts.push(subtitle);
  if (distanceLabel) subtitleParts.push(distanceLabel);
  const subtitleLine = subtitleParts.join(' · ');

  return (
    <View style={[styles.row, style]}>
      <TouchableOpacity
        style={styles.info}
        onPress={onPress}
        disabled={!onPress}
        accessibilityLabel={accessibilityLabel ?? `View ${name}'s profile${subtitleLine ? `, ${subtitleLine}` : ''}`}
        accessibilityRole="button"
      >
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <View style={styles.textCol}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {subtitleLine ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitleLine}
            </Text>
          ) : null}
          {chips?.length > 0 && (
            <View style={styles.chipRow}>
              {chips.slice(0, 2).map((chip, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {chip}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
      {action}
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    info: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22, marginRight: spacing.sm, backgroundColor: colors.surfaceElevated },
    avatarPlaceholder: {},
    textCol: { flex: 1 },
    name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    subtitle: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
    chipRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
    chip: { backgroundColor: colors.surfaceElevated, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, maxWidth: 160 },
    chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  });
