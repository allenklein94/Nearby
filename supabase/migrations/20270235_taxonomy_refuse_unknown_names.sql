-- AI suggests, the canonical taxonomy governs (2026-09-27, owner item 98). Additive on 20270232-20270234.
--
-- The AI classifiers already drop any category that is not in the live list (create-assistant,
-- business-onboarding-assistant; _shared/categoryTags.ts), and only an admin can create a category. But 8 of the
-- registered category-name columns (gatherings / communities interest_tag, date_proposals.category, profiles interests
-- + notification filters, business_requests.shared_interests, ...) accepted ANY string, so the AI-side check was the only
-- guard. Now the one write-time trigger (_taxonomy_normalize_tags, attached to every registered column marked
-- normalize_on_write) also refuses a name that is not a category when it is NEWLY written: a scalar that changes, or an
-- array element that was not already there (rows that already carried a value keep it, the same rule as retired names).
-- Former names still map to the current name, case is normalized, retired names are unchanged. Checked before applying:
-- no such column holds a non-category value in production. Unregistered columns and the historical search logs are
-- not affected. Safe to rerun.

create or replace function public._taxonomy_normalize_tags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end;
  v_patch jsonb := '{}'::jsonb;
  v_col text;
  v_val jsonb;
  v_elem text;
  v_out text[];
  v_old_elems text[];
  v_id bigint;
  v_t record;
  i int;
begin
  for i in 0 .. TG_NARGS - 1 loop
    v_col := TG_ARGV[i];
    v_val := v_new -> v_col;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if TG_OP = 'UPDATE' and v_val = (v_old -> v_col) then continue; end if;
    if jsonb_typeof(v_val) = 'array' then
      v_old_elems := case when TG_OP = 'UPDATE' and jsonb_typeof(v_old -> v_col) = 'array'
                          then array(select jsonb_array_elements_text(v_old -> v_col)) else array[]::text[] end;
      v_out := array[]::text[];
      for v_elem in select jsonb_array_elements_text(v_val) loop
        v_id := _taxonomy_id_for_name(v_elem);
        if v_id is not null then
          select * into v_t from _taxonomy_live_target(v_id);
          if v_t.retired and not (v_elem = any (v_old_elems)) then
            raise exception '"%" has been retired and can no longer be chosen.', v_elem using hint = 'category_retired';
          end if;
          if not v_t.retired or not (v_elem = any (v_old_elems)) then v_elem := v_t.current_tag; end if;
        elsif not (v_elem = any (v_old_elems)) then
          raise exception '"%" is not a Nearby category. Pick one from the list.', v_elem using hint = 'category_unknown';
        end if;
        if not (v_elem = any (v_out)) then v_out := v_out || v_elem; end if;
      end loop;
      v_patch := v_patch || jsonb_build_object(v_col, to_jsonb(v_out));
    elsif jsonb_typeof(v_val) = 'string' then
      v_elem := v_val #>> '{}';
      v_id := _taxonomy_id_for_name(v_elem);
      if v_id is not null then
        select * into v_t from _taxonomy_live_target(v_id);
        if v_t.retired then
          raise exception '"%" has been retired and can no longer be chosen.', v_elem using hint = 'category_retired';
        end if;
        v_patch := v_patch || jsonb_build_object(v_col, v_t.current_tag);
      else
        raise exception '"%" is not a Nearby category. Pick one from the list.', v_elem using hint = 'category_unknown';
      end if;
    end if;
  end loop;
  if v_patch <> '{}'::jsonb then
    NEW := jsonb_populate_record(NEW, v_patch);
  end if;
  return NEW;
end $$;
revoke all on function public._taxonomy_normalize_tags() from public, anon, authenticated;
