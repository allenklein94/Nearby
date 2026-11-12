// 20270415: when a business note goes through Nearby's content check (mirrors the database wrappers), and that the two
// services route a note through screen-business-content and never send it straight to the database.
const fs = require('fs');
const path = require('path');
const { pulseNoteNeedsScreening, declineNoteNeedsScreening, cleanNote } = require('./businessNoteScreening');

describe('business note screening rule', () => {
  test('availability note: only a new or changed non-empty note', () => {
    expect(pulseNoteNeedsScreening('Back at 3', null)).toBe(true);
    expect(pulseNoteNeedsScreening('Back at 4', 'Back at 3')).toBe(true);
    expect(pulseNoteNeedsScreening('  Back at 3 ', 'Back at 3')).toBe(false); // same note, status tap
    expect(pulseNoteNeedsScreening('', 'Back at 3')).toBe(false); // clearing
    expect(pulseNoteNeedsScreening(null, null)).toBe(false);
    expect(pulseNoteNeedsScreening('   ', null)).toBe(false);
  });
  test('decline note: only a non-empty note with the reason Other', () => {
    expect(declineNoteNeedsScreening('other', 'Closed for a private event')).toBe(true);
    expect(declineNoteNeedsScreening('other', '  ')).toBe(false);
    expect(declineNoteNeedsScreening('too_far', 'anything')).toBe(false); // never stored for other reasons
    expect(declineNoteNeedsScreening('other', null)).toBe(false);
  });
  test('cleanNote trims; empty = none', () => {
    expect(cleanNote('  hi ')).toBe('hi');
    expect(cleanNote('')).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});

describe('services route notes through the content check', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const body = (src, name) => src.slice(src.indexOf(`export async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`export async function ${name}(`)));
  test('setBusinessAvailabilityPulse: a note needing the check never reaches the RPC first', () => {
    const fn = body(read('services/brandOffers.js'), 'setBusinessAvailabilityPulse');
    expect(fn.indexOf('pulseNoteNeedsScreening')).toBeGreaterThan(-1);
    expect(fn.indexOf("targetType: 'availability_note'")).toBeLessThan(fn.indexOf("rpc('set_business_availability_pulse'"));
  });
  test('declineBusinessOpportunity: a note needing the check goes to screen-business-content', () => {
    const fn = body(read('services/businessFulfillment.js'), 'declineBusinessOpportunity');
    expect(fn.indexOf("targetType: 'decline_note'")).toBeGreaterThan(-1);
    expect(fn.indexOf("targetType: 'decline_note'")).toBeLessThan(fn.indexOf("rpc('decline_business_offer'"));
    expect(fn).toMatch(/note_param: reason === 'other' \? cleanNote\(note\) : null/);
  });
  test('the edge function knows both target types', () => {
    const ts = fs.readFileSync(path.join(__dirname, '../../supabase/functions/screen-business-content/index.ts'), 'utf8');
    expect(ts).toMatch(/'availability_note', 'decline_note'\]/);
    expect(ts).toMatch(/rpc\('set_business_availability_pulse'/);
    expect(ts).toMatch(/rpc\('decline_business_offer'/);
  });
});
