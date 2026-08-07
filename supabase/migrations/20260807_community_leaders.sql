-- Closes the "Leaders" half of roadmap #7 (Community Screen). The data was
-- already there — community_members.role has always distinguished
-- 'creator' from 'member' — but nothing let a creator actually designate a
-- leader, and no UPDATE policy/RPC existed for community_members at all.
--
-- SECURITY DEFINER so it can bypass the (deliberately narrow) existing RLS
-- on community_members, with its own real checks: only the community's
-- creator can call it, only for members of that same community, and the
-- creator's own row can't be demoted through this path.
create or replace function public.set_community_member_role(community_id_param uuid, member_id_param uuid, new_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new_role not in ('leader', 'member') then
    raise exception 'Invalid role';
  end if;

  if not exists (select 1 from communities where id = community_id_param and creator_id = auth.uid()) then
    raise exception 'Only the community creator can change member roles';
  end if;

  if not exists (select 1 from community_members where community_id = community_id_param and user_id = member_id_param and role <> 'creator') then
    raise exception 'That member could not be found, or is the creator';
  end if;

  update community_members
  set role = new_role
  where community_id = community_id_param and user_id = member_id_param;
end;
$function$;

revoke all on function public.set_community_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_community_member_role(uuid, uuid, text) to authenticated;
