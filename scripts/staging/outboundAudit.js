// Independent outbound-reference audit of the STAGING database (owner, 2026-11-15, condition on approval B).
// It does NOT trust the re-point (bootstrap.js repointSql): it reads the finished database itself and fails if anything could
// still reach production or an unexpected outside host. One plpgsql DO block, SELECTs only (nothing is created or changed),
// that raises `STAGING_AUDIT_FAILED` with every finding. Because it raises, putting it inside a migration's transaction
// before COMMIT (deploy.js --target=staging, bootstrap.js) aborts that transaction: a failing state is never committed.
//
// Scanned:
//  * code: every function not owned by an extension, every user trigger (incl. arguments: Supabase database webhooks keep
//    their URL there), views + materialized views, column defaults, RLS policies, check constraints;
//  * outbound configuration: cron jobs, pg_net's queued requests, foreign servers, database/role settings, the vault
//    (secret NAMES only are reported; values are matched in the database and never returned);
//  * stored data: every text / varchar / json / jsonb / array column of every ordinary table, for production references.
// A finding is (a) a production reference anywhere: the project ref, the ref base64-encoded (as inside a legacy JWT),
// production's publishable key, or any other project's *.supabase.co host; or (b) in code/outbound configuration, any URL host
// other than staging's own project and the hosts in OUTSIDE_HOSTS (non-customer services: weather data only).
const { PRODUCTION_REF } = require('../lib/stagingTarget');

const PRODUCTION_PUBLISHABLE_KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW';
// Outside hosts staging code may call: none of them reaches a person. api.openweathermap.org = weather lookups with a key
// from the vault (staging has none unless the owner adds one).
const OUTSIDE_HOSTS = Object.freeze(['api.openweathermap.org']);
const MARK = 'STAGING_AUDIT_FAILED';

