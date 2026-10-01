import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import OfferMedia from './OfferMedia';
import { visibleRedemption } from '../utils/offerMedia';
import { formatOfferSummary } from '../services/businessFulfillment';
import { openUberToDestination } from '../utils/uberDeepLink';
import { useTheme } from '../context/ThemeContext';
import { displayDateTime } from '../i18n/display';
import { typography, spacing, radius } from '../theme';


// Convergence pass P1 follow-up (CLAUDE.md): the same "here's the real
// accepted business offer" block was independently written, byte-for-byte
// the same content, in GatheringDetailScreen (Gap #1) and DateProposalScreen
// (Gap #2) -- two different entry points into the same
// business_requests/business_request_offers lifecycle rendering the
// identical fact with two different style names. Factored out here so the
// "same underlying experience regardless of how the plan started" claim is
// literally true, not just similar-looking copies. BusinessRequestDetailScreen's
// own per-offer accepted state is deliberately NOT rebuilt onto this
// component -- it's a genuinely richer view (multiple offers, live payment
// status, accept/decline actions), not the same duplication.
//
// `bordered` controls the container treatment: `true` (default) renders a
// real standalone card, matching GatheringDetailScreen's own host-banner
// context; `false` renders as a plain inline block with just a top divider,
// for a caller (DateProposalScreen) that's already nesting this inside its
// own bordered card.
export default function AcceptedBusinessOfferCard({
  offer,
  kicker: kickerProp,
  partySize = null,
  onViewRequest,
  groupCare = false,
  bordered = true,
  style,
}) {
  const { t, language } = useLanguage();
  const { colors } = useTheme();
  const styles = getStyles(colors, bordered);

  if (!offer) return null;
  const kicker = kickerProp ?? t('ui.acceptedOffer.localBusinessConfirmed');
  const venue = offer.brand_partners?.name ?? t('ui.acceptedOffer.aLocalBusiness');

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.venue}>{venue}</Text>
      {groupCare ? <Text style={styles.sub}>{t('ui.acceptedOffer.takingCareOfGroup', { name: venue })}</Text> : null}
      {offer.proposed_time && <Text style={styles.sub}>{displayDateTime(offer.proposed_time, language)}</Text>}
      {partySize != null && (
        <Text style={styles.sub}>
          {t('ui.acceptedOffer.confirmedFor', { count: partySize })}
        </Text>
      )}
      {formatOfferSummary(offer, language) && <Text style={styles.sub}>{formatOfferSummary(offer, language)}</Text>}
      {offer.offer_description ? <Text style={styles.desc}>{offer.offer_description}</Text> : null}
      <OfferMedia path={offer.media_path} type={offer.media_type} posterPath={offer.media_poster_path} />
      {visibleRedemption(offer) ? <Text style={styles.sub}>{t('ui.acceptedOffer.howToRedeem')}{' '}{visibleRedemption(offer)}</Text> : null}
      {offer.brand_partners?.latitude != null && offer.brand_partners?.longitude != null && (
        <TouchableOpacity
          onPress={() => openUberToDestination({
            latitude: offer.brand_partners.latitude,
            longitude: offer.brand_partners.longitude,
            nickname: offer.brand_partners.name,
            address: offer.brand_partners.address,
          })}
          style={styles.linkRow}
          accessibilityLabel={t('ui.acceptedOffer.getAnUberThereA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.link}>{t('ui.acceptedOffer.getAnUberThere')}</Text>
        </TouchableOpacity>
      )}
      {onViewRequest && (
        <TouchableOpacity
          onPress={onViewRequest}
          style={styles.linkRow}
          accessibilityLabel={t('ui.acceptedOffer.viewYourBusinessRequestA11y')}
          accessibilityRole="button"
        >
          <Text style={styles.link}>{t('ui.acceptedOffer.viewRequest')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const getStyles = (colors, bordered) => StyleSheet.create({
  container: bordered
    ? { backgroundColor: colors.primaryMuted, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary, padding: spacing.md }
    : { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  kicker: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: 2 },
  venue: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  desc: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  linkRow: { marginTop: spacing.xs },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
