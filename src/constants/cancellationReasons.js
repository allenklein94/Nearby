// Cancellation reason analytics: one curated vocabulary, mirrored by the CHECK constraint / set_cancellation_reason in
// 20261213_cancellation_events.sql. The reason is always optional (asked AFTER the cancel succeeds, never gating it).
export const CANCELLATION_REASONS = {
  changed_plans: 'Plans changed',
  scheduling_conflict: 'Scheduling conflict',
  found_another_option: 'Found another option',
  cost: 'Cost or budget',
  group_fell_through: 'The group fell through',
  too_busy: 'Too busy',
  unable_to_fulfil: "Can't fulfil it",
  closed_or_unavailable: 'Closed or unavailable that day',
  other: 'Something else',
};

// Who is cancelling decides which reasons make sense to offer.
export const CANCELLATION_REASONS_BY_ROLE = {
  requester: ['changed_plans', 'scheduling_conflict', 'found_another_option', 'cost', 'group_fell_through', 'other'],
  host: ['changed_plans', 'scheduling_conflict', 'group_fell_through', 'cost', 'other'],
  business: ['too_busy', 'unable_to_fulfil', 'closed_or_unavailable', 'other'],
};

export const CANCELLATION_ACTOR_LABELS = { business: 'You cancelled', requester: 'Customer cancelled', host: 'Host cancelled' };
