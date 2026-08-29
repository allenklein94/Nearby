import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { categorizeReasonText, REASON_CATEGORY_ICONS } from '../constants/recommendationReasonVocabulary';

// P1 item 4 (CLAUDE.md, Aug 28 2026 Full Coherence Audit): one real,
// shared rendering of "why this fits you" reason lines -- used by both
// GatheringDetailScreen.js's own dedicated "Why this fits you" section
// and HomeScreen.js's Best Pick card, both of which already source the
// identical reasons array from services/gatherings.js's
// getGatheringFitReasons(). Replaces each screen's own independent,
// hardcoded "✓ {reason}" text prefix with a real icon drawn from the
// shared recommendation-reason vocabulary, so the same reason (e.g.
// "Matches your interests") reads with the same visual identity
// wherever it appears. Per the locked coral-usage rule (CLAUDE.md), this
// icon is informational, never an action -- iconColor is always passed
// in matching the caller's own existing text color, never brand coral.
export default function ReasonList({ reasons, textStyle, iconColor, iconSize = 14 }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <>
      {reasons.map((reason, i) => {
        const category = categorizeReasonText(reason);
        const iconName = REASON_CATEGORY_ICONS[category] ?? 'checkmark-circle-outline';
        return (
          <View key={i} style={styles.row}>
            <Ionicons name={iconName} size={iconSize} color={iconColor} style={styles.icon} />
            <Text style={textStyle}>{reason}</Text>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  // No margin of its own -- both real callers' own textStyle
  // (reasonLine/bestPickReason) already carries marginBottom: 2, so the
  // vertical rhythm here matches exactly what the plain "✓ {reason}"
  // Text row already had, not doubled by a second margin on this wrapper.
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 4 },
});
