#!/usr/bin/env node
// Rolled-back simulation (owner, 2026-10-24), same settings as seed.js:
//   node scripts/phone-session/simulate.js            seed as production is now: the push guard refuses if a real account would be notified
//   SIM_MODE=B node scripts/phone-session/simulate.js also simulates "no account recently active" + session activity by the friend account
//                                                     (join, Interested, a chat message, a reminder push), then cleanup.
//   SIM_MUTE_RECOMMENDATIONS=<uuid,...> node ... simulates Option A instead: those accounts have Settings > Notifications >
//                                                     "Recommendations" off (the discover_recommendations mute) + the same session activity.
// Simulation: seed -> capture pushes/events -> cleanup -> compare applereview + every table's row count. Ends in an
// exception, so the whole transaction aborts and nothing commits.
const L=require('./lib');
const c=L.config();
const MUTE=(process.env.SIM_MUTE_RECOMMENDATIONS||'').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x));
const SESSION=process.env.SIM_MODE==='B'||MUTE.length>0;
const acct=(em)=>`(select id from auth.users where lower(email)=lower(${L_q(em)}))`;
function L_q(s){return `'${String(s).replace(/'/g,"''")}'`;}
const AR=acct(c.friendEmail), OW=acct(c.ownerEmail);
const fp=(phase)=>`do $fp$ declare r record; k bigint; h text; ids uuid[] := array[${AR}, ${OW}]; begin
 for r in select c.table_schema s, c.table_name t, c.column_name col from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
   where c.table_schema in ('public','private','auth','storage') and c.data_type='uuid' loop
   execute format('select count(*), md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from %I.%I x where %I = any($1)', r.s, r.t, r.col) into k, h using ids;
   if k>0 then insert into _sim_fp values ('${phase}', r.s||'.'||r.t||'.'||r.col, k, h); end if;
 end loop;
 for r in select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and not c.relispartition and n.nspname in ('public','private','auth','storage') loop
   execute format('select count(*) from %I.%I', r.s, r.t) into k; insert into _sim_counts values ('${phase}', r.s||'.'||r.t, k);
 end loop; end $fp$;`;
let clean=L.cleanupSql({dryRun:true});
clean=clean.slice(clean.indexOf('do $clean$'), clean.indexOf('end $clean$;')+'end $clean$;'.length)
  .replace(/raise exception 'PHONE_SESSION_DRY_RUN %', \(select report::text from _ps_report\);/, 'null;');
// SIM_PRELUDE_FILE (optional): SQL applied first in the same aborted transaction, e.g. the staged migrations 20270348-20270354.
const PRELUDE=process.env.SIM_PRELUDE_FILE?require('fs').readFileSync(process.env.SIM_PRELUDE_FILE,'utf8'):'';
const sql=`begin;
${PRELUDE}
;
create temp table _sim_fp (phase text, col text, n bigint, h text);
create temp table _sim_counts (phase text, tbl text, n bigint);
create temp table _ps_before (cnt bigint, tbl text);
create temp table _ps_report (report jsonb);
${fp('before')}
${process.env.SIM_MODE==='B'?'delete from presence_reports; delete from notification_areas; -- inside the aborted transaction only: simulates no account recently active':''}
${MUTE.length?`update profiles set notification_mutes = array_append(coalesce(notification_mutes, '{}'), 'discover_recommendations') where id = any(array[${MUTE.map((x) => `'${x}'`).join(',')}]::uuid[]) and not (coalesce(notification_mutes, '{}') @> array['discover_recommendations']); -- aborted transaction only: Option A's Settings switch`:''}
${L.seedSql(c).replace(/select jsonb_build_object\('created'[\s\S]*$/, '')}
create temp table _sim_push as select recipient_id, title, body, data->>'type' as type, status from push_outbox where created_at >= now();
create temp table _sim_events as select type, count(*) n from domain_events where created_at >= now() group by 1;
${fp('seeded')}
${SESSION?`
-- simulated session activity by applereview on the test objects
select set_config('request.jwt.claims', json_build_object('sub', ${AR}, 'role', 'authenticated')::text, true);
set local role authenticated;
select join_gathering(${L.idOf ? "'"+L.idOf('gathering/tonight-music')+"'" : ''}::uuid);
reset role;
insert into gathering_interested (user_id, gathering_id) select ${AR}, '${L.idOf('gathering/saturday-music')}';
insert into messages (match_id, sender_id, body) select id, ${AR}, 'hi (test)' from matches where source_friendship_id = '${L.idOf('friendship/sam')}';
select public._send_push(${AR}, 'Gathering starting soon', 'sim', jsonb_build_object('type','gathering_reminder','gathering_id','${L.idOf('gathering/tonight-music')}'));
create temp table _sim_session_push as select recipient_id, title, data->>'type' as type from push_outbox where created_at >= now() and recipient_id not in (select recipient_id from _sim_push);
`:''}
${clean}
${fp('after')}
do $r$ begin raise exception 'SIM_REPORT %', jsonb_build_object(
 'pushes_from_seed', (select coalesce(jsonb_agg(to_jsonb(p)),'[]') from _sim_push p),
 'events_from_seed', (select coalesce(jsonb_object_agg(type,n),'{}') from _sim_events),
 'friend_or_owner_rows_while_seeded', (select jsonb_object_agg(s.col, s.n - coalesce(b.n,0)) from _sim_fp s left join _sim_fp b on b.phase='before' and b.col=s.col where s.phase='seeded' and (b.h is distinct from s.h)),
 'friend_or_owner_rows_changed_after_cleanup', (select coalesce(jsonb_agg(coalesce(a.col,b.col)),'[]') from (select * from _sim_fp where phase='before') b full join (select * from _sim_fp where phase='after') a on a.col=b.col where a.h is distinct from b.h or a.n is distinct from b.n),
 'tables_with_different_row_count_before_vs_after', (select coalesce(jsonb_object_agg(a.tbl, a.n-b.n),'{}') from _sim_counts b join _sim_counts a on a.tbl=b.tbl and a.phase='after' where b.phase='before' and a.n<>b.n and a.tbl not like 'pg_temp%'),
 'cleanup_report', (select report from _ps_report)); end $r$;`;
L.run(sql).then(() => { throw new Error('simulation did not report'); }).catch((e) => {
  const m = /SIM_REPORT (\{.*\})/s.exec(e.message || '');
  if (!m) { console.error(e.message || e); process.exit(1); }
  const r = JSON.parse(m[1]);
  const testIds = L.PEOPLE.map((p) => L.idOf(p.key));
  r.verdict = {
    seed_notifies_only_test_people: r.pushes_from_seed.every((p) => testIds.includes(p.recipient_id)),
    friend_and_owner_rows_identical_after_cleanup: r.friend_or_owner_rows_changed_after_cleanup.length === 0,
  };
  console.log(JSON.stringify(r, null, 2));
  console.log('\nSimulation only: the transaction was aborted, nothing was written.');
});
