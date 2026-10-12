// A perk's redemption state for the viewer (owner, 2026-10-12): claiming creates a code; only the business's confirmation
// establishes a real visit. The ONE rule every perk surface reads (Discover's PerkRedemptionPanel and card, a community's
// perks, a business profile's perks), from the viewer's own offer_redemptions row (getMyRedemptionRows / getMyRedemptionFor):
//   available  -- no row: the Redeem button
//   claimed    -- a row the business has not confirmed: the "Your code" box, every time the perk is opened
//   confirmed  -- confirmed_at set by the business (confirm_offer_redemption): the "✓ Redeemed" badge
// "Redeemed" is never shown before the business confirms. No new status, string or screen.
export const PERK_REDEMPTION_STATES = Object.freeze(['available', 'claimed', 'confirmed']);

export function perkRedemptionState(row) {
  if (!row) return 'available';
  return row.confirmed_at ? 'confirmed' : 'claimed';
}

// offer_id -> the viewer's row ({ offer_id, confirmation_code, confirmed_at }); rows without an offer id are ignored.
export function redemptionsByOffer(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) if (r?.offer_id) out[r.offer_id] = r;
  return out;
}

// What the code box says: the staff line (naming the business when its name is known), then the business's own
// instructions only when it wrote some. Reuses existing localized strings; never a fallback that points nowhere.
export function perkCodeMessage(t, { code, businessName = null, instructions = null } = {}) {
  if (!code) return null;
  const name = typeof businessName === 'string' && businessName.trim() ? businessName.trim() : null;
  const staff = name
    ? t('ui.businessProfile.showStaffAtThisCode', { name, confirmationCode: code })
    : t('ui.brandOffersUi.showStaffCode', { code, instructions: '' }).trim();
  const extra = typeof instructions === 'string' && instructions.trim() ? instructions.trim() : null;
  return [staff, extra].filter(Boolean).join('\n\n');
}
