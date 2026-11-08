#!/usr/bin/env node
// Every relationship a deleted account reaches, tried for real. For each foreign key whose parent is the account or a row the account's
// deletion cascades to, this makes one row hanging off that account (fixture rows go in with triggers and checks off, so it reaches
// tables no journey fills), then runs the deletion in the order delete-account uses (profile, then auth user) with every trigger and key
// ON, and reports what happened to that row. Local databases only: refuses anything but NEARBY_LOCAL_DB_URL, all in one rolled-back
// transaction. Needs a superuser (it turns triggers off for the fixtures and drops check constraints inside the transaction).
//   NEARBY_LOCAL_DB_URL=postgres://supabase_admin:...@host/postgres node scripts/replay/account-deletion-sweep.js [--json out.json]
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const fs = require('fs');
const crypto = require('crypto');

const URL_ = process.env.NEARBY_LOCAL_DB_URL;
if (!URL_ || /supabase\.(co|com)/.test(URL_)) { console.error('local database only'); process.exit(2); }

const q = (id) => `"${id.replace(/"/g, '""')}"`;
const name = (t) => `${q(t.schema)}.${q(t.table)}`;
const key = (t) => `${t.schema}.${t.table}`;

async function main() {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  await c.query('begin');
  const { rows: fks } = await c.query(`
    select c.conname, c.confdeltype act,
      cn.nspname child_schema, cr.relname child_table, pn.nspname parent_schema, pr.relname parent_table,
      (select array_agg(a.attname::text order by o) from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) child_cols,
      (select array_agg(a.attname::text order by o) from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) parent_cols
    from pg_constraint c join pg_class cr on cr.oid = c.conrelid join pg_namespace cn on cn.oid = cr.relnamespace
      join pg_class pr on pr.oid = c.confrelid join pg_namespace pn on pn.oid = pr.relnamespace
    where c.contype = 'f' and cr.relkind in ('r', 'p')`);

  // the shortest cascade path from the account to each table
  const paths = new Map([['auth.users', []]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const fk of fks) {
      if (fk.act !== 'c') continue;
      const p = `${fk.parent_schema}.${fk.parent_table}`; const ch = `${fk.child_schema}.${fk.child_table}`;
      if (paths.has(p) && !paths.has(ch)) { paths.set(ch, [...paths.get(p), fk]); grew = true; }
    }
  }
  const edges = fks.filter((fk) => paths.has(`${fk.parent_schema}.${fk.parent_table}`))
    .filter((fk) => fk.child_schema !== 'auth' && fk.child_schema !== 'storage');

  const cols = new Map();
  const colsOf = async (schema, table) => {
    const k = `${schema}.${table}`;
    if (cols.has(k)) return cols.get(k);
    const { rows } = await c.query(`select a.attname, a.attnotnull, t.typname, t.typtype, t.typcategory, a.atthasdef, a.attgenerated, a.attidentity, format_type(a.atttypid, a.atttypmod) ft,
        (select e.enumlabel from pg_enum e where e.enumtypid = a.atttypid order by e.enumsortorder limit 1) first_label
      from pg_attribute a join pg_type t on t.oid = a.atttypid
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`, [`${q(schema)}.${q(table)}`]);
    cols.set(k, rows);
    return rows;
  };

  // checks would refuse generic values; they are not what is being tested (a check naming a SET NULL column is kept)
  const stripped = new Set();
  const strip = async (schema, table, keepColumns = []) => {
    const k = `${schema}.${table}`;
    if (stripped.has(k)) return;
    stripped.add(k);
    const { rows } = await c.query(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = $1::regclass and contype in ('c', 'x')`, [`${q(schema)}.${q(table)}`]);
    for (const r of rows) {
      if (keepColumns.some((col) => r.def.includes(col))) continue;
      await c.query(`alter table ${q(schema)}.${q(table)} drop constraint ${q(r.conname)}`);
    }
  };

  const value = (col) => {
    if (col.first_label) return `'${col.first_label}'::${col.ft}`;
    if (col.typcategory === 'A') return `'{}'::${col.ft}`;
    switch (col.typname) {
      case 'uuid': return 'gen_random_uuid()';
      case 'text': case 'varchar': case 'bpchar': case 'citext': return `'s${crypto.randomBytes(5).toString('hex')}'`;
      case 'int2': case 'int4': case 'int8': return String(1 + Math.floor(Math.random() * 30000));
      case 'numeric': case 'float4': case 'float8': return '1';
      case 'bool': return 'false';
      case 'timestamptz': case 'timestamp': return "now() + interval '1 day'";
      case 'date': return "current_date + 1";
      case 'time': case 'timetz': return "'12:00'";
      case 'jsonb': case 'json': return "'{}'";
      case 'interval': return "'1 hour'";
      case 'bytea': return "'\\x00'";
      case 'inet': return "'127.0.0.1'";
      default: return `null`;
    }
  };

  // one row, all other columns generic; returns the row
  const insert = async (schema, table, fixed) => {
    const all = await colsOf(schema, table);
    const names = []; const vals = []; const params = [];
    for (const col of all) {
      if (col.attgenerated) continue;
      if (col.attname in fixed) { names.push(q(col.attname)); params.push(fixed[col.attname]); vals.push(`$${params.length}::${col.ft}`); continue; }
      if (col.attidentity) continue;
      if (col.atthasdef && !col.attnotnull) continue;
      if (col.atthasdef) continue;
      if (!col.attnotnull) continue;
      names.push(q(col.attname)); vals.push(value(col));
    }
    const { rows } = await c.query(`insert into ${q(schema)}.${q(table)} (${names.join(',')}) values (${vals.join(',')}) returning *`, params);
    return rows[0];
  };

  // a fixture has to be a shape the app can make wherever a check names the key under test
  const SHAPES = {
    'public.brand_offers': { unlock_community_id: { unlock_scope: 'community', unlock_min_members: 1 } },
    'private.account_review_cases': { subject_user: { signal: 'report', reason: 'reported_profile' } },
  };
  const results = [];
  const tableKey = (s, t) => `${s}.${t}`;
  for (const fk of edges) {
    const label = `${fk.child_schema}.${fk.child_table}.${fk.child_cols.join(',')} -> ${fk.parent_schema}.${fk.parent_table} (${{ a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' }[fk.act]})`;
    // Postgres re-checks every key on an UPDATE of a row inserted in the same transaction, so a SET NULL on a fixture row trips over the
    // fixture's other generic keys. A committed row never does. Those keys are dropped for this edge and it is tried again.
    const dropForEdge = [];
    let outcome; let detail = null; let kept = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
    await c.query('savepoint edge');
    let retry = false;
    outcome = undefined; detail = null; kept = null;
    try {
      for (const d of dropForEdge) await c.query(`alter table ${d.table} drop constraint ${q(d.name)}`);
      await c.query("set local session_replication_role = 'replica'");
      await c.query('savepoint fixture');
      const uid = crypto.randomUUID();
      await c.query("insert into auth.users (id, email, aud, role, instance_id, created_at, updated_at) values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())", [uid, `sweep-${uid}@sweep.invalid`]);
      await strip('public', 'profiles');
      if (fk.child_table !== 'profiles' || fk.child_cols[0] !== 'id') await insert('public', 'profiles', { id: uid });
      const made = new Map([['auth.users', { id: uid }], ['public.profiles', { id: uid }]]);
      const ensure = async (k) => {
        if (made.has(k)) return made.get(k);
        const path = paths.get(k);
        const last = path[path.length - 1];
        const parentRow = await ensure(tableKey(last.parent_schema, last.parent_table));
        const fixed = {};
        last.child_cols.forEach((col, i) => { fixed[col] = parentRow[last.parent_cols[i]]; });
        await strip(last.child_schema, last.child_table);
        const row = await insert(last.child_schema, last.child_table, fixed);
        made.set(k, row);
        return row;
      };
      const parentRow = await ensure(tableKey(fk.parent_schema, fk.parent_table));
      const fixed = {};
      fk.child_cols.forEach((col, i) => { fixed[col] = parentRow[fk.parent_cols[i]]; });
      const childKey = tableKey(fk.child_schema, fk.child_table);
      await strip(fk.child_schema, fk.child_table, fk.act === 'n' ? fk.child_cols : []);
      let child;
      if (made.has(childKey) && fk.child_table !== 'profiles') {
        const prior = made.get(childKey);
        const set = Object.keys(fixed).map((col, i) => `${q(col)} = $${i + 1}`).join(', ');
        const { rows } = await c.query(`update ${q(fk.child_schema)}.${q(fk.child_table)} set ${set} where ctid = (select ctid from ${q(fk.child_schema)}.${q(fk.child_table)} where ${q(fk.child_cols[0])} is not distinct from ${q(fk.child_cols[0])} and id = '${prior.id}') returning *`, Object.values(fixed)).catch(() => ({ rows: [] }));
        child = rows[0] || await insert(fk.child_schema, fk.child_table, fixed);
      } else child = await insert(fk.child_schema, fk.child_table, { ...fixed, ...(SHAPES[childKey]?.[fk.child_cols[0]] || {}) });
      await c.query("set local session_replication_role = 'origin'");
      await c.query('delete from public.profiles where id = $1', [uid]);
      await c.query('delete from auth.users where id = $1', [uid]);
      const ident = child.id ? `id = '${child.id}'` : null;
      if (ident) {
        const { rows: left } = await c.query(`select ${fk.child_cols.map(q).join(',')} from ${q(fk.child_schema)}.${q(fk.child_table)} where ${ident}`);
        kept = left.length > 0;
        if (kept && fk.act === 'n' && fk.child_cols.some((col) => left[0][col] !== null)) detail = 'kept, reference NOT cleared';
      }
      outcome = 'ok';
    } catch (e) {
      const recheck = e.code === '23503' && /^insert or update on table/.test(e.message) && e.constraint && !dropForEdge.some((d) => d.name === e.constraint);
      if (recheck) { dropForEdge.push({ table: `${q(e.schema)}.${q(e.table)}`, name: e.constraint }); retry = true; }
      outcome = e.code === '23503' ? 'BLOCKED' : (['22', '23', '42'].some((p) => String(e.code).startsWith(p)) && /fixture|null value/.test(e.message) ? 'fixture' : 'REFUSED');
      detail = `${e.code}: ${e.message}`.slice(0, 180);
    }
    await c.query('rollback to savepoint edge');
    stripped.clear(); // a rolled-back drop is undone, so strip again next time
    if (!retry) break;
    }
    results.push({ label, act: fk.act, outcome, kept, detail, depth: paths.get(tableKey(fk.parent_schema, fk.parent_table)).length });
  }
  await c.query('rollback');
  await c.end();

  const by = (o) => results.filter((r) => r.outcome === o);
  console.log(`edges tried: ${results.length}  ok: ${by('ok').length}  blocked: ${by('BLOCKED').length}  refused: ${by('REFUSED').length}  fixture: ${by('fixture').length}`);
  for (const r of [...by('BLOCKED'), ...by('REFUSED'), ...by('fixture')]) console.log(`  ${r.outcome} ${r.label}\n      ${r.detail}`);
  for (const r of results.filter((x) => x.detail && x.outcome === 'ok')) console.log(`  NOTE ${r.label}: ${r.detail}`);
  const out = process.argv.indexOf('--json');
  if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(results, null, 1));
  process.exit(by('BLOCKED').length || by('REFUSED').length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
