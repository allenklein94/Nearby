import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import OfferMedia from './OfferMedia';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import { offerPriceLabel } from '../utils/outcomeDisplay';
import { validityLabel, isOfferExpired, availableWindowLabel } from '../utils/offerMedia';

export function formatProposedTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The body of an offer exactly as the CUSTOMER sees it (description, included items, proposed time, price, available
// window, validity, media). One component used by the customer's offer card AND the owner's "Customer Preview", so the
// preview cannot drift from what is actually shown. `offer` uses the stored row's field names. `localMedia` (owner
// preview only) = { uri, type } for a file not uploaded yet.
export default function OfferCustomerBody({ offer: o, showTypeLabel = false, typeLabel = null, localMedia = null }) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const price = offerPriceLabel(o.offer_price, o.price_is_per_person);
  const window = availableWindowLabel(o.available_from, o.available_until);
  return (
    <View>
      {showTypeLabel && typeLabel ? <Text style={styles.offerTypeLabel}>{typeLabel}</Text> : null}
      {o.offer_description ? <Text style={styles.offerDescription}>{o.offer_description}</Text> : null}
      {(o.included_items ?? []).map((item, index) => (
        <Text key={index} style={styles.offerIncludedItem}>✓ {item}</Text>
      ))}
      {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time)}</Text> : null}
      {price ? <Text style={styles.offerPrice}>{price}</Text> : null}
      {window ? <Text style={styles.offerProposedTime}>🕒 {window}</Text> : null}
      {o.valid_until ? <Text style={styles.offerProposedTime}>⏳ {isOfferExpired(o) ? 'This offer has expired' : validityLabel(o.valid_until)}</Text> : null}
      {localMedia ? (
        <OfferMedia localUri={localMedia.uri} type={localMedia.type} />
      ) : (
        <OfferMedia path={o.media_path} type={o.media_type} posterPath={o.media_poster_path} />
      )}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  offerTypeLabel: { ...typography.caption, color: colors.info, fontWeight: '700', marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerIncludedItem: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
});
