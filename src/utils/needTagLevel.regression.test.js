// Owner items 175-181 (2026-10-03, LOCKED): needs move from whole groups to individually approved service TAGS in the
// item-168 migration. These cases must give the same answer before and after that change: the ask resolves to its final
// canonical TAG first, and the need check reads that tag, never only the parent group. Runs the real deterministic
// resolver (no AI) and the real classifier input the intent resolver receives (toClassification(...).category).
import { resolveAsk, toClassification } from './askResolver';
import { askKind } from './needAsk';

const classify = (text) => toClassification(resolveAsk(text, null));

describe('need decisions survive the group -> per-tag need migration', () => {
  it.each([
    ['I need a tire changed today', 'Tires'],
    ['I need to get a tire changed today', 'Tires'],
    ['I need an oil change', 'Oil Change'],
    ['I need a plumber', 'Plumbing'],
    ['I need a haircut', 'Barbers'],
    ['I need CPR certification', 'Certifications'],
    ['I need to get CPR certified', 'Certifications'],
    // Item 184: the three need-capable Business & Networking categories, with task framing
    ['I need a coworking space', 'Coworking'],
    ['I need help with my finances', 'Finance'],
  ])('"%s" resolves to %s and is a NEED', (text, tag) => {
    const c = classify(text);
    expect(c.category).toBe(tag);
    expect(askKind({ category: c.category, rawText: text })).toBe('need');
  });

  it.each([
    ["what's fun tonight"],
    ["my car won't start"],
    ['car wash near me'],
    ['plumbers near me'],
    ['my AC is broken'],
    // Item 182: Education & Classes is per-tag already; a class is something people choose to do, so "need" alone
    // never makes it a need (an intentional change from the old group-level NEED).
    ['find a cooking class'],
    ['I need a cooking class'],
    ['I need dance classes'],
    // Item 184: Business & Networking is per-tag; events never inherit NEED from the parent group
    ['find a networking event tonight'],
    ['looking for a conference'],
    ['I need to find a networking event'],
    ['find a career event'],
    ['entrepreneurship meetup this week'],
    // ...and the three service categories still need task framing
    ['coworking near me'],
    ['real estate'],
  ])('"%s" is a WANT', (text) => {
    const c = classify(text);
    expect(askKind({ category: c.category, rawText: text })).toBe('want');
  });

  // Item 182 (owner, LOCKED): ambiguous words stay unmapped, never guessed.
  it.each([['business class'], ['training']])('"%s" maps to no category', (text) => {
    expect(classify(text).category).toBeNull();
  });

  // Land with the item-168 migration (their wording does not resolve yet, so they cannot pass today).
  it.todo('"I need a tow truck" resolves to Towing and is a NEED (wording: tow truck)');
  it.todo('"fix my AC" resolves to HVAC and is a NEED (wording: ac)');
  it.todo('"I need a dog walker" resolves to Dog Walking and is a NEED (wording: dog walker)');
  it.todo('"I need pet sitting" resolves to Pet Sitting and is a NEED (new category)');
  it.todo('"I need to get pet food" resolves to Pet Stores and is a NEED (wording: pet food)');
  it.todo('"I need a hotel tonight" resolves to Hotels and is a NEED after stay_getaway leaves the need groups');
  it.todo('"dog parks", "pet events", "family resorts", "harbor cruises", "campsite tonight" stay WANTS after the change');
  // Item 182 (owner, LOCKED): only Tutoring and Certifications are need-capable in Education & Classes.
  // Item 184 wordings (land with the item-168 migration)
  it.todo('"I need an accountant" resolves to Finance and is a NEED (wording: accountant)');
  it.todo('"I need a realtor" resolves to Real Estate and is a NEED (wording: realtor)');
  it.todo('"seminar", "trade show", "career fair", "co-working" resolve to Professional Events + Lectures / Professional Events / Career Events / Coworking');
  it.todo('"I need a tutor for my son" resolves to Tutoring and is a NEED (wording: tutor, lands with the other item-182 wordings)');
});

// Item 184 (owner, LOCKED): only the resolved tag decides; the bare Business & Networking group is never a need.
describe('Business & Networking needs are per tag', () => {
  const { isNeedCategory } = require('../constants/gatheringCategories');
  it('only Coworking, Finance and Real Estate are need-capable; the group key and every event tag are not', () => {
    expect(['Coworking', 'Finance', 'Real Estate'].every(isNeedCategory)).toBe(true);
    expect(['business_networking', 'Networking', 'Conferences', 'Professional Events', 'Entrepreneurship', 'Career Events'].some(isNeedCategory)).toBe(false);
  });
});
