import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getGatheringOffer } from '../services/brandOffers';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme';

// Self-contained, same pattern as NewcomerBadge/BusinessHostBadge —
// shown publicly as an incentive to join, since that's the whole
// point of attaching a reward to a gathering in the first place.
export default function GatheringOfferBadge({ gatheringId }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const [offer, setOffer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getGatheringOffer(gatheringId).then((result) => {
      if (!cancelled && result) setOffer(result);
    });
    return () => { cancelled = true; };
  }, [gatheringId]);

  if (!offer) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>🎁 {offer.title}</Text>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start', backgroundColor: '#f59e0b20', borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.sm, borderWidth: 1, borderColor: '#f59e0b',
  },
  text: { color: '#f59e0b', fontSize: 11, fontWeight: '700' },
});