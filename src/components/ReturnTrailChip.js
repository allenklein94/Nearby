import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, BackHandler, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';
import { navigationRef } from '../navigation/RootNavigator';
import { getTrail, subscribeTrail, clearTrail, trailLabel } from '../navigation/returnTrail';
import { restoreTrail } from '../navigation/returnTrailNav';

// Item 139 follow-up: the way back after a push switched to this tab and closed
// screens (returnTrail.js). Android: the hardware Back reopens them. iOS (no
// system Back on a tab): a small "← Back to Chat" chip with a ✕. Renders
// nothing when there is no trail for this tab; never covers the tab bar or
// takes over any other control.
export default function ReturnTrailChip({ tab }) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [trail, setTrail] = useState(getTrail());
  useEffect(() => subscribeTrail(setTrail), []);
  const mine = trail && trail.tab === tab ? trail : null;

  useEffect(() => {
    if (!mine || !focused || Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      restoreTrail(navigationRef);
      return true;
    });
    return () => sub.remove();
  }, [mine, focused]);

  if (!mine || Platform.OS !== 'ios') return null;
  const label = trailLabel(mine);
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
        onPress={() => restoreTrail(navigationRef)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>← {label}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={clearTrail} accessibilityRole="button" accessibilityLabel="Dismiss" style={styles.dismiss}>
        <Text style={{ color: colors.textSecondary }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.lg, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  dismiss: { padding: spacing.sm, marginLeft: spacing.xs },
});
