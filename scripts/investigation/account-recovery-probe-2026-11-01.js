// Investigation only (owner 2026-11-01): local replay + real Auth v2.197.0, never production. Records observations.
// Run: KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/account-takeover-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh, then node scripts/investigation/account-recovery-probe-2026-11-01.js. Observations only, no pass/fail.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { AuthClient, AuthAdminApi } = require('@supabase/auth-js');
const DB = 'nearby-replay', AUTH = 'nearby-ato-auth', url = 'http://127.0.0.1:59997', OTP = '123456';
const OWNER = '15615550181', ATK = '15615550182', OTHER = '15615550183';
const sh = (a, o = {}) => execFileSync('docker', a, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...o });
const psql = (sql) => sh(['exec', '-i', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql }).trim();
const one = (s) => psql(s).split('\n').pop();
const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET=')).slice(18);
const jwt = (c) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, ...c })}`; return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`; };
const auth = () => new AuthClient({ url, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
const admin = new AuthAdminApi({ url, headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });
const out = []; const log = (k, v) => { out.push([k, v]); console.log(k.padEnd(70), JSON.stringify(v)); };
const created = new Set();
const signIn = async (p) => { const c = auth(); await c.signInWithOtp({ phone: `+${p}` }); const v = await c.verifyOtp({ phone: `+${p}`, token: OTP, type: 'sms' }); if (v.data?.user?.id) created.add(v.data.user.id); return { c, id: v.data?.user?.id, s: v.data?.session, err: v.error?.message }; };
const u = (id) => JSON.parse(one(`select jsonb_build_object('phone',phone,'pc',coalesce(phone_change,''),'last',last_sign_in_at,'sessions',(select count(*) from auth.sessions where user_id=u.id)) from auth.users u where id='${id}'`));
const age = (id, h) => psql(`update auth.users set last_sign_in_at = now() - interval '${h} hours' where id='${id}';`);
const refresh = async (s) => { const r = await auth().refreshSession({ refresh_token: s.refresh_token }); return r.error ? `refused: ${r.error.message}` : 'works'; };
(async () => {
  try {
    // ---- Q1: admin recovery inside the 24 h window ----
    const o = await signIn(OWNER); age(o.id, 72);
    const a = await signIn(OWNER); // intruder signs in: clock restarts
    log('Q1 after intruder sign-in', u(o.id));
    const ad = await admin.updateUserById(o.id, { phone: OTHER, phone_confirm: true });
    log('Q1 admin updateUserById(phone, confirmed) inside 24 h: Auth said', ad.error ? ad.error.message : 'OK');
    log('Q1 stored phone after admin change', u(o.id).phone);
    log('Q1 events', psql(`select string_agg(kind, ',' order by id) from private.account_security_events where user_id='${o.id}'`));
    // admin can still end sessions? (GoTrue admin signOut needs a user JWT: test with the intruder's access token)
    const so = await admin.signOut(a.s.access_token, 'global');
    log('Q1 admin.signOut(intruder access token, global): Auth said', so.error ? so.error.message : 'OK');
    log('Q1 intruder refresh after admin global sign-out', await refresh(a.s));
    log('Q1 owner refresh after admin global sign-out', await refresh(o.s));
    // admin change once the window has passed
    age(o.id, 25);
    const ad2 = await admin.updateUserById(o.id, { phone: OTHER, phone_confirm: true });
    log('Q1 admin phone change after 24 h: Auth said / stored', [ad2.error ? ad2.error.message : 'OK', u(o.id).phone]);
    psql(`select set_config('app.x','1',false); update auth.users set phone='${OWNER}' where id='${o.id}';`); // DB-owner reset for Q2 (guard: last sign-in 25 h ago)
    log('Q1 DB-owner direct UPDATE (postgres) restores phone', u(o.id).phone);

    // ---- Q2: does the owner's session survive an intruder number change, and can the owner change it back? ----
    const o2 = await signIn(OWNER); age(o.id, 72);
    const a2 = await signIn(OWNER); age(o.id, 25); // pretend the intruder waited a day
    log('Q2 before change', u(o.id));
    await a2.c.updateUser({ phone: `+${ATK}` });
    const v = await a2.c.verifyOtp({ phone: `+${ATK}`, token: OTP, type: 'phone_change' });
    log('Q2 intruder number change: Auth said / stored', [v.error ? v.error.message : 'OK', u(o.id).phone]);
    log('Q2 after change (last_sign_in_at moved? sessions?)', u(o.id));
    log('Q2 owner refresh token after the change', await refresh(o2.s));
    const back = await o2.c.updateUser({ phone: `+${OWNER}` });
    const bv = await o2.c.verifyOtp({ phone: `+${OWNER}`, token: OTP, type: 'phone_change' });
    log('Q2 owner tries to change it back at once: start / verify / stored', [back.error ? back.error.message : 'OK', bv.error ? bv.error.message : 'OK', u(o.id).phone]);
    const oNew = await signIn(OWNER);
    log('Q2 owner signs in with their own number: same account?', oNew.id === o.id ? 'SAME' : `NEW account ${oNew.err || ''}`);
    const kick = await a2.c.signOut({ scope: 'global' });
    log('Q2 intruder global sign-out: owner refresh afterwards', [kick.error ? kick.error.message : 'OK', await refresh(o2.s)]);
  } catch (e) { console.error(e); }
  finally {
    for (const id of created) await admin.deleteUser(id).catch(() => {});
    const ids = [...created].map((i) => `'${i}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    psql(`delete from private.account_security_events where user_id in (${ids}); delete from push_outbox where recipient_id in (${ids});`);
    console.log('left:', one(`select count(*) from auth.users where phone in ('${OWNER}','${ATK}','${OTHER}')`));
  }
})();
