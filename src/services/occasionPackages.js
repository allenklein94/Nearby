// Item 68 ("Businesses could create occasion-specific offers," CLAUDE.md) --
// a business's own durable, named occasion package (e.g. a restaurant's
// "Birthday Package": dessert + a group table, minimum 6 guests, available
// Fri/Sat, $X/person). See the migration this is built on,
// 20261028_business_occasion_packages.sql, for the full architecture
// rationale -- a genuinely different concept from a one-time posted
// business_availability slot or a flat priority_occasions appetite signal.
import { supabase, functionUrl } from './supabase';
import { serviceError } from '../utils/recoverableError';
import { getUserLocation } from './userLocation';

// Pure display helpers live in a separate, dependency-free module so they
// stay directly unit-testable (see that file's own header comment) --
// re-exported here so every existing call site can keep importing them
// from this service file.
export { formatAvailableDaysLabel, formatIncludedItemsLabel, formatOccasionPackageDetail, findMatchingOccasionPackage } from '../utils/occasionPackageFormatting';

// ---------- business-side management ----------

export async function getMyOccasionPackages() {
  const { data, error } = await supabase.rpc('get_my_occasion_packages');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Offer safety (20270372): a package becomes an automatic offer to matching requests, so it is saved only through the same
// content check as an offer reply (screen-business-content, target 'package'). Low risk = saved at once ({ published }),
// high = refused ({ blocked }), anything else = held for the team ({ published: false, blocked: false }); a held package
// appears once a reviewer approves it. The database refuses a package write that didn't go through this check.
async function submitOccasionPackageForScreening(partnerId, packageId, {
  occasionType, name, description = null, includedItems = [], minGuests = null, pricePerPerson = null, availableDays = null,
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('You need to be signed in to do that.');
  const response = await fetch(functionUrl('screen-business-content'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      partnerId, targetType: 'package', packageId: packageId ?? null,
      occasionType, name, description, includedItems, minGuests, pricePerPerson, availableDays,
    }),
  });
  const result = await response.json();
  if (!response.ok && !result?.riskTier) throw serviceError(response, result, 'Could not save this package right now.'); // carries item 86's conflicts
  return result;
}

export async function createOccasionPackage(partnerId, params) {
  return submitOccasionPackageForScreening(partnerId, null, params);
}

export async function updateOccasionPackage(partnerId, packageId, params) {
  return submitOccasionPackageForScreening(partnerId, packageId, params);
}

export async function setOccasionPackageActive(packageId, active) {
  const { error } = await supabase.rpc('set_occasion_package_active', {
    package_id_param: packageId,
    active_param: active,
  });
  if (error) throw new Error(error.message);
}

export async function deleteOccasionPackage(packageId) {
  const { error } = await supabase.rpc('delete_occasion_package', { package_id_param: packageId });
  if (error) throw new Error(error.message);
}

// ---------- consumer-side search (used by the intent resolver) ----------

export async function searchOccasionPackages({ occasionType, latitude: lat = null, longitude: lng = null, partySize = null, radiusMiles = 25 } = {}) {
  // No coordinates would search anywhere: fall back to the shared position (passive, never prompts).
  let latitude = lat;
  let longitude = lng;
  if (lat == null || lng == null) {
    const l = await getUserLocation({ ask: false });
    latitude = l ? l.coords.latitude : null;
    longitude = l ? l.coords.longitude : null;
  }
  if (!occasionType) return [];
  const { data, error } = await supabase.rpc('search_occasion_packages', {
    occasion_type_param: occasionType,
    latitude_param: latitude,
    longitude_param: longitude,
    party_size_param: partySize,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- returning-customer recall (Item 102, CLAUDE.md, "Businesses
// can participate in recurring occasions") ----------
//
// A business's own real "this customer celebrated here last year" list --
// see 20261123_business_recurring_occasion_recall.sql for the full
// consent/privacy design. Owner-scoped (managed_partner_id), and only ever
// includes a real customer who explicitly opted in (Item 101's own recall
// card, occasions.recall_shareable_with_business) AND has a real accepted/
// completed business_request_offers history with THIS specific business.

export async function getBusinessReturningOccasionCustomers(partnerId) {
  const { data, error } = await supabase.rpc('get_business_returning_occasion_customers', {
    partner_id_param: partnerId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// A real, rate-limited (once per occurrence, server-enforced) "Welcome
// back" push to a real, consented returning customer -- optionally naming
// one of the business's own already-built Occasion Packages rather than
// inventing new offer content.
export async function sendBusinessRecallOutreach(occasionId, partnerId, packageId = null) {
  const { error } = await supabase.rpc('send_business_recall_outreach', {
    occasion_id_param: occasionId,
    partner_id_param: partnerId,
    package_id_param: packageId,
  });
  if (error) throw new Error(error.message);
}
