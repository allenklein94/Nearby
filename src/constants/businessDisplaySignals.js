import { cuisineLabel, businessAttributeLabel } from './businessAttributes';

// P2 remediation item 8 (CLAUDE.md, "Discover information parity"): the
// business half of gatheringDisplaySignals.js's own real, honest,
// contextual signal line -- Discover's Perks section (getActiveOffers()/
// searchOffers(), both now selecting brand_partners.cuisine/attributes
// alongside name/logo_url/description) already fetches a partner's real
// cuisine/attributes and had never rendered either, even though the same
// fields are already exposed everywhere else a business is shown (the
// dashboard's own Business Profile card, BusinessProfileScreen). Capacity
// is deliberately not part of this line -- a standing perk (brand_offers)
// has no capacity concept the way a gathering or a live availability
// posting does; item 3's fullness work already covers gatherings, and
// there's nothing analogous to add here.
export function businessSignalLine(partner) {
  const parts = [];
  if (partner?.cuisine) {
    parts.push(cuisineLabel(partner.cuisine));
  }
  // Capped at 2 -- this renders on a single-line, numberOfLines={1} card
  // row (PlaceCard.js) alongside the business name and any "Matches your
  // interests" note, so every real attribute isn't dumped in regardless
  // of length; the two most relevant (first-set) attributes are enough to
  // give real texture without crowding out the rest of the line.
  (partner?.attributes ?? []).slice(0, 2).forEach((key) => {
    parts.push(businessAttributeLabel(key));
  });
  return parts.length > 0 ? parts.join(' · ') : null;
}
