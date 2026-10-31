// Offer safety (20270372, gap 2): the shared test vectors for the ONE contact rule, private.offer_contact_kind (SQL). The
// edge function asks the same function (public.offer_contact_info_kind), so there is no second copy of the rule to test:
// journey `offerSafety` runs every vector below through the database. A new false positive or bypass found in testing is
// added here first.
// [text, expected kind]
const CONTACT = [
  ['Book at https://coastal.example', 'url'],
  ['See www.coastalcoffee.com for the menu', 'url'],
  ['Order on coastalcoffee.com tonight', 'url'],
  ['Find us at coastal-coffee.co', 'url'],
  ['coastalcoffee dot com', 'url'],
  ['coastalcoffee (dot) com', 'url'],
  ['WWW . coastal [dot] net', 'url'],
  ['Email hello@coastal.example', 'email'],
  ['Write to hello (at) coastal', 'email'],
  ['hello[at]coastalcoffee', 'email'],
  ['message coastalcoffee at gmail', 'email'],
  ['Call 561-555-0142 to confirm', 'phone'],
  ['Text (561) 555 0142', 'phone'],
  ['+1 561 555 0142', 'phone'],
  ['5615550142', 'phone'],
  ['5 6 1 5 5 5 0 1 4 2', 'phone'],
  ['call 555-0142', 'phone'],
  ['five six one five five five zero one four two', 'phone'],
];
const CLEAN = [
  'We can seat your party of 8 at 7:30 PM.',
  'Free dessert for the birthday guest, 10% off drinks.',
  'Minimum spend $25 per person. Deposit $50, refundable up to 24 hours before.',
  'Available 6:00-8:00 PM, Friday 2026-11-06.',
  'Tables for 2, 4, 6, 8 or 10 people.',
  'Ask for Maria at the counter.',
  'Meet at the front desk, e.g. near the window.',
  'Includes coffee, pastry and a 1.5 hour tasting.',
  'Prices from $1,250 for groups of 20-40.',
  'Open 9am-5pm, closed Mondays.',
  'We are at 1234 Main St, unit 5.',
  'Come in, tell us it is your anniversary and we will do the rest.',
];
module.exports = { CONTACT, CLEAN };
