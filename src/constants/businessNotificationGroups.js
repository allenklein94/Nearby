// Business-owner notification groups: what an owner can mute, in the words an owner uses. MUST stay identical to the
// BUSINESS_NOTIFICATION_GROUP_BY_TYPE map in supabase/functions/send-push/index.ts (a Deno copy; Jest reads that file
// and asserts equality) and to the group list in set_my_business_notification_group
// (20261209_business_notification_prefs.sql). Account events (business_partner_approved, business_partnership_response)
// are deliberately in no group: they can't be muted.
export const BUSINESS_NOTIFICATION_GROUPS = [
  { key: 'requests', label: 'New requests', detail: 'A customer asks for something you could offer, or cancels a request.' },
  { key: 'offers', label: 'Offer responses', detail: 'A customer accepts, declines or withdraws one of your offers.' },
  { key: 'reservations', label: 'Reservations', detail: 'A reservation is confirmed or cancelled.' },
  { key: 'demand', label: 'Demand signals', detail: 'Interest is growing in something near you.' },
];

export const BUSINESS_NOTIFICATION_GROUP_BY_TYPE = {
  business_opportunity_received: 'requests',
  business_opportunities_digest: 'requests',
  business_request_cancelled: 'requests',
  business_offer_accepted: 'offers',
  business_offer_declined: 'offers',
  business_offer_review_result: 'offers',
  business_offer_withdrawn: 'offers',
  business_reservation_confirmed: 'reservations',
  business_reservation_cancelled: 'reservations',
  reservation_cancelled_by_customer: 'reservations',
  aggregated_demand_growing: 'demand',
  occasion_demand_growing: 'demand',
};
