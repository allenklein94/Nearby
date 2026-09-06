// "Business Profile Phase 1" addendum. Unit tests for
// businessAttributeExtraction.js's one pure function (the "Teach Nearby"
// parser).
const { extractAttributesFromText } = require('./businessAttributeExtraction');

describe('extractAttributesFromText', () => {
  it('returns an empty array for empty/missing text', () => {
    expect(extractAttributesFromText('')).toEqual([]);
    expect(extractAttributesFromText(undefined)).toEqual([]);
    expect(extractAttributesFromText('   ')).toEqual([]);
  });

  it('returns an empty array when no real keyword matches', () => {
    expect(extractAttributesFromText('We sell widgets.')).toEqual([]);
  });

  it('extracts a single real attribute from a matching sentence', () => {
    expect(extractAttributesFromText('Our rooftop patio is our most popular feature.')).toEqual(['outdoor_seating']);
  });

  it('extracts multiple real attributes from one sentence, never a fabricated one', () => {
    const result = extractAttributesFromText("We're especially good for first dates, and our rooftop patio is popular.");
    expect(result).toEqual(expect.arrayContaining(['date_friendly', 'outdoor_seating']));
    expect(result).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    expect(extractAttributesFromText('COZY AND ROMANTIC ATMOSPHERE')).toContain('date_friendly');
  });

  it('never extracts an attribute whose keyword genuinely is not present', () => {
    const result = extractAttributesFromText('Great for a quiet, casual evening.');
    expect(result).toEqual(expect.arrayContaining(['quiet', 'casual']));
    expect(result).not.toContain('live_music');
    expect(result).not.toContain('kid_friendly');
  });

  it('extracts the intent engine vision layer-3 semantic/hobby tags', () => {
    expect(extractAttributesFromText('We pour specialty coffee and have fast wifi.')).toEqual(
      expect.arrayContaining(['specialty_coffee', 'laptop_friendly'])
    );
    expect(extractAttributesFromText('Dogs welcome on our lakeside patio.')).toEqual(
      expect.arrayContaining(['dog_friendly', 'waterfront', 'outdoor_seating'])
    );
    expect(extractAttributesFromText('Weekly board game night, open late.')).toEqual(
      expect.arrayContaining(['board_game_friendly', 'late_night'])
    );
    expect(extractAttributesFromText('A cozy bookstore with a reading nook.')).toContain('book_lovers');
  });
});
