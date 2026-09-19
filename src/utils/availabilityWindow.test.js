import { defaultScheduledWindow, resolveAvailabilityWindow, scheduledWindowProblem, shiftEndAfterStart, demandPreviewLine } from './availabilityWindow';

const now = new Date(2026, 8, 16, 14, 30); // Wed Sep 16 2026 2:30 PM local

describe('windows', () => {
  it('defaults to the next full hour for two hours', () => {
    const { start, end } = defaultScheduledWindow(now);
    expect(start.getHours()).toBe(15);
    expect(start.getMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(2 * 3600 * 1000);
  });
  it('now mode = now + duration', () => {
    const w = resolveAvailabilityWindow({ mode: 'now', durationHours: 2, now });
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(2 * 3600 * 1000);
  });
  it('scheduled mode uses the picked times, null until both are picked', () => {
    const start = new Date(2026, 8, 18, 18, 0);
    const end = new Date(2026, 8, 18, 20, 0);
    expect(resolveAvailabilityWindow({ mode: 'scheduled', start, end }).startsAt).toEqual(start);
    expect(resolveAvailabilityWindow({ mode: 'scheduled', start, end: null })).toBeNull();
  });
  it('rejects a backwards or already-passed window', () => {
    const start = new Date(2026, 8, 18, 18, 0);
    expect(scheduledWindowProblem({ start, end: new Date(2026, 8, 18, 17, 0), now })).toMatch(/after the start/);
    expect(scheduledWindowProblem({ start: new Date(2026, 8, 1, 18), end: new Date(2026, 8, 1, 20), now })).toMatch(/already passed/);
    expect(scheduledWindowProblem({ start, end: new Date(2026, 8, 18, 20, 0), now })).toBeNull();
  });
  it('moving the start past the end pushes the end out', () => {
    const newStart = new Date(2026, 8, 18, 21, 0);
    expect(shiftEndAfterStart(newStart, new Date(2026, 8, 18, 20, 0)).getTime()).toBe(newStart.getTime() + 2 * 3600 * 1000);
    expect(shiftEndAfterStart(new Date(2026, 8, 18, 18), new Date(2026, 8, 18, 20)).getHours()).toBe(20);
  });
});

describe('demandPreviewLine', () => {
  const friday = new Date(2026, 8, 18, 18, 0);
  it('names the count, category and weekday', () => {
    expect(demandPreviewLine({ people: 7, category: 'Dinner', startsAt: friday, now })).toBe('✨ 7 people nearby are looking for dinner Friday.');
  });
  it('says today / tomorrow', () => {
    expect(demandPreviewLine({ people: 5, category: 'Coffee', startsAt: now, now })).toMatch(/coffee today\.$/);
    expect(demandPreviewLine({ people: 5, category: 'Coffee', startsAt: new Date(2026, 8, 17, 9), now })).toMatch(/coffee tomorrow\.$/);
  });
  it('shows nothing without a real count (withheld below the floor, not fetched, zero)', () => {
    expect(demandPreviewLine({ people: null, category: 'Dinner', startsAt: friday, now })).toBeNull();
    expect(demandPreviewLine({ people: undefined, startsAt: friday, now })).toBeNull();
    expect(demandPreviewLine({ people: 0, startsAt: friday, now })).toBeNull();
  });
});
