import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import OfferMedia from './OfferMedia';
import { AssemblyStep } from './OfferAssembly';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import { offerPriceLabel } from '../utils/outcomeDisplay';
import { validityLabel, isOfferExpired, availableWindowLabel } from '../utils/offerMedia';
import { discountHeadlinePct, offerWhenDay, offerWhenLineText } from '../utils/offerPresentation';
import { useLanguage } from '../context/LanguageContext';
import { tr, getCurrentLanguage } from '../i18n/translate';
import { displayDateTime } from '../i18n/display';
import { localClock, localWindow } from '../i18n/format';

const isEnglish = (language) => !language || language === 'en';
const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// The business's proposed time ("Sat, Aug 14, 7:15 PM"), in the person's language (English keeps its own format).
export function formatProposedTime(iso, language = getCurrentLanguage()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (!isEnglish(language)) return displayDateTime(iso, language);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// "Valid until 7 PM" / "Available 6–8 PM" in the person's language; the same decisions as the English helpers.
export function offerValidityText(validUntil, language, now = new Date()) {
  if (isEnglish(language)) return validityLabel(validUntil, now);
  if (!validUntil || Number.isNaN(new Date(validUntil).getTime())) return null;
  return localWindow({ end: new Date(validUntil).toISOString() }, now, 'offer', language);
}
export function offerWindowText(from, until, language) {
  if (isEnglish(language)) return availableWindowLabel(from, until);
  if (!availableWindowLabel(from, until)) return null;
  return tr('ui.requestDetail.availableWindow', { from: localClock(minutesOf(from), language), until: localClock(minutesOf(until), language) });
}

// The body of an offer exactly as the CUSTOMER sees it (description, included items, proposed time, price, available
// window, validity, media; price comes before time, the order the card assembles in). One component used by the customer's offer card AND the owner's "Customer Preview", so the
// preview cannot drift from what is actually shown. `offer` uses the stored row's field names. `localMedia` (owner
// preview only) = { uri, type } for a file not uploaded yet.
export default function OfferCustomerBody({ offer: o, showTypeLabel = false, typeLabel = null, localMedia = null }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors);
  const price = offerPriceLabel(o.offer_price, o.price_is_per_person);
  const window = offerWindowText(o.available_from, o.available_until, language);
  const pct = discountHeadlinePct(o);
  // Item 11: Nearby lays the card out from the pieces the business gave: media right under the header, then what they
  // wrote, the discount as a headline, the price, and one "Tonight · 5–9 PM" line when the validity adds nothing to it.
  const whenDay = offerWhenDay(o);
  return (
    <View>
      {showTypeLabel && typeLabel ? <Text style={styles.offerTypeLabel}>{typeLabel}</Text> : null}
      {/* Steps of the card assembling itself (components/OfferAssembly.js): the order, then the price, then when. Outside
          an assembly (the owner's preview, an accepted offer) they render as plain lines. */}
      <AssemblyStep step="order">
        {localMedia ? (
          <OfferMedia localUri={localMedia.uri} type={localMedia.type} />
        ) : (
          <OfferMedia path={o.media_path} type={o.media_type} posterPath={o.media_poster_path} />
        )}
        {o.offer_description ? <Text style={[styles.offerDescription, { marginTop: spacing.xs }]}>{o.offer_description}</Text> : null}
        {(o.included_items ?? []).map((item, index) => (
          <Text key={index} style={styles.offerIncludedItem}>✓ {item}</Text>
        ))}
      </AssemblyStep>
      <AssemblyStep step="price">
        {pct != null ? <Text style={styles.offerDiscount}>{t('ui.requestDetail.percentOff', { pct })}</Text> : null}
        {price ? <Text style={styles.offerPrice}>{price}</Text> : null}
      </AssemblyStep>
      <AssemblyStep step="when">
        {o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time, language)}</Text> : null}
        {whenDay ? (
          <Text style={styles.offerProposedTime}>🕒 {offerWhenLineText(whenDay, o.available_from, o.available_until, language)}</Text>
        ) : (
          <>
            {window ? <Text style={styles.offerProposedTime}>🕒 {window}</Text> : null}
            {o.valid_until ? <Text style={styles.offerProposedTime}>⏳ {isOfferExpired(o) ? t('ui.requestDetail.thisOfferHasExpired') : offerValidityText(o.valid_until, language)}</Text> : null}
          </>
        )}
      </AssemblyStep>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  offerTypeLabel: { ...typography.caption, color: colors.info, fontWeight: '700', marginBottom: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerIncludedItem: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerDiscount: { ...typography.title, color: colors.textPrimary, fontWeight: '800', letterSpacing: 0.5, marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
});
