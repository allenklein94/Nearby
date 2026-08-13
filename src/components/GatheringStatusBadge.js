import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';

// Single source of truth for how a caller's own relationship to a
// gathering ("Going" / "Hosting" / "Waitlisted" / ...) is labeled and
// colored, reused across GatheringDetailScreen, GatheringsScreen, Home's
// Your Plans, and PlansScreen — previously each of those wrote its own
// bespoke copy/styling independently (e.g. "You're hosting this
// gathering." vs. a pill reading "✓ You're going" vs. plain "Hosting"
// text), so the same real status could look and read differently
// depending on which screen you were looking at it from.
export const GATHERING_STATUS_META = {
  hosting: { icon: '🎤', label: 'Hosting', bg: colors.primaryMuted, fg: colors.primary },
  going: { icon: '✓', label: 'Going', bg: colors.primaryMuted, fg: colors.primary },
  interested: { icon: '🕒', label: 'Requested', bg: colors.surfaceElevated, fg: colors.textSecondary },
  waitlisted: { icon: '⏳', label: 'Waitlisted', bg: colors.surfaceElevated, fg: colors.textSecondary },
  attended: { icon: '✓', label: 'Attended', bg: colors.surfaceElevated, fg: colors.textTertiary },
  hosted: { icon: '🎤', label: 'Hosted', bg: colors.surfaceElevated, fg: colors.textTertiary },
  didNotAttend: { icon: '—', label: "Didn't attend", bg: colors.surfaceElevated, fg: colors.textTertiary },
};

// `label`, when passed, fully replaces the default "{icon} {label}" text
// (icon included) — used by callers that need a translated string
// (e.g. GatheringsScreen's t('gatherings.youreGoing')) instead of the
// English default.
export default function GatheringStatusBadge({ status, label, variant = 'pill', style, textStyle }) {
  const meta = GATHERING_STATUS_META[status];
  if (!meta) return null;
  const text = label ?? `${meta.icon} ${meta.label}`;

  if (variant === 'inline') {
    return <Text style={[styles.inlineText, { color: meta.fg }, textStyle]}>{text}</Text>;
  }

  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }, style]}>
      <Text style={[styles.pillText, { color: meta.fg }, textStyle]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  pillText: { fontSize: 13, fontWeight: '700' },
  inlineText: { fontSize: 13, fontWeight: '600' },
});
