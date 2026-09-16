// Item 68 ("Businesses could create occasion-specific offers," CLAUDE.md) --
// pure display helpers for a business's own occasion packages, split out
// from services/occasionPackages.js (which also imports supabase, an
// I/O-touching module this codebase's own test setup deliberately excludes
// -- see jest.config.js's own header comment) so these are directly
// unit-testable, same reasoning intentResolverScoring.js's own header
// comment gives for its identical split from intentResolver.js.
//
// This file intentionally mirrors businessFulfillment.js's own
// DAY_OF_WEEK_OPTIONS labels (0=Sunday..6=Saturday, matching Postgres's own
// extract(dow from date) convention, business_occasion_packages.available_days'
// own real CHECK-constrained shape) rather than importing it -- importing
// that file here would pull in its react-native/expo-location/
// expo-image-picker dependencies, breaking this file's pure-node
// testability. Keep both lists in sync if either ever changes.
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// available_days null (or empty) means "every day" (same convention
// business_fulfillment_policies.active_days already established) -- an
// honest omission, not "closed every day." A real, explicit subset always
// renders in Sunday-through-Saturday order, never re-sorted to the input
// array's own order.
export function formatAvailableDaysLabel(availableDays) {
  if (!Array.isArray(availableDays) || availableDays.length === 0) return null;
  const labels = DAY_LABELS
    .map((label, key) => (availableDays.includes(key) ? label : null))
    .filter(Boolean);
  return labels.length > 0 ? labels.join('/') : null;
}

export function formatIncludedItemsLabel(includedItems) {
  if (!Array.isArray(includedItems) || includedItems.length === 0) return null;
  return includedItems.join(', ');
}

// A real, honest one-line detail string for a package card --
// "$45/person · min 6 guests · Fri/Sat" -- omitting whatever the business
// genuinely didn't set, never fabricating a placeholder for it.
export function formatOccasionPackageDetail({ pricePerPerson, minGuests, availableDays }) {
  const parts = [];
  if (pricePerPerson != null) parts.push(`$${pricePerPerson}/person`);
  if (minGuests != null) parts.push(`min ${minGuests} guests`);
  const daysLabel = formatAvailableDaysLabel(availableDays);
  if (daysLabel) parts.push(daysLabel);
  return parts.join(' · ') || null;
}

// Item 92 ("Businesses should be able to respond specifically to the
// occasion", CLAUDE.md) -- when a business is about to manually respond
// to a specific open request, this finds the one real, already-active
// Occasion Package (Item 68) that genuinely fits it (same occasion, and
// the request's own real party size clears the package's real min_guests
// floor, when either is set) -- a real, one-tap starting point ("use my
// own already-built package") instead of a blank title/checklist. Never
// invents a match: a null occasion, or no package that actually fits,
// returns null. When more than one package could fit, prefers the most
// specific real one -- the highest min_guests the party size still
// genuinely clears -- over an arbitrary array-order pick.
export function findMatchingOccasionPackage({ occasion = null, partySize = null, packages = [] } = {}) {
  if (!occasion) return null;
  const candidates = packages.filter(
    (pkg) =>
      pkg.active !== false &&
      pkg.occasion_type === occasion &&
      (pkg.min_guests == null || partySize == null || partySize >= pkg.min_guests)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, pkg) => ((pkg.min_guests ?? 0) > (best.min_guests ?? 0) ? pkg : best));
}
