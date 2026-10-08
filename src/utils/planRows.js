// One gathering, one row, one role (owner item 24, 2026-10-04): a plan list never shows the same gathering twice. When a
// gathering reaches a list through more than one relationship, the strongest one is its role: hosting > going > maybe
// (Interested), and for past ones hosted > attended. The host is never an attendee row (capacity convention), so this
// only guards against drift; it never adds or removes a plan.
// Item 39: the ranking is the ONE canonical relation order (objectState GATHERING_RELATION_RANK); Plans' row statuses are
// only display names for relation x time.
import { GATHERING_RELATION_RANK } from './objectState';

export const PLAN_STATUS_RELATION = { hosting: 'hosting', hosted: 'hosting', going: 'attending', attended: 'attending', maybe: 'interested' };
const rankOf = (status) => GATHERING_RELATION_RANK[PLAN_STATUS_RELATION[status]] ?? 0;

export function mergePlanRows(rows) {
  const byId = new Map();
  const order = [];
  for (const row of rows ?? []) {
    const id = row?.gathering?.id;
    if (!id) { order.push(row); continue; }
    const prev = byId.get(id);
    if (!prev) { byId.set(id, row); order.push(id); continue; }
    if (rankOf(row.status) > rankOf(prev.status)) byId.set(id, row);
  }
  return order.map((k) => (typeof k === 'string' || typeof k === 'number' ? byId.get(k) : k));
}
