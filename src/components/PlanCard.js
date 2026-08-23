import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing } from '../theme';
import { PLAN_STATUS_META } from '../constants/planStatus';

// Phase 2 of the "Build everything" plan (CLAUDE.md) -- one of the three
// canonical card types (Person/Place/Plan). Renders any plan-shaped
// object (a gathering commitment, a group plan) with one consistent
// shape: icon, title, a single real subtitle line combining people count
// + venue name + date/time -- direct implementation of the UX critique's
// "make relationships visible" example ("Saturday Gathering · 6 people ·
// The Grove · 7:00 PM" in one line) -- and a real status badge from the
// controlled vocabulary (constants/planStatus.js). Every field is real
// and optional; a card with no venue/no people count just renders a
// shorter subtitle, never a fabricated placeholder.
//
// Self-contained venue-name lookup (same established pattern as
// BusinessHostBadge.js) so a caller can pass a bare hostingPartnerId
// without widening its own query just to carry a business name through.
export default function PlanCard({
  icon,
  iconColor,
  title,
  roleLabel,
  dateTimeText,
  peopleCount,
  hostingPartnerId,
  venueName: venueNameProp,
  status,
  onPress,
  accessibilityLabel,
  style,
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [fetchedVenueName, setFetchedVenueName] = useState(null);

  useEffect(() => {
    if (!hostingPartnerId || venueNameProp) return;
    let cancelled = false;
    supabase
      .from('brand_partners')
      .select('name')
      .eq('id', hostingPartnerId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setFetchedVenueName(data.name);
      });
    return () => {
      cancelled = true;
    };
  }, [hostingPartnerId, venueNameProp]);

  const venueName = venueNameProp ?? fetchedVenueName;

  const subtitleParts = [];
  // Real caller relationship to the plan (e.g. "Going"/"Hosting") -- only
  // ever needed when the surrounding UI doesn't already convey it some
  // other way (e.g. Home's own "Going"/"Hosting" section headers make
  // this redundant there, but a merged/sorted list with no per-role
  // grouping still needs it, same real gap this prop closes).
  if (roleLabel) subtitleParts.push(roleLabel);
  if (peopleCount != null) subtitleParts.push(`${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`);
  if (venueName) subtitleParts.push(venueName);
  if (dateTimeText) subtitleParts.push(dateTimeText);
  const subtitle = subtitleParts.join(' · ');

  const meta = status ? PLAN_STATUS_META[status] : null;
  const badgeColors = !meta
    ? null
    : meta.tone === 'active'
    ? { bg: colors.primaryMuted, fg: colors.primary }
    : meta.tone === 'negative'
    ? { bg: colors.surfaceElevated, fg: colors.danger }
    : meta.tone === 'past'
    ? { bg: colors.surfaceElevated, fg: colors.textTertiary }
    : { bg: colors.surfaceElevated, fg: colors.textSecondary };

  return (
    <TouchableOpacity
      style={[styles.row, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={accessibilityLabel ?? `${title}${subtitle ? `, ${subtitle}` : ''}${meta ? `, ${meta.label}` : ''}`}
      accessibilityRole="button"
    >
      {icon != null && (iconColor ? (
        <View style={[styles.iconWrap, { backgroundColor: `${iconColor}30` }]}>
          <Text style={styles.iconInWrap} accessibilityElementsHidden>
            {icon}
          </Text>
        </View>
      ) : (
        <Text style={styles.icon} accessibilityElementsHidden>
          {icon}
        </Text>
      ))}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta && (
        <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
          <Text style={[styles.badgeText, { color: badgeColors.fg }]}>{meta.label}</Text>
        </View>
      )}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
    icon: { fontSize: 22, marginRight: spacing.sm },
    iconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
    iconInWrap: { fontSize: 18 },
    info: { flex: 1 },
    title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    badge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, marginLeft: spacing.sm },
    badgeText: { fontSize: 11, fontWeight: '700' },
    chevron: { color: colors.textTertiary, fontSize: 18, marginLeft: spacing.xs },
  });
