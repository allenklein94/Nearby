// Journey tests (item 57): a journey walks ONE real product story across every actor and object, not one button.
// Each journey is a single SQL transaction against the live database that plays every actor in turn (setting the
// caller the way the app's own JWT would), records an ordered step log, and ALWAYS rolls back, so production is never
// changed. Jest then asserts each step by name and applies the client-side rules (the real helpers the screens use) to
// the very rows the database produced. Run: SUPABASE_ACCESS_TOKEN=... npm run journeys   (skipped without a token).
const { runSql } = require('../../scripts/live-verify/lib/db');

const hasToken = !!process.env.SUPABASE_ACCESS_TOKEN;

// `body` is plpgsql that may use `log` (jsonb array) and the helper pattern:
//   log := log || jsonb_build_array(jsonb_build_object('step', 'name', 'ok', <boolean>, 'data', <jsonb>));
async function runJourney(declare, body) {
  const sql = `do $j$ declare log jsonb := '[]'::jsonb; ${declare}
begin
${body}
raise exception 'JOURNEY_LOG %', log::text;
end $j$;`;
  try {
    await runSql(sql);
  } catch (e) {
    const m = /JOURNEY_LOG (\[.*\])/s.exec(e.message || '');
    if (m) return JSON.parse(m[1]);
    throw e;
  }
  throw new Error('journey did not return a log');
}

// step lookup helper for assertions
function stepMap(log) {
  return Object.fromEntries(log.map((s) => [s.step, s]));
}

module.exports = { runJourney, stepMap, hasToken };
