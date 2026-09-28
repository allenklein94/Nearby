// Item 130 (owner, 2026-09-28): success is not "more categories", it is "does Nearby understand ordinary requests without
// making people navigate categories?" This is a fixed benchmark of everyday asks run through the ONE resolver with NO AI (the
// path that works today; the AI has never run live). Each row states only what the person clearly said, under the locked
// rules: time from words only, a date is 2 people, party size counts the person ("with 5 friends" = 6), missing stays missing.
// It is a regression suite written by us, NOT a measure of real consumers: the real rate comes from live typed asks
// (typed_ask_snapshots) once the live market runs. Add a row whenever a real ask is misunderstood, then fix the rule.
import { resolveAsk } from './askResolver';
import { planAsk } from './planAsk';

// expected: tag | parts (sorted plan part keys) | when | who | size | occasion | price | budget | pricey | cuisine
const C = [
 ["I want to grab dinner, maybe see some live music, nothing too expensive, tonight.", {parts:['activity','food'], when:'tonight', pricey:true}],
 ["I need a place for my daughter's birthday Saturday.", {occasion:'birthday', when:'weekend', who:'family'}],
 ["coffee tomorrow morning", {tag:'Coffee', when:'tomorrow'}],
 ["somewhere to watch the game tonight with friends", {when:'tonight', who:'friends'}],
 ["cheap tacos near me", {cuisine:'mexican', price:'$'}],
 ["dinner for 6 on Friday", {size:6}],
 ["a romantic dinner for my anniversary", {occasion:'anniversary'}],
 ["brunch with my mom this weekend", {when:'weekend', who:'family'}],
 ["something fun to do with the kids today", {when:'today', who:'family'}],
 ["drinks after work with coworkers", {who:'coworkers'}],
 ["happy hour tonight", {tag:'Happy Hour', when:'tonight'}],
 ["I want to play pickleball this weekend", {tag:'Pickleball', when:'weekend'}],
 ["yoga class tomorrow", {tag:'Yoga', when:'tomorrow'}],
 ["a quiet place to work with wifi", {}],
 ["date night ideas for tonight", {occasion:'date_night', when:'tonight'}],
 ["first date somewhere casual", {occasion:'first_date'}],
 ["dinner and a movie with my girlfriend tonight", {parts:['activity','food'], when:'tonight', who:'date'}],
 ["drinks and dancing tonight with the girls", {when:'tonight'}],
 ["team lunch for 12 people next week", {size:12}],
 ["sushi dinner under $40", {cuisine:'japanese', budget:40}],
 ["hike this morning", {tag:'Hiking'}],
 ["bowling with friends saturday night", {tag:'Bowling', who:'friends', when:'weekend'}],
 ["karaoke tonight", {tag:'Karaoke', when:'tonight'}],
 ["an italian restaurant for a birthday dinner for 8", {cuisine:'italian', occasion:'birthday', size:8}],
 ["meet new people tonight", {when:'tonight', who:'new_people'}],
 ["somewhere dog friendly for brunch", {}],
 ["live music tonight", {tag:'Live Music', when:'tonight'}],
 ["comedy show this weekend", {when:'weekend'}],
 ["get my nails done tomorrow", {when:'tomorrow'}],
 ["a spa day for me", {}],
 ["farmers market sunday", {when:'weekend'}],
 ["dinner and drinks with my wife tonight", {parts:['drinks','food'], when:'tonight', who:'date'}],
 ["graduation party for my son next saturday", {occasion:'graduation'}],
 ["baby shower venue for 20 guests", {occasion:'baby_shower', size:20}],
 ["pizza with the family tonight", {when:'tonight', who:'family'}],
 ["something to do tonight, not too far", {when:'tonight'}],
 ["beach day tomorrow", {when:'tomorrow'}],
 ["trivia night with friends", {who:'friends'}],
 ["a museum today", {tag:'Museums', when:'today'}],
 ["dinner, then dessert, tonight", {parts:['dessert','food'], when:'tonight'}],
 ["a nice dinner, special occasion", {price:'$$$'}],
 ["coffee with a friend", {tag:'Coffee'}],
 ["wine tasting saturday afternoon", {when:'weekend'}],
 ["escape room with 5 friends", {tag:'Escape Rooms', size:6}],
 ["mini golf and ice cream with the kids tomorrow", {parts:['activity','dessert'], when:'tomorrow', who:'family'}],
];

const understood = (text) => {
  const r = resolveAsk(text);
  return { tag: r.subcategory, parts: r.plan ? r.plan.parts.map((p) => p.key).sort() : null, when: r.time.dateWindow, who: r.group.partyType, size: r.group.partySize, occasion: r.occasion, price: r.budget.priceLevel, budget: r.budget.budgetMax, pricey: r.facets.pricey, cuisine: r.cuisine };
};

describe('ordinary asks are understood without categories (no AI)', () => {
  test.each(C)('%s', (text, expected) => {
    const got = understood(text);
    for (const k of Object.keys(expected)) expect([k, got[k]]).toEqual([k, expected[k]]);
  });

  test("the owner's two examples", () => {
    const a = resolveAsk('I want to grab dinner, maybe see some live music, nothing too expensive, tonight.');
    expect(a.plan.parts.map((p) => p.key)).toEqual(['food', 'activity']);
    expect(a.subcategory).toBeNull(); // a plan is never narrowed to one category
    expect(a.combination).toBeTruthy();
    const b = resolveAsk("I need a place for my daughter's birthday Saturday.");
    expect([b.occasion, b.group.partyType, b.time.dateWindow, b.combination]).toEqual(['birthday', 'family', 'weekend', 'birthday']);
    expect(b.group.partySize).toBeNull(); // "likely a group" is never turned into a number
  });
});

describe('a place or a setting is not a second part of the plan', () => {
  test.each([
    'dinner with the kids', 'family dinner tonight', 'brunch with my mom', "dinner for my daughter's birthday",
    'lunch with my family outdoors', 'dinner somewhere outside', 'dinner by the beach', 'dinner near the park',
    'dinner with my dog', 'coffee and a walk', 'a kid friendly restaurant', 'dinner at the brewery', 'romantic dinner',
  ])('%s', (text) => expect(planAsk(text)).toBeNull());

  test('a named thing to do is a part, a drink tag stays drinks', () => {
    expect(planAsk('dinner and live music').parts.map((p) => p.key)).toEqual(['food', 'activity']);
    expect(planAsk('drinks and dancing tonight').parts.map((p) => p.key)).toEqual(['drinks', 'activity']);
    expect(planAsk('mini golf and ice cream').parts.map((p) => p.key)).toEqual(['activity', 'dessert']);
  });
});

describe('how far / how they get there is not a thing to do', () => {
  test.each([
    'dinner with my kids tonight, walking distance', 'dinner within walking distance', "dinner tonight, I'm on my bike",
    "dinner tonight, I'm driving", 'dinner, a short drive away', 'lunch somewhere walkable',
  ])('%s', (text) => expect(planAsk(text)).toBeNull());
  test('a walk the person plans still counts', () => {
    expect(planAsk('dinner then a walk on the beach').parts.map((p) => p.key)).toEqual(['food', 'activity']);
  });
});
