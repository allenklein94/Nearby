const { runSql } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

(async () => {
  const grants = await runSql(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
           p.prosecdef as security_definer
    from pg_proc p
    where p.proname in (
      'get_my_group_intent_signals','get_aggregated_demand_for_partner',
      'notify_group_intent_threshold','notify_aggregated_demand_threshold',
      'get_marketplace_reliability_rankings','get_cross_user_intent_patterns',
      'check_is_admin'
    );
  `);
  console.log('grants:', JSON.stringify(grants, null, 2));

  const triggers = await runSql(`
    select tgname, tgrelid::regclass as table_name, tgenabled
    from pg_trigger
    where tgname in ('business_requests_group_intent_notify', 'business_requests_aggregated_demand_notify');
  `);
  console.log('triggers:', JSON.stringify(triggers, null, 2));

  const cols = await runSql(`
    select column_name, data_type from information_schema.columns
    where table_name = 'business_requests' order by ordinal_position;
  `);
  console.log('business_requests columns:', JSON.stringify(cols, null, 2));
})().catch((e) => {
  console.error('ERROR', e.message, JSON.stringify(e.body));
  process.exit(1);
});
