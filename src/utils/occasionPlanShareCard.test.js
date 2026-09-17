import { buildOccasionPlanShareCaption } from './occasionPlanShareCard';

describe('buildOccasionPlanShareCaption', () => {
  it('composes the full caption when every field is real', () => {
    const caption = buildOccasionPlanShareCaption({
      title: "Sarah's Birthday 🎂",
      dateLabel: 'Sat, Sep 19',
      timeLabel: '7:30 PM',
      location: "Luigi's Restaurant",
      partySize: 10,
    });
    expect(caption).toBe(
      "Sarah's Birthday 🎂\nSat, Sep 19 · 7:30 PM\n📍 Luigi's Restaurant\n👥 10 going\nPlanned with Nearby"
    );
  });

  it('falls back to a generic title when none is given', () => {
    expect(buildOccasionPlanShareCaption({})).toBe('Our Plan\nPlanned with Nearby');
  });

  it('omits a date/time line entirely when neither is set', () => {
    const caption = buildOccasionPlanShareCaption({ title: 'Dinner', location: 'The Bistro' });
    expect(caption).toBe('Dinner\n📍 The Bistro\nPlanned with Nearby');
  });

  it('shows just the date when time is unknown', () => {
    const caption = buildOccasionPlanShareCaption({ title: 'Dinner', dateLabel: 'Sat, Sep 19' });
    expect(caption).toBe('Dinner\nSat, Sep 19\nPlanned with Nearby');
  });

  it('never fabricates a location or party size line when neither is real', () => {
    const caption = buildOccasionPlanShareCaption({ title: 'Dinner', dateLabel: 'Sat, Sep 19', timeLabel: '7 PM' });
    expect(caption).toBe('Dinner\nSat, Sep 19 · 7 PM\nPlanned with Nearby');
  });

  it('handles a real party size of zero honestly (not treated as falsy/missing)', () => {
    const caption = buildOccasionPlanShareCaption({ title: 'Dinner', partySize: 0 });
    expect(caption).toBe('Dinner\n👥 0 going\nPlanned with Nearby');
  });
});
