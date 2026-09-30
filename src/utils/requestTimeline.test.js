const fs = require('fs');
const path = require('path');
const { requestTimeline, timelineStepLine, requestNextStep, justSentLine } = require('./requestTimeline');

const req = { created_at: '2026-09-20T18:42:00Z' };

describe('requestTimeline', () => {
  it('a fresh request has only "Request sent"', () => {
    const t = requestTimeline(req, []);
    expect(t.map((s) => s.key)).toEqual(['sent']);
  });
  it('a real offer adds "<Business> made you an offer" with its own detail', () => {
    const t = requestTimeline(req, [{ status: 'offered', responded_at: '2026-09-20T19:03:00Z', discount_pct: 25, brand_partners: { name: 'Coastal Coffee' } }]);
    expect(t.map((s) => s.key)).toEqual(['sent', 'offer_received']);
    expect(t[1].label).toBe('Coastal Coffee made you an offer');
    expect(t[1].detail).toBe('25% off');
  });
  it("accepted adds You're booked; declined/pending offers add nothing", () => {
    expect(requestTimeline(req, [{ status: 'pending' }, { status: 'declined' }]).map((s) => s.key)).toEqual(['sent']);
    const t = requestTimeline(req, [{ status: 'accepted', responded_at: '2026-09-20T19:03:00Z', accepted_at: '2026-09-20T19:15:00Z', offer_price: 30, price_is_per_person: true }]);
    expect(t.map((s) => s.key)).toEqual(['sent', 'offer_received', 'accepted']);
    expect(t[1].detail).toBe('$30.00/person');
    expect(t[2].label).toBe("You're booked");
  });
  it('several offers are counted, not itemized; a missing time is dropped, never invented', () => {
    const t = requestTimeline(req, [{ status: 'offered' }, { status: 'offered' }]);
    expect(t[1].label).toBe('2 businesses responded');
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

// Item 122: the reply is named by its kind, and a Next line persists while the request is actionable.
describe('request progress by reply kind + Next line', () => {
  const NOW = new Date('2026-09-20T20:00:00Z');
  const open = { status: 'open', created_at: '2026-09-20T18:42:00Z', expires_at: '2026-09-21T02:00:00Z' };
  const name = { brand_partners: { name: 'Coastal Coffee' } };
  const availability = { ...name, status: 'offered', offer_type: 'standard', responded_at: '2026-09-20T19:03:00Z' };
  const alternative = { ...name, status: 'offered', offer_type: 'alt_time', proposed_time: '2026-09-21T01:00:00Z' };
  const offer = { ...name, status: 'offered', offer_type: 'standard', offer_title: '2 coffees + 2 pastries', offer_price: 12 };
  it('each reply type is named truthfully; availability is never an offer', () => {
    const a = requestTimeline(open, [availability])[1];
    expect(a.label).toBe('Coastal Coffee can take you');
    expect(a.detail).toBeNull();
    expect(a.label).not.toMatch(/offer/i);
    expect(requestTimeline(open, [alternative])[1].label).toBe('Coastal Coffee suggested another time');
    const o = requestTimeline(open, [offer])[1];
    expect(o.label).toBe('Coastal Coffee made you an offer');
    expect(o.detail).toBe('$12.00');
  });
  it('several replies are counted as businesses, whatever their kinds', () => {
    expect(requestTimeline(open, [availability, alternative, offer])[1].label).toBe('3 businesses responded');
  });
  it('booked: the last step is "You\'re booked" and there is no Next line', () => {
    const booked = { ...open, status: 'fulfilled' };
    const offers = [{ ...availability, status: 'accepted', accepted_at: '2026-09-20T19:10:00Z' }];
    const t = requestTimeline(booked, offers);
    expect(t[t.length - 1].label).toBe("You're booked");
    expect(t[1].label).toBe('Coastal Coffee can take you');
    expect(requestNextStep(booked, offers, NOW)).toBeNull();
  });
  it('open with no replies: we will let you know', () => {
    expect(requestNextStep(open, [], NOW)).toBe("We'll let you know when a business responds.");
    expect(requestNextStep(open, [{ status: 'pending' }, { status: 'declined' }], NOW)).toBe("We'll let you know when a business responds.");
    // an offer past its own valid_until is not a live reply
    expect(requestNextStep(open, [{ ...offer, valid_until: '2026-09-20T19:30:00Z' }], NOW)).toBe("We'll let you know when a business responds.");
  });
  it('open with replies: pick one (with the group on a group-plan request)', () => {
    expect(requestNextStep(open, [availability], NOW)).toBe('Pick one to book it.');
    expect(requestNextStep(open, [offer, alternative], NOW)).toBe('Pick one to book it.');
    expect(requestNextStep({ ...open, group_plan_id: 'g1' }, [offer], NOW)).toBe('Pick one to confirm with your group.');
  });
  it('expired / cancelled / merged: no Next line (the header or banner says it), including a request past its own deadline', () => {
    for (const status of ['expired', 'cancelled', 'merged']) expect(requestNextStep({ ...open, status }, [offer], NOW)).toBeNull();
    expect(requestNextStep({ ...open, expires_at: '2026-09-20T19:00:00Z' }, [offer], NOW)).toBeNull();
  });
  it('just sent: "You\'ll be notified when they respond", never "as offers come in"', () => {
    expect(justSentLine(4)).toBe("We asked 4 nearby businesses. You'll be notified when they respond.");
    expect(justSentLine(1)).toBe("We asked 1 nearby business. You'll be notified when they respond.");
    expect(justSentLine(0)).toBeNull();
    // the screen's wording lives in the requestDetail ui namespace (localization pass 5); read both
    const screen = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8') + JSON.stringify(require('../i18n/ui/requestDetail').default.en);
    expect(screen).not.toMatch(/as offers come in/);
    expect(screen).toMatch(/justSentLine\(notifiedCount, targetPartnerName\)/);
    expect(screen).toMatch(/requestNextStep\(request, offers\)/);
    // the no-business and duplicate lines and the wider-radius action are unchanged
    expect(screen).toMatch(/We couldn't find a nearby business to ask within/);
    expect(screen).toMatch(/Try a Wider Radius/);
  });
  it('the progress list decides reply kinds only through offerCopy (no second classifier)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'requestTimeline.js'), 'utf8');
    expect(src).toMatch(/from '.\/offerCopy'/);
    expect(src).not.toMatch(/Offer received|Offer accepted|offers received/);
    expect(src).not.toMatch(/offer_type === /);
  });
});
