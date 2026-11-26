#!/bin/bash
# Approval B condition (2026-11-15): real-Postgres run of scripts/staging/bootstrap.js with the re-point + independent
# outbound audit inside every migration transaction, through EVERY migration on the branch. Isolated container, never production.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); NAME=${NAME:-nearby-staging-boot}; OUT=${OUT:-/tmp/nearby-staging-boot}; mkdir -p "$OUT"
cd $ROOT
awk '/^docker rm -f "\$NAME"/{p=1} p{print} /vault.create_secret/{exit}' scripts/replay/from-scratch-replay.sh > $OUT/env-prep.sh
psql_as() { local u=$1; shift; docker exec -i -e PGPASSWORD=postgres "$NAME" psql -h localhost -U "$u" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
source $OUT/env-prep.sh || { echo "env prep failed"; exit 1; }
IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "nearby-replay-internal").IPAddress}}' $NAME)
NEARBY_PG_MODULE=${NEARBY_PG_MODULE:?path to a pg module} URL=postgres://postgres:postgres@$IP:5432/postgres node -e '
const B = require("./scripts/staging/bootstrap.js");
const A = require("./scripts/staging/outboundAudit.js");
const { Client } = require(process.env.NEARBY_PG_MODULE);
const run = async (sql) => { const c = new Client({ connectionString: process.env.URL }); await c.connect();
  try { const r = await c.query(sql); const l = Array.isArray(r) ? r : [r]; return l[l.length - 1].rows || []; } finally { await c.end(); } };
const REF = "abcdefghijklmnopqrst", THROUGH = "20279999";
(async () => {
  const p = await B.plan({ run, ref: REF, through: THROUGH });
  console.log("PLAN", JSON.stringify(p));
  const t0 = Date.now();
  const r = await B.apply({ run, ref: REF, through: THROUGH, env: { NEARBY_STAGING_BOOTSTRAP_APPROVAL: p.code, NEARBY_SESSION_ID: "local-validation-b432" }, log: (m) => { if (!/^ok /.test(m)) console.log(m); } });
  console.log("APPLIED", r.applied, "in", Math.round((Date.now() - t0) / 1000), "s");
  console.log("FINAL AUDIT", JSON.stringify(await A.runAudit(run, REF)));
  const [left] = await run(B.LEFTOVER_SQL); console.log("LEFTOVER", JSON.stringify(left));
  const calls = await run("select count(*)::int as n from pg_proc where prosrc like \x27%" + REF + ".supabase.co/functions/v1/%\x27");
  console.log("functions calling STAGING edge functions", calls[0].n);
  // a migration whose production reference the re-point CANNOT fix (webhook trigger argument): its transaction must not commit
  let blocked = null;
  try { await run("begin;\ncreate function public.zz_noop() returns trigger language plpgsql as $f$begin return new; end$f$;\ncreate trigger zz_hook after insert on public.profiles for each row execute function public.zz_noop(\x27https://enmosvippabmuqslzrox.supabase.co/functions/v1/x\x27);\n" + B.repointSql(REF) + "\n" + A.auditSql(REF) + "\ncommit;"); blocked = false; }
  catch (e) { blocked = /STAGING_AUDIT_FAILED/.test(e.message); }
  const [left2] = await run("select count(*)::int as n from pg_trigger where tgname = \x27zz_hook\x27");
  console.log("CHECK unfixable production reference: transaction refused =", blocked, "| trigger left behind =", left2.n);
  let dataBlocked = null;
  try { await run("begin;\ncreate table public.zz_cfg(v text);\ninsert into public.zz_cfg values (\x27https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push\x27);\n" + B.repointSql(REF) + "\n" + A.auditSql(REF) + "\ncommit;"); dataBlocked = false; }
  catch (e) { dataBlocked = /STAGING_AUDIT_FAILED/.test(e.message); }
  const [left3] = await run("select to_regclass(\x27public.zz_cfg\x27) is null as gone");
  console.log("CHECK stored production URL: transaction refused =", dataBlocked, "| table gone =", left3.gone);
})().catch((e) => { console.error("ERROR", e.message.slice(0, 3000)); process.exit(1); });
'
echo "exit $?"
docker rm -f $NAME >/dev/null
