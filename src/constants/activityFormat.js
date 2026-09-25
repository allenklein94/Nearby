// Activity format (owner item 66, 2026-09-25): HOW an activity runs, a separate dimension from its category. A pickleball
// tournament and pickleball open play are both Pickleball (category) but very different experiences (format). One closed list,
// stored only as `gatherings.format` (host-declared, NULL = not said; migration 20270205). A result's format comes from REAL data:
// the host's declared format first, else its canonical tag when the tag itself names a format (Concerts, Workshops, Farmers
// Markets...; near-certain tags only, test-verified). Nothing else is guessed. The ask names a format by deterministic phrase rules
// on the person's own words (never AI). Ranking only: a fit lifts, a known different format sinks a little, never a filter.
export const ACTIVITY_FORMATS = [
  { key: 'drop_in', label: 'Drop-in', icon: '🚪', ask: /\bdrop[- ]in\b/i, commitment: 'drop_in' },
  { key: 'class', label: 'Class', icon: '🎓', ask: /\bclass(es)?\b|\blessons?\b/i, commitment: 'planned_event' },
  { key: 'tournament', label: 'Tournament', icon: '🏆', ask: /\btournaments?\b/i, commitment: 'planned_event' },
  { key: 'meetup', label: 'Meetup', icon: '👋', ask: /\bmeet[- ]?ups?\b/i, commitment: null },
  { key: 'concert', label: 'Concert', icon: '🎤', ask: /\bconcerts?\b|\bgigs?\b/i, commitment: 'planned_event' },
  // "show me..." is not a show: only "a/the/live/comedy... show" or the plural.
  { key: 'show', label: 'Show', icon: '🎭', ask: /\b(a|the|live|comedy|magic|drag|variety|talent)\s+shows?\b|\bshows\b/i, commitment: 'planned_event' },
  { key: 'festival', label: 'Festival', icon: '🎪', ask: /\bfestivals?\b|\bfests?\b/i, commitment: 'planned_event' },
  { key: 'tour', label: 'Tour', icon: '🧭', ask: /\btours?\b/i, commitment: 'planned_event' },
  { key: 'workshop', label: 'Workshop', icon: '🛠️', ask: /\bworkshops?\b/i, commitment: 'planned_event' },
  { key: 'appointment', label: 'Appointment', icon: '📅', ask: /\bappointments?\b/i, commitment: 'reservation' },
  { key: 'reservation', label: 'Reservation', icon: '🍽️', ask: /\breservations?\b|\bbook\s+a\s+table\b/i, commitment: 'reservation' },
  { key: 'open_play', label: 'Open play', icon: '🏓', ask: /\bopen\s+play\b|\bpick[- ]?up\s+games?\b/i, commitment: 'drop_in' },
  { key: 'competition', label: 'Competition', icon: '🥇', ask: /\bcompetitions?\b|\bcontests?\b/i, commitment: 'planned_event' },
  { key: 'exhibition', label: 'Exhibition', icon: '🖼️', ask: /\bexhibit(ion)?s?\b/i, commitment: 'easy' },
  { key: 'market', label: 'Market', icon: '🧺', ask: /\bmarkets?\b/i, commitment: 'easy' },
  // "a party of 6" is a headcount, not a party.
  { key: 'party', label: 'Party', icon: '🎉', ask: /\bpart(y|ies)\b(?!\s+of\b)/i, commitment: null },
];
export const ACTIVITY_FORMAT_KEYS = ACTIVITY_FORMATS.map((f) => f.key);

// Create/Edit chips: "Not specified" first, like every host-declared fact.
export const FORMAT_OPTIONS = [{ key: null, label: 'Not specified' }, ...ACTIVITY_FORMATS.map((f) => ({ key: f.key, label: `${f.icon} ${f.label}` }))];

export const formatLabel = (key) => ACTIVITY_FORMATS.find((f) => f.key === key)?.label ?? null;
export const formatIcon = (key) => ACTIVITY_FORMATS.find((f) => f.key === key)?.icon ?? null;

// Canonical tags that ARE a format by name. A tag not listed carries no format (Pickleball is a category, not a format).
export const TAG_FORMAT = {
  Concerts: 'concert', Festivals: 'festival', Workshops: 'workshop', Exhibits: 'exhibition',
  Classes: 'class', 'Art Classes': 'class', 'Cooking Class': 'class', 'Dance Classes': 'class', 'Language Classes': 'class', 'Technology Classes': 'class',
  'Farmers Markets': 'market', Markets: 'market', 'Tech Meetup': 'meetup', 'Boat Tours': 'tour',
};

// A candidate's format: declared first, else its tag's. `c` may carry { format, category }.
export function formatOf(c) {
  if (c?.format && ACTIVITY_FORMAT_KEYS.includes(c.format)) return c.format;
  return (c?.category && TAG_FORMAT[c.category]) || null;
}

// Format keys the person's own words name (empty when none).
export function formatsFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  return ACTIVITY_FORMATS.filter((f) => f.ask.test(text)).map((f) => f.key);
}

export const FORMAT_FIT_POINTS = 2;       // same weight as the other ask-specific bonuses
export const FORMAT_MISMATCH_POINTS = -1; // a known different format sinks a little; never hidden

export function formatFit(candidate, asked) {
  if (!Array.isArray(asked) || !asked.length) return { delta: 0, reason: null };
  const f = formatOf(candidate);
  if (!f) return { delta: 0, reason: null };
  if (asked.includes(f)) return { delta: FORMAT_FIT_POINTS, reason: `${formatIcon(f)} ${formatLabel(f)}` };
  return { delta: FORMAT_MISMATCH_POINTS, reason: null };
}

export function applyFormatToCandidates(candidates, asked) {
  if (!Array.isArray(asked) || !asked.length) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = formatFit(c, asked);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}
