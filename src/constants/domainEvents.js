// Item 125: the ONE canonical domain-event registry. A domain action (server RPC/trigger) emits exactly one of these;
// the server's notification layer (_dispatch_domain_event) decides who, if anyone, is notified. Screens never send or
// decide notifications. Kept equal to the domain_events.type CHECK by domainEvents.test.js. Add an event here and in
// the CHECK together, and only when a real domain action needs it (owner decision: no event platform, no mutation-
// per-event). BUSINESS_REQUEST_VIEWED is deliberately absent (item 39).
export const DOMAIN_EVENTS = [
  'GATHERING_CREATED',
  'INVITATION_SENT',
  'INVITATION_ACCEPTED',
  'INVITATION_EXPIRED',
  'BUSINESS_REQUEST_SENT',
  'BUSINESS_OFFER_SENT',
  'BUSINESS_OFFER_ACCEPTED',
  'OFFER_REDEEMED',
];

// Recorded for analysis, never notified (owner decision 4, item 125). A future notification for one of these is a
// product decision made after real usage data, not a side effect of the event existing.
export const RECORD_ONLY_EVENTS = ['INVITATION_ACCEPTED', 'INVITATION_EXPIRED', 'OFFER_REDEEMED'];
