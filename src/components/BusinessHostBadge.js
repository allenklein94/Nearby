import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Self-contained, like NewcomerBadge — fetches its own data so it
// can drop into a gathering card without touching that screen's
// larger, already-verified render logic.
export default function BusinessHostBadge({ hostingPartnerId }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [partnerName, setPartnerName] = useState(null);

  useEffect(() => {
    if (!hostingPartnerId) return;
    let cancelled = false;
    supabase.from('brand_partners').select('name').eq('id', hostingPartnerId).single().then(({ data }) => {
      if (!cancelled && data) setPartnerName(data.name);
    });
    return () => { cancelled = true; };
  }, [hostingPartnerId]);

  if (!partnerName) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>🏪 Hosted by {partnerName}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.primary,
  },
  text: { color: colors.primary, fontSize: 11, fontWeight: '700' },
});