// Item 121 ("Business offer acceptance should feel equally tangible"): pure, dependency-free
// helpers behind the achievement card's Add to Calendar / Get Directions actions -- kept separate
// from the screen itself (same "pure function file, directly unit-testable, no react-native
// import" split as occasionPackageFormatting.js/businessRequestWhen.js already establish) and
// from planAddonReadiness.js, which already carries the raw date/time/geo fields these consume.

const DEFAULT_EVENT_DURATION_MINUTES = 120; // A dinner/activity reservation has no real known
// end time anywhere in this schema -- 2 hours is a disclosed, reasonable default, never presented
// as a fact the business itself confirmed.

// Builds the event payload for expo-calendar's createEventInCalendarAsync -- the native OS
// compose UI the USER themselves reviews and saves, never a silent background write (see
// CLAUDE.md's own locked "Calendar = when, Nearby = what+who+where+how" boundary: this is a
// single, user-confirmed EXPORT of one already-real confirmed commitment, not Nearby becoming a
// calendar-management surface). Returns null when there's no real date to export at all. When no
// real time is known, builds an honest all-day event instead of fabricating a specific hour.
export function buildPlanCalendarEvent({ title, rawDate, rawTime, businessAddress, location, durationMinutes = DEFAULT_EVENT_DURATION_MINUTES }) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const [year, month, day] = rawDate.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const eventTitle = title || 'Your Plan';
  const eventLocation = businessAddress || location || undefined;

  if (rawTime && typeof rawTime === 'string') {
    const [h, m] = rawTime.split(':').map(Number);
    if (Number.isInteger(h) && Number.isInteger(m)) {
      const startDate = new Date(year, month - 1, day, h, m);
      if (!Number.isNaN(startDate.getTime())) {
        return {
          title: eventTitle,
          startDate,
          endDate: new Date(startDate.getTime() + durationMinutes * 60000),
          allDay: false,
          location: eventLocation,
        };
      }
    }
  }

  const dateOnly = new Date(year, month - 1, day);
  if (Number.isNaN(dateOnly.getTime())) return null;
  return { title: eventTitle, startDate: dateOnly, endDate: dateOnly, allDay: true, location: eventLocation };
}

// A real turn-by-turn directions link (not just a centered pin) -- prefers real coordinates,
// falls back to the business's own real street address, returns null when neither is known
// (never a fabricated destination).
export function buildDirectionsUrl({ latitude, longitude, address }) {
  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  return null;
}
