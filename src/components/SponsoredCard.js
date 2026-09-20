import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, typography } from '../theme';
import { SPONSORED_LABEL, sponsoredWhyText } from '../constants/sponsored';

// THE only way a sponsored item renders (item 44). The label is a constant in this component, not a data field, so a
// served card cannot lack it. Deliberately its own card, not the organic one: no organic reason line, no friend or
// popularity claim, and no offer wording. The pill is a neutral outline (coral is reserved for actions).
export default function SponsoredCard({ card, categoryLabel, onView, onHide, onReport }) {
  const { colors, shadow } = useTheme();
  const styles = getStyles(colors, shadow);
  const [why, setWhy] = useState(false);
  if (!card) return null;
  return (
    <View style={styles.card} accessibilityLabel={`${SPONSORED_LABEL}: ${card.title}, ${card.partner_name}`}>
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{SPONSORED_LABEL}</Text>
        </View>
        <Text style={styles.by} numberOfLines={1}>{SPONSORED_LABEL} · {card.partner_name}</Text>
      </View>
      <TouchableOpacity onPress={onView} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`View ${card.title}`}>
        <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
        {card.description ? <Text style={styles.description} numberOfLines={3}>{card.description}</Text> : null}
        <Text style={styles.view}>View</Text>
      </TouchableOpacity>
      <View style={styles.controls}>
        <TouchableOpacity onPress={() => setWhy((v) => !v)} accessibilityRole="button" accessibilityLabel="Why am I seeing this?">
          <Text style={styles.link}>Why am I seeing this?</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onHide} accessibilityRole="button" accessibilityLabel="Hide this sponsor">
          <Text style={styles.link}>Hide this sponsor</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onReport} accessibilityRole="button" accessibilityLabel="Report this ad">
          <Text style={styles.link}>Report this ad</Text>
        </TouchableOpacity>
      </View>
      {why ? <Text style={styles.whyText}>{sponsoredWhyText(card.partner_name, categoryLabel)}</Text> : null}
    </View>
  );
}

function getStyles(colors, shadow) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.lg, marginBottom: spacing.md, ...shadow.card,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    pill: { borderWidth: 1, borderColor: colors.textTertiary, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 2, marginRight: spacing.sm },
    pillText: { ...typography.caption, color: colors.textTertiary, fontWeight: '700' },
    by: { ...typography.caption, color: colors.textTertiary, flex: 1 },
    title: { ...typography.headline, color: colors.textPrimary },
    description: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
    view: { color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: spacing.sm },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
    link: { ...typography.caption, color: colors.textTertiary, textDecorationLine: 'underline' },
    whyText: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm },
  });
}
