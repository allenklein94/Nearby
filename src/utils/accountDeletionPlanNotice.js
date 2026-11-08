// What the final account-deletion confirmation says about group plans the person organizes (20270405; owner, 2026-11-08, Option 1).
// The server decides: this only reads `account_deletion_plan_impact`. Nothing readable = no extra line, and delete-account still refuses what it must.
export const DELETION_PLAN_HINT = 'group_plan_booking_unresolved';

// 'unresolved' = a booking must be refunded or its visit confirmed first; 'ends_plans' = deleting cancels their plans; null = nothing to say.
export function deletionPlanNotice(impact) {
  if (!impact) return null;
  if (Number(impact.unresolved) > 0) return 'unresolved';
  return Number(impact.plans) > 0 ? 'ends_plans' : null;
}

export function isDeletionPlanRefusal(error) {
  return error?.hint === DELETION_PLAN_HINT;
}