// The ref as it appears inside base64 / base64url text (legacy JWT payloads): every byte alignment, edge characters dropped.
function base64Fragments(s) {
  const out = new Set();
  for (let k = 0; k < 3; k += 1) {
    const enc = Buffer.from(`${'\0'.repeat(k)}${s}`).toString('base64').replace(/=+$/, '');
    const frag = enc.slice(Math.ceil((k * 8) / 6), enc.length - 2);
    out.add(frag);
    out.add(frag.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return [...out];
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(lit).join(', ')}]::text[]`;

function productionPatterns() {
  return [PRODUCTION_REF, PRODUCTION_PUBLISHABLE_KEY, ...base64Fragments(PRODUCTION_REF)].map((p) => `%${p}%`);
}

function auditSql(stagingRef) {
  if (!/^[a-z0-9]{20}$/.test(String(stagingRef)) || stagingRef === PRODUCTION_REF) throw new Error('audit: not a staging ref');
  return `do $nearby_audit$
declare
  pats text[] := ${arr(productionPatterns())};
  allowed text[] := ${arr([`${stagingRef}.supabase.co`, ...OUTSIDE_HOSTS])};
  own_ref text := ${lit(stagingRef)};
  hits text[] := '{}';
  q text;
  r record;
  h text;
  n bigint;
begin
  q := $q$
    select 'function' k, p.oid::regprocedure::text o, p.prosrc t
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname not in ('pg_catalog', 'information_schema')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    union all select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t where not t.tgisinternal
    union all select 'view', c.oid::regclass::text, pg_get_viewdef(c.oid)
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind in ('v', 'm') and ns.nspname not in ('pg_catalog', 'information_schema')
    union all select 'column default', a.adrelid::regclass::text || '.' || at.attname, pg_get_expr(a.adbin, a.adrelid)
      from pg_attrdef a join pg_attribute at on at.attrelid = a.adrelid and at.attnum = a.adnum
    union all select 'policy', p.polrelid::regclass::text || '.' || p.polname,
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') from pg_policy p
    union all select 'check constraint', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid) from pg_constraint c where c.contype = 'c'
    union all select 'foreign server', s.srvname, coalesce(array_to_string(s.srvoptions, ' '), '') from pg_foreign_server s
    union all select 'database/role setting', case when s.setrole = 0 then 'all roles' else s.setrole::regrole::text end, array_to_string(s.setconfig, ' ') from pg_db_role_setting s
  $q$;
  if to_regclass('cron.job') is not null then
    q := q || $q$ union all select 'cron job', jobid::text || coalesce(' ' || jobname, ''), command from cron.job $q$;
  end if;
  if to_regclass('net.http_request_queue') is not null then
    q := q || $q$ union all select 'queued http request', id::text, coalesce(url, '') || ' ' || coalesce(headers::text, '') || ' ' || coalesce(body::text, '') from net.http_request_queue $q$;
  end if;
  for r in execute q loop
    continue when r.t is null;
    if r.t like any (pats) then hits := hits || format('%s %s: production reference', r.k, r.o); end if;
    for h in select distinct lower(m[1]) from regexp_matches(r.t, '([a-z0-9]{20})\\.supabase\\.(?:co|in|net)', 'gi') m loop
      if h <> own_ref then hits := hits || format('%s %s: another Supabase project (%s)', r.k, r.o, h); end if;
    end loop;
    for h in select distinct lower(m[1]) from regexp_matches(r.t, '(?:https?|wss?)://([A-Za-z0-9.-]+)', 'gi') m loop
      if not (h = any (allowed)) then hits := hits || format('%s %s: outbound host %s', r.k, r.o, h); end if;
    end loop;
  end loop;
  if to_regclass('vault.decrypted_secrets') is not null then
    for r in execute $v$
      select name from vault.decrypted_secrets
       where decrypted_secret like any ($1)
          or (split_part(decrypted_secret, '.', 2) <> '' and convert_from(decode(translate(split_part(decrypted_secret, '.', 2), '-_', '+/')
                || repeat('=', (4 - length(split_part(decrypted_secret, '.', 2)) % 4) % 4), 'base64'), 'UTF8') like ('%' || $2 || '%'))
    $v$ using pats, ${lit(PRODUCTION_REF)} loop
      hits := hits || format('vault secret %s: holds a production value', r.name);
    end loop;
  end if;
  for r in
    select c.table_schema s, c.table_name t, c.column_name col
      from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where tb.table_type = 'BASE TABLE' and c.table_schema not in ('pg_catalog', 'information_schema', 'vault', 'pgsodium')
       and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY', 'USER-DEFINED')
  loop
    begin
      execute format('select count(*) from %I.%I where %I::text like any ($1)', r.s, r.t, r.col) into n using pats;
    exception when insufficient_privilege then
      hits := hits || format('table %I.%I: could not be read by the audit', r.s, r.t); continue;
    end;
    if n > 0 then hits := hits || format('data %I.%I.%I: %s row(s) with a production reference', r.s, r.t, r.col, n); end if;
  end loop;
  if cardinality(hits) > 0 then
    raise exception '${MARK} (% finding(s)):%', cardinality(hits), E'\\n' || array_to_string(hits, E'\\n');
  end if;
end $nearby_audit$;`;
}

// Runs the audit alone (read-only). { ok, findings: [..] }; any other error is rethrown.
async function runAudit(run, stagingRef) {
  try { await run(auditSql(stagingRef)); return { ok: true, findings: [] }; } catch (e) {
    const msg = String(e.message || '');
    const i = msg.indexOf(MARK);
    if (i < 0) throw e;
    const body = msg.slice(i).split(/\\n|\n/).slice(1).map((s) => s.replace(/["}\]]+$/, '').trim()).filter(Boolean);
    return { ok: false, findings: body };
  }
}

module.exports = { auditSql, runAudit, base64Fragments, productionPatterns, OUTSIDE_HOSTS, MARK, PRODUCTION_PUBLISHABLE_KEY };
