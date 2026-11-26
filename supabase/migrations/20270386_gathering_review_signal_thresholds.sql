-- Gathering review signals: the owner's APPROVED starting numbers (2026-11-02, provisional: no real usage to calibrate on),
-- activating 20270385's detectors. Deploy only after 20270385 (and 20270363/20270365, whose case rules these feed), with its
-- own approval. Signals stay advisory: nothing here refuses, delays, hides, cancels, restricts or notifies anyone.
--   attendee surge        >= 15 distinct uninvited joiners of one gathering / series within 60 min (host + re-joins excluded);
--                         opens a case alone only when >= half of them are New accounts, otherwise corroboration only.
--   create-then-cancel    >= 3 cancellations within 7 days, each before its start and within 48 h of creation, counting only
--                         gatherings someone else had joined or been invited to; opens a case alone.
--   large public          capacity >= 50 or approved attendance (host excluded) >= 25, once per gathering / series; opens a
--                         case alone, except that after a large-gathering case closed 'no_action' within 90 days later
--                         size-only signals do nothing on their own (with a different signal they still count).
do $$
begin
  if to_regclass('private.gathering_signal_settings') is null then
    raise exception '20270386 needs 20270385 (gathering review signals) first';
  end if;
  if not exists (select 1 from private.behavior_signal_settings where id and review_cases_enabled) then
    raise exception '20270386 needs review cases switched on (20270365) first';
  end if;
end $$;

update private.gathering_signal_settings set
  surge_min_joiners = 15, surge_window_minutes = 60, surge_new_share = 0.5,
  cancel_min_count = 3, cancel_window_days = 7, cancel_max_age_hours = 48,
  large_min_capacity = 50, large_min_attendees = 25, large_repeat_quiet_days = 90,
  updated_at = now()
where id;

update private.behavior_signal_settings set
  -- appended (existing order kept, so the rollback restores the list exactly)
  case_alone_kinds = case_alone_kinds || array(select k from unnest(array['attendee_surge_new', 'create_cancel',
                       'large_public_gathering']) k where k <> all(case_alone_kinds)),
  updated_at = now()
where id;
