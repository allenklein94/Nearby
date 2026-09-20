const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270132_share_experience_night.sql'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../docs/shared-night.html'), 'utf8');

test('sharing is view-only: it never extends the plan view/organizer checks (which would expose child request plans)', () => {
  expect(sql).not.toMatch(/create or replace function public\._can_view_plan/);
  expect(sql).not.toMatch(/create or replace function public\._plan_direct_access/);
  expect(sql).not.toMatch(/plan_organizers/);
});
test('every owner write requires the plan creator; the table has no direct grants', () => {
  for (const fn of ['share_experience_with_friend', 'create_experience_guest_link']) {
    const body = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf('$function$;', sql.indexOf(`function public.${fn}`)));
    expect(body).toMatch(/created_by = v_uid and plan_type = 'experience'/);
  }
  expect(sql).toMatch(/revoke all on public\.plan_shares from public, anon, authenticated/);
  expect(sql).not.toMatch(/grant (select|insert|update|delete)[^;]*plan_shares/i);
});
test('only connected people can be added, and the check reuses accepted friendship / match / block state', () => {
  expect(sql).toMatch(/if not public\._are_connected\(v_uid, friend_id_param\)/);
  expect(sql).toMatch(/f\.status = 'accepted'/);
  expect(sql).toMatch(/from blocks bl/);
});
test('anon may call only the guest read; the projection carries no ids or money', () => {
  expect(sql).toMatch(/grant execute on function public\.get_public_shared_night\(uuid\) to anon, authenticated/);
  const anonGrants = sql.match(/grant execute on function [^;]* to [^;]*anon[^;]*;/g) ?? [];
  expect(anonGrants).toHaveLength(1);
  const proj = sql.slice(sql.indexOf('function public._night_stops_json'), sql.indexOf('revoke all on function public._night_stops_json'));
  for (const banned of ['request_id\'', 'partner_id', 'price', 'party_size']) expect(proj).not.toContain(`'${banned}`);
});
test('the guest page renders with textContent only (no innerHTML) and has no action buttons', () => {
  expect(page).not.toMatch(/innerHTML/);
  expect(page).not.toMatch(/get_public_shared_night[\s\S]*respond_to/);
  expect(page).not.toMatch(/<button/);
});
