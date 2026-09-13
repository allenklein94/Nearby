import {
  guessOccasionTypeFromEventTitle,
  formatCalendarEventDateLabel,
  isRealCalendarEvent,
  filterUpcomingCalendarSuggestions,
  nearestCalendarHint,
} from './calendarOccasionSuggestion';

describe('guessOccasionTypeFromEventTitle', () => {
  it('matches real keywords case-insensitively', () => {
    expect(guessOccasionTypeFromEventTitle("Sarah's Birthday")).toBe('birthday');
    expect(guessOccasionTypeFromEventTitle('OUR ANNIVERSARY DINNER')).toBe('anniversary');
    expect(guessOccasionTypeFromEventTitle("John's Graduation Party")).toBe('graduation');
  });

  it('falls back to other (Custom Occasion) for anything ambiguous, never guessing wrong', () => {
    expect(guessOccasionTypeFromEventTitle('Dad visiting')).toBe('other');
    expect(guessOccasionTypeFromEventTitle('Dentist appointment')).toBe('other');
    expect(guessOccasionTypeFromEventTitle('')).toBe('other');
    expect(guessOccasionTypeFromEventTitle(null)).toBe('other');
  });
});

describe('formatCalendarEventDateLabel', () => {
  it('formats a real date as a short label', () => {
    const label = formatCalendarEventDateLabel(new Date('2026-09-19T00:00:00'));
    expect(label).toMatch(/Sep 19/);
  });

  it('returns an empty string for a missing/invalid date', () => {
    expect(formatCalendarEventDateLabel(null)).toBe('');
    expect(formatCalendarEventDateLabel('not a date')).toBe('');
  });
});

describe('isRealCalendarEvent', () => {
  it('rejects events with no real title', () => {
    expect(isRealCalendarEvent({ id: '1', title: '', startDate: new Date() })).toBe(false);
    expect(isRealCalendarEvent({ id: '1', title: '   ', startDate: new Date() })).toBe(false);
    expect(isRealCalendarEvent({ id: '1', startDate: new Date() })).toBe(false);
    expect(isRealCalendarEvent(null)).toBe(false);
  });

  it('accepts a real titled event with a start date', () => {
    expect(isRealCalendarEvent({ id: '1', title: "Mom's Birthday", startDate: new Date() })).toBe(true);
  });
});

describe('filterUpcomingCalendarSuggestions', () => {
  const events = [
    { id: 'a', title: 'Later Event', startDate: '2026-10-01' },
    { id: 'b', title: 'Sooner Event', startDate: '2026-09-20' },
    { id: 'c', title: '', startDate: '2026-09-21' },
    { id: 'd', title: 'Already Handled', startDate: '2026-09-22' },
  ];

  it('sorts soonest first and drops blank-titled and dismissed events', () => {
    const result = filterUpcomingCalendarSuggestions(events, new Set(['d']));
    expect(result.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('never mutates the input array', () => {
    const copy = [...events];
    filterUpcomingCalendarSuggestions(events, new Set());
    expect(events).toEqual(copy);
  });
});

describe('nearestCalendarHint', () => {
  const now = new Date('2026-09-15T12:00:00');

  it('returns the soonest event within the window', () => {
    const events = [
      { id: 'a', title: 'Too Far', startDate: '2026-10-01' },
      { id: 'b', title: 'Just Right', startDate: '2026-09-17' },
    ];
    expect(nearestCalendarHint(events, 5, now)?.id).toBe('b');
  });

  it('returns null when nothing real is within the window', () => {
    const events = [{ id: 'a', title: 'Too Far', startDate: '2026-10-01' }];
    expect(nearestCalendarHint(events, 5, now)).toBeNull();
  });

  it('returns null for an empty or missing list', () => {
    expect(nearestCalendarHint([], 5, now)).toBeNull();
    expect(nearestCalendarHint(undefined, 5, now)).toBeNull();
  });
});
