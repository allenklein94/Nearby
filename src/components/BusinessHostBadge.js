import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Self-contained, like NewcomerBadge — fetches its own data so it
// can drop into a gathering card without touching that screen's
// larger, already-verified render logic. `navigation` is optional —
// callers that don't pass it just get a static, non-tappable badge.
export default function BusinessHostBadge({ hostingPartnerId, navigation }) {
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

  const Wrapper = navigation ? TouchableOpacity : View;
  const wrapperProps = navigation
    ? {
        onPress: () => navigation.navigate('BusinessProfile', { partnerId: hostingPartnerId }),
        accessibilityLabel: `View ${partnerName}'s business profile`,
        accessibilityRole: 'button',
      }
    : {};

  return (
    <Wrapper style={styles.badge} {...wrapperProps}>
      <Text style={styles.text}>🏪 Hosted by {partnerName}</Text>
    </Wrapper>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', backgroundColor: colors.primaryMuted, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.primary,
  },
  text: { color: colors.primary, fontSize: 11, fontWeight: '700' },
});