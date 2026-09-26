// Booking mode (owner item 72, 2026-09-26): how a customer comes in, owner-declared on the business (brand_partners.booking_mode,
// set_business_booking_mode). NULL = not said: no CTA change, no ranking effect, never guessed from the category.
// The CTA each mode leads to is decided in utils/primaryAction.js businessPrimaryAction (one place), never per screen.
export const BOOKING_MODE_OPTIONS = [
  { key: 'walk_in', label: 'Walk-in', icon: '🚶', customerLine: 'Walk-ins welcome', cta: 'Go now' },
  { key: 'reservation_recommended', label: 'Reservation recommended', icon: '📅', customerLine: 'Reservation recommended', cta: 'Reserve' },
  { key: 'reservation_required', label: 'Reservation required', icon: '📅', customerLine: 'Reservation required', cta: 'Book' },
  { key: 'request_required', label: 'Request required', icon: '✉️', customerLine: 'By request', cta: 'Request' },
];
export const BOOKING_MODE_KEYS = BOOKING_MODE_OPTIONS.map((o) => o.key);

// The pre-item-72 attribute that said the same thing. 0 live rows used it; it stays in the shared attribute vocabulary for stored
// data only, is not offered in the owner's attribute picker any more, and is read here ONLY when no booking mode was declared.
export const LEGACY_RESERVATION_ATTRIBUTE = 'reservation_required';

export function bookingModeOf(partner) {
  const declared = partner?.booking_mode ?? partner?.bookingMode ?? null;
  if (BOOKING_MODE_KEYS.includes(declared)) return declared;
  return Array.isArray(partner?.attributes) && partner.attributes.includes(LEGACY_RESERVATION_ATTRIBUTE) ? 'reservation_required' : null;
}

export function bookingModeOption(mode) {
  return BOOKING_MODE_OPTIONS.find((o) => o.key === mode) ?? null;
}

// Modes where "open" does not mean you can use it right now: you need a booking or a reply first.
export const NEEDS_BOOKING_FIRST = ['reservation_required', 'request_required'];

// Commitment (constants/commitmentLevel.js) from a declared mode: walk-in = drop in, a required booking or request = reservation.
// A recommended reservation claims nothing (walk-ins still work).
export const BOOKING_MODE_COMMITMENT = { walk_in: 'drop_in', reservation_required: 'reservation', request_required: 'reservation' };
