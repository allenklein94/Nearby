// Business-owner notification groups as the dashboard shows them (item 143: they live in the ONE store,
// profiles.notification_mutes, as owner_requests / owner_offers / owner_reservations / owner_demand, applied by _send_push;
// the type -> group table is NOTIFICATION_GROUP_BY_TYPE in notificationPreferences.js). This file only names them for the
// dashboard card; it holds no second mapping. Account notices to an applicant are in no group: they can't be muted.
import { NOTIFICATION_GROUP_BY_TYPE, OWNER_GROUPS } from './notificationPreferences';

export const BUSINESS_NOTIFICATION_GROUPS = [
  { key: 'requests', group: 'owner_requests', label: 'New requests', detail: 'A customer asks for something you could offer, a request is about to expire, or a customer cancels one.' },
  { key: 'offers', group: 'owner_offers', label: 'Your offers', detail: 'A customer accepts one of your offers, or our review of it finishes.' },
  { key: 'reservations', group: 'owner_reservations', label: 'Reservations', detail: 'A customer cancels a reservation with you.' },
  { key: 'demand', group: 'owner_demand', label: 'Demand signals', detail: 'Interest is growing in something near you.' },
];

// Derived view (short keys) of the owner part of the one table.
export const BUSINESS_NOTIFICATION_GROUP_BY_TYPE = Object.fromEntries(
  Object.entries(NOTIFICATION_GROUP_BY_TYPE)
    .filter(([, g]) => OWNER_GROUPS.includes(g))
    .map(([type, g]) => [type, g.slice('owner_'.length)]),
);
