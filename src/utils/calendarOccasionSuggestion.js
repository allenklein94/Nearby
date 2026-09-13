// Item 75 (CLAUDE.md): "Connect occasions to the user's calendar." Pure,
// dependency-free logic only -- no expo-calendar, no AsyncStorage, no I/O
// -- same split as intentResolverScoring.js/occasionPackageFormatting.js
// so this stays directly unit-testable under the plain-node Jest
// environment (jest.config.js's own header comment). src/services/
// deviceCalendar.js (the async orchestrator that actually talks to the
// device calendar + AsyncStorage) imports and uses everything here.

// Best-effort, honestly-labeled title -> occasion_type guess, same shape
// as businessAttributeExtraction.js's extractAttributesFromText: real
// keywords only, never a fabricated guess dressed up as certainty. Always
// shown back to the user as an editable, confirmable chip (this repo's
// own "AI suggests, never silently commits" rule) -- wrong guesses are
// cheap to fix, never silently wrong. Falls back to 'other' (Custom
// Occasion, Item 74) rather than a made-up specific type when nothing
// matches -- Item 74's own free-text Describe step handles genuinely
// ambiguous cases (e.g. "Dad's visiting") exactly as well as a picked
// occasion type would.
const KEYWORDS_BY_OCCASION = {
  birthday: ['birthday', 'bday', "b-day"],
  anniversary: ['anniversary'],
  wedding: ['wedding'],
  engagement: ['engagement party', 'engaged'],
  graduation: ['graduation', 'grad party', 'commencement'],
  baby_shower: ['baby shower'],
  housewarming: ['housewarming', 'house warming'],
  retirement: ['retirement party', 'retiring'],
  reunion: ['reunion'],
  promotion: ['promotion'],
  new_job: ['new job', 'first day'],
  farewell: ['farewell', 'going away party', 'goodbye party'],
  moving: ['moving day', 'move-in', 'housewarming'],
  welcome: ['welcome party', 'welcome home'],
  holiday_gathering: ['thanksgiving', 'christmas', 'holiday party', "new year's eve", 'new years eve'],
};

export function guessOccasionTypeFromEventTitle(title) {
  const lower = (title ?? '').toLowerCase();
  if (!lower.trim()) return 'other';
  for (const [occasionType, keywords] of Object.entries(KEYWORDS_BY_OCCASION)) {
    if (keywords.some((kw) => lower.includes(kw))) return occasionType;
  }
  return 'other';
}

// Same "Sat, Sep 19" short-date shape formatRequestWhen() already
// established (businessRequestWhen.js) -- one consistent date-label
// vocabulary across the app rather than a second copy.
export function formatCalendarEventDateLabel(startDate) {
  if (!startDate) return '';
  const d = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Real events only: a raw device-calendar read can include stray rows with
// no real title (some calendar providers insert blank placeholder blocks)
// -- never surface those as a suggestion. Does not otherwise second-guess
// which calendars the user already explicitly chose to share; that
// consent is the real filter, not a second guess about "is this event
// interesting."
export function isRealCalendarEvent(event) {
  return !!(event && typeof event.title === 'string' && event.title.trim().length > 0 && event.startDate);
}

// Excludes anything already handled (saved as an Occasion, or explicitly
// dismissed) via a real on-device id set -- both actions add to the same
// dismissed-id set, so nothing already acted on can nag the user again.
// Sorted soonest-first; never mutates the input array.
export function filterUpcomingCalendarSuggestions(events, dismissedIds = new Set()) {
  return (events ?? [])
    .filter(isRealCalendarEvent)
    .filter((e) => !dismissedIds.has(e.id))
    .slice()
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
}

// The single nearest real upcoming event within `withinDays`, or null --
// used as a lightweight, best-effort context signal for Home's ask-box
// placeholder and Surprise Me (never a gate, never required for either to
// function normally without it).
export function nearestCalendarHint(events, withinDays = 5, now = new Date()) {
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const upcoming = (events ?? [])
    .filter(isRealCalendarEvent)
    .filter((e) => {
      const start = new Date(e.startDate);
      return start.getTime() >= now.getTime() - 24 * 60 * 60 * 1000 && start.getTime() <= cutoff.getTime();
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  return upcoming[0] ?? null;
}
