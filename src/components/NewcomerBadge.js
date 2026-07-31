import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// A self-contained badge that fetches its own newcomer count —
// deliberately isolated from GatheringsScreen's larger render logic
// so it can be dropped into a card without touching that file's
// existing, already-verified state and data flow.
export default function NewcomerBadge({ gatheringId }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [count, setCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_newcomer_count', { gathering_id_param: gatheringId }).then(({ data, error }) => {
      if (!cancelled && !error && data > 0) setCount(data);
    });
    return () => { cancelled = true; };
  }, [gatheringId]);

  if (!count) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>🌱 {count} first-timer{count === 1 ? '' : 's'} to gatherings, attending</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', backgroundColor: colors.surfaceElevated, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  text: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
});