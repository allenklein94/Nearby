import { supabase } from './supabase';

// Points are just a live count of the caller's own confirmed visits (redemptions the business confirmed) —
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
  // Owner (2026-10-12): confirmed visits only. A claimed code is not proof a visit happened; the claim counts the moment
  // the business confirms it (confirmed_at), exactly as billing counts it.
  const { count, error } = await supabase
    .from('offer_redemptions')
    .select('id', { count: 'exact', head: true })
    .not('confirmed_at', 'is', null);

  // A failed count is unknown, never 0 redemptions (global rule 7): the Perks tier line then shows nothing.
  if (error) {
    console.error('getMyRewardStatus error', error);
    return null;
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
