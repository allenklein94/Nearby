-- Behaviour review signals: the owner's APPROVED numbers (2026-10-30), activating 20270363's detectors. Deploy only after
-- 20270363 (+ the report-presence redeploy for location jumps) and 20270364, with its own approval. Signals stay advisory:
-- nothing here bans, suspends, hides, restricts or limits anyone; an admin decides on each case.
--   repeated messages   the same / near-identical (>= 0.8) text of >= 20 characters to >= 5 distinct recipients in 60 min
--   join burst          >= 15 distinct gatherings joined in 60 min (never capped)
--   location switching  >= 3 distinct far-apart areas among REJECTED location reports in 60 min
--   several limits      >= 3 different rate limits reached in 60 min
--   review cases        on; repeated messages or several limits alone open one; a join burst or location switching only
--                       with a second, different signal within 24 h; at most 20 new behaviour cases a day, overflow counted
--                       and kept waiting for an admin (never silently dropped).
update private.behavior_signal_settings set
  repeat_msg_min_recipients = 5, repeat_msg_window_minutes = 60, repeat_msg_min_chars = 20, repeat_msg_min_similarity = 0.8,
  join_burst_min_gatherings = 15, join_burst_window_minutes = 60,
  location_min_cells = 3, location_window_minutes = 60,
  limit_burst_min_actions = 3, limit_burst_window_minutes = 60,
  review_cases_enabled = true, case_min_signal_kinds = 2, case_window_hours = 24,
  case_alone_kinds = array['repeated_messages', 'limit_burst'], max_new_cases_per_day = 20,
  updated_at = now()
where id;
