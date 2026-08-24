import { supabase } from './supabase';

// Client wiring for the Resy/OpenTable reservation-provider scaffolding
// (see CLAUDE.md, Aug 24 2026 -- 20260824_reservation_provider_scaffolding.sql).
// Genuinely inert for real bookings today -- there is no real outbound
// Resy/OpenTable integration built yet, so this only ever records what the
// business owner tells us; accept_business_offer() still always creates an
// immediately-confirmed provider='nearby' reservation regardless of what's
// set here. See the migration's own header comment for the full reasoning.

// Real reservation-provider status for the caller's own managed business --
// a plain, already-fetched set of columns on brand_partners, not a live
// external API call, so this is cheap enough to call on every Business
// Dashboard load (matches getMyStripeConnectStatus's own shape exactly).
export async function getMyReservationProviderStatus() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('managed_partner_id')
    .eq('id', userId)
    .single();
  if (!profile?.managed_partner_id) return null;

  const { data: partner } = await supabase
    .from('brand_partners')
    .select('id, reservation_provider, reservation_provider_venue_id, reservation_provider_connected_at')
    .eq('id', profile.managed_partner_id)
    .single();
  if (!partner) return null;

  return {
    partnerId: partner.id,
    provider: partner.reservation_provider,
    venueId: partner.reservation_provider_venue_id,
    connectedAt: partner.reservation_provider_connected_at,
  };
}

// provider: 'resy' | 'opentable' | null (null disconnects and clears the
// venue id, matching the RPC's own "clearing the provider clears its venue
// id too" behavior).
export async function updateReservationProvider(partnerId, provider, venueId = null) {
  const { error } = await supabase.rpc('update_business_reservation_provider', {
    partner_id_param: partnerId,
    provider_param: provider,
    venue_id_param: venueId,
  });
  if (error) throw new Error(error.message);
}
