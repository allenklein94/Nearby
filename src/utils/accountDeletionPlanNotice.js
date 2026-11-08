// What the final account-deletion confirmation adds (20270405; owner, 2026-11-08). The server decides: this only reads `account_deletion_plan_impact`.
// Nothing readable = no extra line. A deletion is never refused for these: the plans end and a refund is owed by the business.
export function deletionPlanNotice(impact) {
  return {
    endsPlans: Number(impact?.plans) > 0,
    paidBooking: Number(impact?.paid) > 0,
  };
}
