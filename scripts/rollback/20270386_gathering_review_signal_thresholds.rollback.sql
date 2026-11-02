-- Rollback for migration 20270386: the three gathering detectors back OFF (20270385's state). Existing signals and cases kept.
update private.gathering_signal_settings set
  surge_min_joiners = null, surge_window_minutes = null, surge_new_share = null,
  cancel_min_count = null, cancel_window_days = null, cancel_max_age_hours = null,
  large_min_capacity = null, large_min_attendees = null, large_repeat_quiet_days = null, updated_at = now()
where id;
update private.behavior_signal_settings
   set case_alone_kinds = array(select k from unnest(case_alone_kinds) k
                                 where k not in ('attendee_surge_new', 'create_cancel', 'large_public_gathering')),
       updated_at = now()
 where id;
