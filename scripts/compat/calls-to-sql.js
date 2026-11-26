// Turns a scan-calls.js list into one SQL query checking each call against the database catalog for the `authenticated`
// role (existence + privilege + RPC argument names). node calls-to-sql.js <calls.json> > check.sql; psql -At -f check.sql
const calls = require(require('path').resolve(process.argv[2]));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
function plainCols(cols) {
  let depth = 0, cur = '', parts = [];
  for (const c of cols) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c; }
  parts.push(cur);
  const plain = [], embedded = [];
  for (let p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.includes('(')) { embedded.push(p); continue; }
    p = p.replace(/^[a-zA-Z_]+:/, '').replace(/::\w+$/, '').replace(/->.*$/, '').trim();
    if (p === '*') plain.push('*'); else if (/^[a-z_0-9]+$/.test(p)) plain.push(p); else embedded.push(p);
  }
  return { plain, embedded };
}
const rows = [];
const seen = new Set();
for (const r of calls.rpc) { const k = 'R' + r.name + JSON.stringify(r.args); if (seen.has(k)) continue; seen.add(k);
  rows.push(`select 'rpc' kind, ${q(r.name)} name, ${q((r.args || []).join(','))} detail, ${q(r.file + ':' + r.line)} at,
    case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${q(r.name)}) then 'missing'
      when not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${q(r.name)}
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))) then 'no-execute'
      when not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${q(r.name)}
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
        and (${q((r.args || []).join(','))} = '' or array(select unnest(string_to_array(${q((r.args || []).join(','))}, ','))) <@ coalesce(p.proargnames[1:p.pronargs], '{}'))) then 'args-mismatch'
      else 'ok' end result`); }
for (const t of calls.table) { const k = 'T' + t.name + t.op + t.cols; if (seen.has(k)) continue; seen.add(k);
  const rel = `'public.${t.name}'`;
  const exists = `to_regclass(${rel}) is not null`;
  let priv;
  if (t.op === 'select' && t.cols !== null) { const { plain } = plainCols(t.cols);
    priv = plain.length === 0 ? 'true' : plain.map((c) => c === '*' ? `has_table_privilege('authenticated', ${rel}, 'select')`
      : `(exists (select 1 from information_schema.columns where table_schema='public' and table_name=${q(t.name)} and column_name=${q(c)}) and has_column_privilege('authenticated', ${rel}, ${q(c)}, 'select'))`).join(' and ');
  } else if (t.op === 'select' || t.op === null) priv = `has_any_column_privilege('authenticated', ${rel}, 'select')`;
  else if (t.op === 'insert') priv = `has_any_column_privilege('authenticated', ${rel}, 'insert')`;
  else if (t.op === 'update') priv = `has_any_column_privilege('authenticated', ${rel}, 'update')`;
  else if (t.op === 'upsert') priv = `has_any_column_privilege('authenticated', ${rel}, 'insert') and has_any_column_privilege('authenticated', ${rel}, 'update')`;
  else priv = `has_table_privilege('authenticated', ${rel}, 'delete')`;
  rows.push(`select 'table' kind, ${q(t.name)} name, ${q((t.op || '?') + ' ' + (t.cols || ''))} detail, ${q(t.file + ':' + t.line)} at,
    case when not (${exists}) then 'missing' when ${priv} then 'ok' else 'no-privilege' end result`); }
console.log(`select kind||' | '||result||' | '||name||' | '||left(detail,160)||' | '||at from (\n${rows.join('\nunion all\n')}\n) x order by result <> 'ok' desc, kind, name, detail;`);
