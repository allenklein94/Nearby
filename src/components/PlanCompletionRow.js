import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import { PLAN_STAGE_DONE, PLAN_STAGE_PENDING, PLAN_STAGE_TODO } from '../utils/planCompletion';

// The one shared "People / Time / Place" plan-completion row (CLAUDE.md,
// Aug 29 2026), reused by GatheringDetailScreen, DateProposalScreen, and
// MatchesScreen rather than three independently hand-written copies of the
// same three-chip status line -- exactly the "same real underlying
// experience regardless of how the plan started" bar this codebase has
// already held every other shared plan-status component to
// (AcceptedBusinessOfferCard's own header comment states the identical
// reasoning).
//
// Locked coral-usage rule (CLAUDE.md): coral is reserved for a surface's
// primary *action*, never for plain informational status. Only the Place
// segment is ever actually tappable (People/Time are facts, not actions),
// and only in its `todo`/`pending` states -- so coral only ever appears
// there, never on a segment that's just describing something that's
// already true.
function stageIcon(stage) {
  if (stage === PLAN_STAGE_DONE) return '✓';
  if (stage === PLAN_STAGE_PENDING) return '⋯';
  return '○';
}

export default function PlanCompletionRow({
  people,
  time,
  place,
  placeLabels = { done: 'Confirmed', pending: 'Waiting to hear back', todo: 'Find a place' },
  onPlacePress,
  style,
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  function segmentColor(stage, tappable) {
    if (stage === PLAN_STAGE_DONE) return colors.success;
    if (tappable && stage !== PLAN_STAGE_DONE) return colors.primary;
    if (stage === PLAN_STAGE_PENDING) return colors.textSecondary;
    return colors.textTertiary;
  }

  const placeLabel = placeLabels[place] ?? placeLabels.todo;
  const placeTappable = typeof onPlacePress === 'function';

  return (
    <View style={[styles.row, style]} accessibilityRole="summary">
      <View style={styles.segment}>
        <Text style={[styles.icon, { color: segmentColor(people, false) }]}>{stageIcon(people)}</Text>
        <Text style={[styles.label, { color: segmentColor(people, false) }]}>People</Text>
      </View>
      <View style={styles.dot} />
      <View style={styles.segment}>
        <Text style={[styles.icon, { color: segmentColor(time, false) }]}>{stageIcon(time)}</Text>
        <Text style={[styles.label, { color: segmentColor(time, false) }]}>Time</Text>
      </View>
      <View style={styles.dot} />
      {placeTappable ? (
        <TouchableOpacity
          style={styles.segment}
          onPress={onPlacePress}
          accessibilityLabel={`Place: ${placeLabel}`}
          accessibilityRole="button"
        >
          <Text style={[styles.icon, { color: segmentColor(place, true) }]}>{stageIcon(place)}</Text>
          <Text style={[styles.label, styles.labelTappable, { color: segmentColor(place, true) }]}>
            {place === PLAN_STAGE_DONE ? 'Place' : placeLabel}
          </Text>
          {place !== PLAN_STAGE_DONE && <Text style={[styles.arrow, { color: segmentColor(place, true) }]}>→</Text>}
        </TouchableOpacity>
      ) : (
        <View style={styles.segment}>
          <Text style={[styles.icon, { color: segmentColor(place, false) }]}>{stageIcon(place)}</Text>
          <Text style={[styles.label, { color: segmentColor(place, false) }]}>
            {place === PLAN_STAGE_DONE ? 'Place' : placeLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    segment: { flexDirection: 'row', alignItems: 'center' },
    icon: { fontSize: 13, fontWeight: '700', marginRight: 3 },
    label: { ...typography.caption, fontWeight: '600', fontSize: 12 },
    labelTappable: { textDecorationLine: 'underline' },
    arrow: { fontSize: 12, fontWeight: '700', marginLeft: 2 },
    dot: {
      width: 3,
      height: 3,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginHorizontal: spacing.xs,
    },
  });
