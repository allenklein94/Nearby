const fs = require('fs');
const path = require('path');
const { requestTimeline, timelineStepLine } = require('./requestTimeline');

const req = { created_at: '2026-09-20T18:42:00Z' };

describe('requestTimeline', () => {
  it('a fresh request has only "Request sent"', () => {
    const t = requestTimeline(req, []);
    expect(t.map((s) => s.key)).toEqual(['sent']);
  });
  it('an offered offer adds Offer received with its own detail', () => {
    const t = requestTimeline(req, [{ status: 'offered', responded_at: '2026-09-20T19:03:00Z', discount_pct: 25 }]);
    expect(t.map((s) => s.key)).toEqual(['sent', 'offer_received']);
    expect(t[1].label).toBe('Offer received');
    expect(t[1].detail).toBe('25% off');
  });
  it('accepted adds Offer accepted; declined/pending offers add nothing', () => {
    expect(requestTimeline(req, [{ status: 'pending' }, { status: 'declined' }]).map((s) => s.key)).toEqual(['sent']);
    const t = requestTimeline(req, [{ status: 'accepted', responded_at: '2026-09-20T19:03:00Z', accepted_at: '2026-09-20T19:15:00Z', offer_price: 30, price_is_per_person: true }]);
    expect(t.map((s) => s.key)).toEqual(['sent', 'offer_received', 'accepted']);
    expect(t[1].detail).toBe('$30.00/person');
  });
  it('several offers are counted, not itemized; a missing time is dropped, never invented', () => {
    const t = requestTimeline(req, [{ status: 'offered' }, { status: 'offered' }]);
    expect(t[1].label).toBe('2 offers received');
    expect(t[1].detail).toBeNull();
    expect(t[1].at).toBeNull();
    expect(timelineStepLine(t[1])).toBeNull();
  });
  it('has no viewed step and the screen/digest use no consumer-facing viewed state', () => {
    const src = fs.readFileSync(path.join(__dirname, 'requestTimeline.js'), 'utf8');
    expect(src).not.toMatch(/viewed_at|'viewed'/);
    const digest = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270151_digest_business_side_timestamp.sql'), 'utf8');
    expect(digest.split('\n').filter((l) => !l.startsWith('--')).join('\n')).not.toMatch(/viewed_at/);
  });
});
