const fs = require('fs');
const { runSql } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

(async () => {
  const sql = fs.readFileSync('/workspaces/Nearby/supabase/migrations/20260815_v2_audit_fixes.sql', 'utf8');
  const result = await runSql(sql);
  console.log('applied:', JSON.stringify(result));
})().catch((e) => {
  console.error('ERROR applying migration', e.message, JSON.stringify(e.body));
  process.exit(1);
});
