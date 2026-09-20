// Sponsored placement (item 44, design: PRODUCT_AUDIT/SPONSORED_PLACEMENT_DESIGN_2026-09-20.md). The label lives HERE
// and in SponsoredCard as a constant, never in data, so a served paid placement cannot render without it.
export const SPONSORED_LABEL = 'Sponsored';

export function sponsoredWhyText(businessName, categoryLabel) {
  const who = businessName || 'This business';
  const what = categoryLabel ? `people browsing ${categoryLabel} near them` : 'people browsing nearby';
  return `${who} paid to be shown to ${what}. It isn't based on your activity.`;
}

// Organic-response language a paid placement must never use (guarded in sponsoredPlacementGuard.test.js).
export const ORGANIC_ONLY_PHRASES = [
  'made you an offer',
  'Our pick',
  'Why this matches',
  'Because you like',
  'Trending',
  'Nearby found',
  'is going',
  'are going',
];
