-- Rollback for migration 20270365: everything back OFF (20270363's state). Existing signals and cases are kept.
update private.behavior_signal_settings set
  repeat_msg_min_recipients = null, repeat_msg_window_minutes = null, repeat_msg_min_chars = null, repeat_msg_min_similarity = null,
  join_burst_min_gatherings = null, join_burst_window_minutes = null, location_min_cells = null, location_window_minutes = null,
  limit_burst_min_actions = null, limit_burst_window_minutes = null, review_cases_enabled = false, case_min_signal_kinds = null,
  case_window_hours = null, case_alone_kinds = '{}', max_new_cases_per_day = null, updated_at = now()
where id;
