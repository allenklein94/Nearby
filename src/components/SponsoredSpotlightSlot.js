import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import SponsoredCard from './SponsoredCard';
import { getSponsoredSpotlight, recordSponsoredTap, hideSponsoredPartner, reportSponsoredPlacement } from '../services/sponsored';

// The one sponsored slot on Perks/Places browse (item 44). It is a separate card above the organic list: it never
// reorders, replaces or counts as an organic row. Renders nothing unless the server returns a servable placement
// (fail closed: an error, no location, the switch off, hidden, capped or out of range all render nothing).
export default function SponsoredSpotlightSlot({ userLocation, categoryGroup, categoryLabel, navigation }) {
  const [card, setCard] = useState(null);
  const lat = userLocation?.latitude;
  const lng = userLocation?.longitude;

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
    getSponsoredSpotlight({ latitude: lat, longitude: lng, categoryGroup: categoryGroup || null })
      .then((c) => { if (!cancelled) setCard(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lat, lng, categoryGroup]);

  if (!card) return null;
  return (
    <SponsoredCard
      card={card}
      categoryLabel={categoryLabel}
      onView={() => {
        recordSponsoredTap(card.placement_id).catch(() => {});
        if (card.item_kind === 'offer') navigation.navigate('BrandOffers', { highlightOfferId: card.item_id });
        else navigation.navigate('BusinessProfile', { partnerId: card.partner_id });
      }}
      onHide={async () => {
        if (await hideSponsoredPartner(card.partner_id)) setCard(null);
        else Alert.alert('Could not hide this sponsor', 'Please try again.');
      }}
      onReport={async () => {
        const ok = await reportSponsoredPlacement(card);
        Alert.alert(ok ? 'Thanks for reporting' : 'Could not send the report', ok ? 'We will review this ad.' : 'Please try again.');
      }}
    />
  );
}
