import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import OfferMedia from './OfferMedia';
import OfferCountdown from './OfferCountdown';
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
import OfferTimeChoice from './OfferTimeChoice';
import { offerTimes, choosableTimes, timePartySize } from '../utils/offerTimes';

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
// preview only) = { uri, type } for a file not uploaded yet. `countdown` (item 47) = presentOffer()'s countdown: in an open
// offer's last 30 minutes the validity line takes the amber in-progress tone with a thin bar of the time left under it.
// Item 119: a reply with two times shows both inside this one card. `onPickTime` (the customer's own open reply only)
// makes them selectable; `pickedTime` is the pick; `timeNotes` = { [iso]: text } beside a time ("Fits 7 PM").
// Item 118: `updated` (presentOffer().updated) = the business changed this open offer's price or time once; one quiet
// word above the terms, which are always the current ones (never the previous price or a saving). No motion.
// Item 119b: a second time made for fewer people says so beside it ("For 4 of your 6"); `partySize` = the request's
// party. A group plan passes wholePartyView(offer), so it never reaches here with that time.
export default function OfferCustomerBody({ offer: o, showTypeLabel = false, typeLabel = null, localMedia = null, countdown = null, pickedTime = null, onPickTime = null, timeNotes = {}, pickDisabled = false, updated = false, partySize = null }) {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const styles = getStyles(colors);
  const price = offerPriceLabel(o.offer_price, o.price_is_per_person);
  const window = offerWindowText(o.available_from, o.available_until, language);
  const pct = discountHeadlinePct(o);
  // Item 11: Nearby lays the card out from the pieces the business gave: media right under the header, then what they
  // wrote, the discount as a headline, the price, and one "Tonight · 5–9 PM" line when the validity adds nothing to it.
  const whenDay = offerWhenDay(o);
  const notes = { ...timeNotes };
  for (const iso of offerTimes(o)) {
    const count = timePartySize(o, iso);
    if (count != null) notes[iso] = partySize ? t('ui.requestDetail.forCountOfYour', { count, total: partySize }) : t('ui.requestDetail.forCountPeople', { count });
  }
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
        {updated ? <Text style={styles.offerUpdated}>{t('ui.requestDetail.offerUpdated')}</Text> : null}
        {pct != null ? <Text style={styles.offerDiscount}>{t('ui.requestDetail.percentOff', { pct })}</Text> : null}
        {price ? <Text style={styles.offerPrice}>{price}</Text> : null}
      </AssemblyStep>
      <AssemblyStep step="when">
        {offerTimes(o).length === 2 ? (
          <OfferTimeChoice
            times={offerTimes(o)}
            selected={pickedTime}
            onSelect={onPickTime}
            notes={notes}
            enabled={choosableTimes(o)}
            disabled={pickDisabled}
            format={(iso) => formatProposedTime(iso, language)}
          />
        ) : o.proposed_time ? <Text style={styles.offerProposedTime}>🕐 {formatProposedTime(o.proposed_time, language)}</Text> : null}
        {whenDay ? (
          <Text style={styles.offerProposedTime}>🕒 {offerWhenLineText(whenDay, o.available_from, o.available_until, language)}</Text>
        ) : (
          <>
            {window ? <Text style={styles.offerProposedTime}>🕒 {window}</Text> : null}
            {o.valid_until ? <Text style={[styles.offerProposedTime, !!countdown && styles.offerEndingSoon]}>⏳ {isOfferExpired(o) ? t('ui.requestDetail.thisOfferHasExpired') : offerValidityText(o.valid_until, language)}</Text> : null}
            {o.valid_until && !isOfferExpired(o) ? <OfferCountdown countdown={countdown} /> : null}
          </>
        )}
      </AssemblyStep>
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  offerTypeLabel: { ...typography.caption, color: colors.info, fontWeight: '700', marginBottom: spacing.xs },
  offerUpdated: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  offerDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  offerIncludedItem: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  offerProposedTime: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  offerEndingSoon: { color: colors.inProgress },
  offerDiscount: { ...typography.title, color: colors.textPrimary, fontWeight: '800', letterSpacing: 0.5, marginBottom: spacing.xs },
  offerPrice: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
});
