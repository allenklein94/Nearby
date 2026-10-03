-- Item 156 follow-up: one learning-evidence row per person per request. A request's accept and its confirmed redemption are
-- ONE piece of evidence (20270273 confirms the accept row in place, else adds one redeem row); this makes that a rule of the
-- table, so no path (a race, a future writer) can ever give one transaction two rows. Prod had 0 rows when applied.
create unique index if not exists behavior_events_one_evidence_per_request
  on public.behavior_events (user_id, entity_id)
  where event_type in ('accept', 'redeem');
