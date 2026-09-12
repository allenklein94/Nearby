// Item 68 ("Businesses could create occasion-specific offers," CLAUDE.md) --
// a business's own durable, named occasion package (e.g. a restaurant's
// "Birthday Package": dessert + a group table, minimum 6 guests, available
// Fri/Sat, $X/person). See the migration this is built on,
// 20261028_business_occasion_packages.sql, for the full architecture
// rationale -- a genuinely different concept from a one-time posted
// business_availability slot or a flat priority_occasions appetite signal.
import { supabase } from './supabase';

// Pure display helpers live in a separate, dependency-free module so they
// stay directly unit-testable (see that file's own header comment) --
// re-exported here so every existing call site can keep importing them
// from this service file.
export { formatAvailableDaysLabel, formatIncludedItemsLabel, formatOccasionPackageDetail } from '../utils/occasionPackageFormatting';

// ---------- business-side management ----------

export async function getMyOccasionPackages() {
  const { data, error } = await supabase.rpc('get_my_occasion_packages');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createOccasionPackage({
  occasionType, name, description = null, includedItems = [], minGuests = null, pricePerPerson = null, availableDays = null,
}) {
  const { data, error } = await supabase.rpc('create_occasion_package', {
    occasion_type_param: occasionType,
    name_param: name,
    description_param: description,
    included_items_param: includedItems,
    min_guests_param: minGuests,
    price_per_person_param: pricePerPerson,
    available_days_param: availableDays,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateOccasionPackage(packageId, {
  occasionType, name, description = null, includedItems = [], minGuests = null, pricePerPerson = null, availableDays = null,
}) {
  const { data, error } = await supabase.rpc('update_occasion_package', {
    package_id_param: packageId,
    occasion_type_param: occasionType,
    name_param: name,
    description_param: description,
    included_items_param: includedItems,
    min_guests_param: minGuests,
    price_per_person_param: pricePerPerson,
    available_days_param: availableDays,
  });
  if (error) throw new Error(error.message);
  return data;
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

export async function searchOccasionPackages({ occasionType, latitude = null, longitude = null, partySize = null, radiusMiles = 25 } = {}) {
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
