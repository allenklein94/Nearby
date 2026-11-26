// Reporter feedback loop (owner, 2026-11-07; migration 20270397). The ONE rule turning the server's
// get_my_report_updates() rows into Activity's "Earlier" rows: one row per report, its state = 'completed' once the
// review is done (dated then), else 'received' (dated when filed). Ids + times only: no outcome, reason, reported
// account or evidence ever reaches the client.
export const REPORT_UPDATE_TITLE_KEYS = {
  received: 'ui.activity.reportReceived',
  completed: 'ui.activity.reviewCompleted',
};

export function reportUpdateItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.report_id && r.received_at)
    .map((r) => {
      const state = r.completed_at ? 'completed' : 'received';
      return {
        type: 'report_update',
        key: `report-${r.report_id}`,
        timestamp: state === 'completed' ? r.completed_at : r.received_at,
        raw: { state, titleKey: REPORT_UPDATE_TITLE_KEYS[state] },
      };
    });
}
