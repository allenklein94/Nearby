// 20270370's backfill + its rollback, proven in ONE rolled-back transaction (prod or a replay DB; nothing is kept).
//   node scripts/replay/report-reason-backfill.js <prelude file with 0348-0369>
// Inserts old-style rows (each of the 10 English values, two unknown reasons), applies 20270370, records every row,
// applies the rollback, records every row again: codes after the migration, unknown -> 'other' with the original kept
// at the start of details; after the rollback every row (incl. the existing ones) is byte-identical to before.
const fs = require('fs');
const path = require('path');
const { runSql } = require('../live-verify/lib/db');
const { REPORT_REASONS, SYSTEM_REPORT_REASONS } = require('../../src/utils/reportReasons');

const ROOT = path.join(__dirname, '..', '..');
const prelude = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : '';
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270370_report_reason_codes.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270370_report_reason_codes.rollback.sql'), 'utf8');
const q = (s) => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const ALL = [...REPORT_REASONS, ...SYSTEM_REPORT_REASONS];
const OLD = [...ALL.map((r) => [r.legacy, `d-${r.code}`]), ['Weird old reason', 'kept details'], ['Another, older one', null]];
const snap = (name, extra = 'null::boolean') => `create temp table ${name} on commit drop as
  select id, reason, details, md5(row(r.*)::text) as h, ${extra} as is_code from public.reports r;`;

(async () => {
  const sql = `begin;
${prelude}
${OLD.map(([reason, details]) => `insert into public.reports (reporter_id, reported_id, reason, details) values (null, null, ${q(reason)}, ${q(details)});`).join('\n')}
create temp table test_rows on commit drop as select id from public.reports where reporter_id is null and reported_id is null and created_at = now();
${snap('before_m')}
${migration}
${snap('after_m', 'private.report_reason_code(reason) is not distinct from reason')}
${rollback}
${snap('after_rb')}
do $r$ begin raise exception 'RESULT %', (select jsonb_build_object(
  'rows', (select count(*) from before_m),
  'after', (select jsonb_agg(jsonb_build_object('was', b.reason, 'now', a.reason, 'details', a.details, 'test', b.id in (select id from test_rows)) order by b.reason) from before_m b join after_m a using (id)),
  'not_codes', (select count(*) from after_m where not is_code),
  'restored_identical', (select count(*) from before_m b join after_rb r using (id) where b.h = r.h),
  'fn_after_rollback', to_regprocedure('private.report_reason_code(text)') is not null,
  'urgent_after_rollback', private.is_urgent_report_reason('Underage user') and not private.is_urgent_report_reason('underage_user')
))::text; end $r$;`;
  try {
    await runSql(sql);
    throw new Error('expected the RESULT exception');
  } catch (e) {
    const m = /RESULT (\{.*\})/s.exec(e.message || '');
    if (!m) throw e;
    const r = JSON.parse(m[1]);
    const byWas = Object.fromEntries(r.after.filter((x) => x.test).map((x) => [x.was, x]));
    const checks = [
      ['every row is a code after the migration', r.not_codes === 0],
      ...ALL.map((x) => [`'${x.legacy}' -> ${x.code}, details kept`, byWas[x.legacy]?.now === x.code && byWas[x.legacy]?.details === `d-${x.code}`]),
      ["unknown reason -> other, original kept first in details", byWas['Weird old reason']?.now === 'other' && byWas['Weird old reason']?.details === 'Original reason: Weird old reason\nkept details'],
      ['unknown reason, no details -> other + original', byWas['Another, older one']?.now === 'other' && byWas['Another, older one']?.details === 'Original reason: Another, older one'],
      [`rollback restores every row byte-identical (${r.restored_identical}/${r.rows})`, r.restored_identical === r.rows],
      ['rollback removes the mapping, restores the English urgent rule', !r.fn_after_rollback && r.urgent_after_rollback],
    ];
    const existing = r.after.filter((x) => !x.test);
    checks.push([`test rows found (${r.after.length - existing.length}/${OLD.length})`, r.after.length - existing.length === OLD.length]);
    console.log(`existing rows: ${existing.map((x) => `${x.was} -> ${x.now}`).join('; ') || 'none'}`);
    for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    const failed = checks.filter(([, ok]) => !ok).length;
    console.log(failed ? `${failed} FAILED` : `all ${checks.length} passed (rolled back, nothing kept)`);
    process.exit(failed ? 1 : 0);
  }
})();
