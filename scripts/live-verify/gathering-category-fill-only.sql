-- Verifies the host can fill a MISSING gathering category but never change one (setGatheringCategoryIfMissing). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_g uuid; v_host uuid; v_n int; v_tag text;
begin
  select id, host_id into v_g, v_host from gatherings where interest_tag is null limit 1;
  if v_g is null then insert into r values ('no untagged gathering', 'skipped'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update gatherings set interest_tag = 'Coffee' where id = v_g and interest_tag is null;
  get diagnostics v_n = row_count;
  insert into r values ('fill missing (rows)', v_n::text);
  update gatherings set interest_tag = 'Wine' where id = v_g and interest_tag is null;
  get diagnostics v_n = row_count;
  insert into r values ('second change (rows)', v_n::text);
  select interest_tag into v_tag from gatherings where id = v_g;
  insert into r values ('final tag', v_tag);
end $$;
select * from r;
rollback;
