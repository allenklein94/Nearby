import { supabase } from './supabase';

// Points are just a live count of the caller's own real redemptions —
// no ledger table, no invented weighting. Deliberately not folded together
// with gathering attendance, which is Momentum's signal (see momentum.js) —
// keeping this scoped to perks avoids two features reading the same rows
// into two different numbers.
const TIERS = [
  { name: 'Bronze', min: 5, emoji: '🥉' },
  { name: 'Silver', min: 15, emoji: '🥈' },
  { name: 'Gold', min: 30, emoji: '🥇' },
];

export async function getMyRewardStatus() {
  // RLS already scopes offer_redemptions SELECT to the caller's own rows,
  // same pattern getMyRedemptions() in brandOffers.js relies on — no
  // explicit user_id filter needed.
  const { count, error } = await supabase
    .from('offer_redemptions')
    .select('id', { count: 'exact', head: true });

  if (error) {
    console.error('getMyRewardStatus error', error);
    return { points: 0, tier: null, nextTier: null, pointsToNextTier: null, allTiers: TIERS };
  }

  const points = count ?? 0;
  const tier = [...TIERS].reverse().find((t) => points >= t.min) ?? null;
  const nextTier = TIERS.find((t) => points < t.min) ?? null;

  return {
    points,
    tier,
    nextTier,
    pointsToNextTier: nextTier ? nextTier.min - points : null,
    allTiers: TIERS,
  };
}
