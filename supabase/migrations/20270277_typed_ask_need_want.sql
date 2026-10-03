-- Item 162 (2026-10-03): the typed-ask audit records whether the ask resolved as a NEED or a WANT (ask_kind, a closed
-- token 'need' | 'want'), so the live run can measure the distinction. Only the recordable-field list changes; the writer
-- (record_typed_ask_snapshot) already drops unknown keys and any non-token string.
create or replace function public._typed_ask_interpretation_fields()
returns text[] language sql immutable as $$
  select array['intent', 'category', 'category_group', 'preferred_category', 'date_tag', 'cuisine', 'occasion', 'combination',
    'multi_part', 'date_window', 'when_preset', 'party_size', 'party_size_stated', 'party_type', 'price_level', 'budget_max',
    'attributes', 'energies', 'formats', 'skill_levels', 'genres', 'intensity', 'effort', 'social_context', 'meet_new_people',
    'distance_willingness', 'search_widened', 'transport_mode', 'time_budget_minutes', 'clock_window', 'date_anchor',
    'commitment', 'spontaneity', 'open_now', 'open_now_chip', 'environment', 'environment_required', 'exclude', 'avoid_pricey',
    'open_ended_groups', 'vibes_avoid', 'narrow_group', 'ask_kind']::text[]
$$;
revoke all on function public._typed_ask_interpretation_fields() from public, anon, authenticated;
