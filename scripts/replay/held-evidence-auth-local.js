#!/usr/bin/env node
// Migration 20270402 through a REAL Supabase Auth server (production's version) on a from-scratch replay database, in delete-account's
// order: preserve (service role), delete the profile (as the service role), then Auth's own admin deleteUser, whose delete runs under
// Auth's database role. Nothing here talks to production: the database stays on its internal network; Auth's port is bound to 127.0.0.1.
//   KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/suspended-number-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   node scripts/replay/held-evidence-auth-local.js
// Proves: 1. a held account: Auth deletes it, the evidence is in the store, the case + decisions + pauses are gone from the live tables;
// 2. no hold: Auth deletes it, nothing is stored; 3. fail closed: when the copy fails, Auth's deleteUser returns an error and the account
// is still there; removing the failure lets the retry succeed; 4. cleanup leaves nothing behind.
// Not proven: the delete-account edge function itself running, production's PG 17.6, Storage files.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { AuthAdminApi } = require('@supabase/auth-js');

const DB = process.env.NAME || 'nearby-replay';
const AUTH = 'nearby-suspended-auth';
const AUTH_PORT = 59998;
const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const psql = (sql) => sh(['exec', '-i', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).trim();
const one = (sql) => psql(sql).split('\n').pop();

async function main() {
  const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET=')).slice('GOTRUE_JWT_SECRET='.length);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const token = `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
  const admin = new AuthAdminApi({ url: `http://127.0.0.1:${AUTH_PORT}`, headers: { Authorization: `Bearer ${token}` } });

  const results = [];
  const rec = (check, pass, detail) => { results.push({ pass: !!pass }); console.log(`  ${pass ? '✓' : '✗ FAIL:'} ${check}${pass ? '' : ` ${JSON.stringify(detail)}`}`); };
  const adminId = crypto.randomUUID();
  const made = [adminId];
  const cases = [];
  const mkUser = async (email) => {
    const { data, error } = await admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`createUser: ${error.message}`);
    const id = data.user.id;
    made.push(id);
    psql(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
          values ('${id}', 'Local Person', date '1995-03-01', now(), now(), 'America/New_York', true, false) on conflict (id) do nothing;`);
    return id;
  };
  const claims = `set_config('request.jwt.claims', '${JSON.stringify({ sub: adminId, role: 'authenticated' })}', false)`;
  const moderated = (u) => {
    const c = psql(`insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', '${u}') returning id;`).split('\n')[0];
    cases.push(c);
    psql(`insert into private.account_review_case_members (case_id, user_id) values ('${c}', '${u}');`);
    // separate transactions, as the admin screens make them: one psql -c is one transaction, one now()
    psql(`select ${claims}; select admin_suspend_user('${u}', 'Local test: harassment');`);
    psql(`select ${claims}; select admin_reinstate_user('${u}', 'Local test: lifted');`);
    psql(`select ${claims}; select admin_restrict_account('${u}', array['messages'], 7, 'Local test pause reason', null, '${c}');`);
    return c;
  };
  const stored = (u) => one(`select coalesce(string_agg(record_type || '=' || n, ',' order by record_type), '') from (select record_type, count(*) n from private.held_account_evidence where account_id = '${u}' group by 1) t`);
  const deleteInOrder = async (u) => {
    psql(`select public.account_deletion_preserve_held_evidence('${u}');`);
    psql(`delete from profiles where id = '${u}';`);
    return admin.deleteUser(u);
  };

  try {
    psql(`insert into auth.users (id, aud, role, email, created_at) values ('${adminId}', 'authenticated', 'authenticated', 'admin-${adminId.slice(0, 8)}@local.invalid', now());
          insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, is_admin) values ('${adminId}', 'Local Admin', date '1990-01-01', now(), now(), 'America/New_York', true);`);

    console.log('1. a held account');
    const held = await mkUser(`held-${crypto.randomUUID().slice(0, 8)}@local.invalid`);
    const c1 = moderated(held);
    psql(`select ${claims}; select public.admin_place_legal_hold('review_case', '${c1}', 'Preservation request from counsel', 'REF-1', 'account_history');`);
    const del1 = await deleteInOrder(held);
    rec('Auth deletes the account', !del1.error && one(`select count(*) from auth.users where id = '${held}'`) === '0', del1.error);
    const s1 = stored(held);
    rec('the case, members, history, both decisions, the pause + its history are stored',
      ['coverage=1', 'review_case=1', 'case_member=1', 'suspension_decision=2', 'pause=1', 'pause_event=1'].every((x) => s1.split(',').includes(x)) && s1.includes('case_event='), s1);
    rec('the live rows went with the account', one(`select (select count(*) from private.account_review_cases where id = '${c1}') + (select count(*) from account_moderation_actions where user_id = '${held}') + (select count(*) from private.account_restrictions where user_id = '${held}')`) === '0');

    console.log('2. no hold');
    const free = await mkUser(`free-${crypto.randomUUID().slice(0, 8)}@local.invalid`);
    const c2 = moderated(free);
    const del2 = await deleteInOrder(free);
    rec('Auth deletes the account', !del2.error && one(`select count(*) from auth.users where id = '${free}'`) === '0', del2.error);
    rec('nothing is stored', stored(free) === '', stored(free));
    rec('the case went, as today', one(`select count(*) from private.account_review_cases where id = '${c2}'`) === '0');

    console.log('3. fail closed');
    const stuck = await mkUser(`stuck-${crypto.randomUUID().slice(0, 8)}@local.invalid`);
    const c3 = moderated(stuck);
    psql(`select ${claims}; select public.admin_place_legal_hold('review_case', '${c3}', 'Preservation request from counsel', 'REF-1', 'account_history');`);
    psql(`create or replace function private.test_refuse_copy() returns trigger language plpgsql as 'begin raise exception ''copy failed''; end';
          create trigger test_refuse_copy before insert on private.held_account_evidence for each row execute function private.test_refuse_copy();`);
    const del3 = await admin.deleteUser(stuck);
    rec('Auth reports an error and the account + case are still there',
      !!del3.error && one(`select count(*) from auth.users where id = '${stuck}'`) === '1' && one(`select count(*) from private.account_review_cases where id = '${c3}'`) === '1', del3.error);
    psql('drop trigger test_refuse_copy on private.held_account_evidence; drop function private.test_refuse_copy();');
    const del4 = await deleteInOrder(stuck);
    rec('the retry succeeds and keeps the evidence', !del4.error && stored(stuck).includes('review_case=1'), del4.error || stored(stuck));
  } finally {
    psql(`drop trigger if exists test_refuse_copy on private.held_account_evidence; drop function if exists private.test_refuse_copy();
          alter table private.held_account_evidence disable trigger held_evidence_guard;
          delete from private.held_account_evidence where account_id = any(array[${made.map((m) => `'${m}'`).join(',')}]::uuid[]);
          delete from private.account_deletion_markers where account_id = any(array[${made.map((m) => `'${m}'`).join(',')}]::uuid[]);
          alter table private.held_account_evidence enable trigger held_evidence_guard;
          alter table private.legal_holds disable trigger legal_hold_immutable;
          delete from private.legal_holds where target_id = any(array[${cases.map((m) => `'${m}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`}]::uuid[]);
          alter table private.legal_holds enable trigger legal_hold_immutable;
          delete from profiles where id = any(array[${made.map((m) => `'${m}'`).join(',')}]::uuid[]);
          delete from auth.users where id = any(array[${made.map((m) => `'${m}'`).join(',')}]::uuid[]);
          alter table private.suspended_account_records disable trigger suspended_record_guard;
          delete from private.suspended_account_records where former_account_id = any(array[${made.map((m) => `'${m}'`).join(',')}]::uuid[]);
          alter table private.suspended_account_records enable trigger suspended_record_guard;`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(failed ? `FAILED: ${failed}` : `ALL PASS ${results.length}/${results.length}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
