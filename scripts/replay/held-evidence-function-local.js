#!/usr/bin/env node
// Migration 20270402 with the REAL delete-account function running under Supabase's edge runtime, against real Auth, real Storage, real
// PostgREST and a from-scratch database. Nothing here talks to production: the database stays on its internal network, the runtime has
// internet only to load its imports, and send-push is a local stub that records what it was asked to send.
//   REPLAY_IMAGE=public.ecr.aws/supabase/postgres:17.6.1.003 NAME=nearby-replay17 OUT=... KEEP=1 \
//     BEFORE_MIGRATIONS='node scripts/replay/suspended-number-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   NAME=nearby-replay17 OUT=... node scripts/replay/held-evidence-function-local.js
// Everything it created is removed at the end (the guards are paused for that cleanup only).
// Proves, with real bytes in real Storage:
//   A. no hold: every file in all three media buckets goes (voice messages too), the account goes, nothing is kept.
//   B. a hold: the held original survives byte for byte, also when the person and the service role try to delete it; unrelated files go.
//      Reading it: a link is refused until an admin opens it on record; refused for another person, ever.
//   C. a failed copy: a generic error with no database text; the account + files untouched; the failure recorded + an admin push; the retry works.
//   D. Storage down: the account still goes; the files wait, and the hourly run removes them when Storage is back.
//   E. the scheduled path: no notice when the copy fails; otherwise the notice says what happens, and the account goes.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DB = process.env.NAME || 'nearby-replay';
const OUT = process.env.OUT || '/tmp/nearby-replay';
const STORAGE_IMAGE = process.env.STORAGE_IMAGE || 'public.ecr.aws/supabase/storage-api:v1.28.0';
const EDGE_IMAGE = process.env.EDGE_IMAGE || 'public.ecr.aws/supabase/edge-runtime:v1.77.8';
const POSTGREST_IMAGE = process.env.POSTGREST_IMAGE || 'postgrest/postgrest:v13.0.7';
const INTERNAL = 'nearby-replay-internal'; const AUTH = 'nearby-suspended-auth'; const AUTH_NET = 'nearby-suspended-auth-net';
const FN_NET = 'nearby-fn-net'; const GW = 'nearby-fn-gw'; const REST = 'nearby-fn-rest'; const EDGE = 'nearby-fn-edge'; const STORAGE = 'nearby-storage';
const PORT = 59997; const URL_ = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '../..');

const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const quiet = (args) => { try { return sh(args); } catch { return ''; } };
const psql = (sql, user = 'postgres') => sh(['exec', '-i', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', user, '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).trim();
const one = (sql) => psql(sql).split('\n').pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const rec = (check, pass, detail) => { if (!pass) failures += 1; console.log(`  ${pass ? '✓' : '✗ FAIL:'} ${check}${pass ? '' : ` ${JSON.stringify(detail)}`}`); };

const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET=')).slice('GOTRUE_JWT_SECRET='.length);
const jwt = (claims) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 6 * 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const SERVICE = jwt({ role: 'service_role' }); const ANON = jwt({ role: 'anon' });

const GATEWAY = `
const http=require('http');const pushes=[];
const routes={'/rest/v1/':['${REST}',3000,'/'],'/auth/v1/':['${AUTH}',9999,'/'],'/storage/v1/':['${STORAGE}',5000,'/'],'/functions/v1/delete-account':['${EDGE}',9000,'/']};
http.createServer((q,s)=>{
  if(q.url==='/_pushes'){s.end(JSON.stringify(pushes));return;}
  if(q.url.startsWith('/functions/v1/send-push')){let b='';q.on('data',d=>b+=d);q.on('end',()=>{pushes.push(JSON.parse(b));s.end('{}');});return;}
  const k=Object.keys(routes).find(p=>q.url.startsWith(p));
  if(!k){s.statusCode=404;s.end();return;}
  const [host,port,base]=routes[k];
  const h={...q.headers,host:host+':'+port};
  const p=http.request({host,port,path:base+q.url.slice(k.length),method:q.method,headers:h},r=>{s.writeHead(r.statusCode,r.headers);r.pipe(s);});
  p.on('error',e=>{s.statusCode=503;s.end(JSON.stringify({message:'gateway: '+e.code}));});q.pipe(p);
}).listen(8000);`;

async function up() {
  for (const c of [GW, REST, EDGE]) quiet(['rm', '-f', c]);
  quiet(['network', 'create', FN_NET]);
  psql(`alter role authenticator with password 'postgres';`, 'supabase_admin');
  console.log('starting Storage ...');
  execFileSync('bash', [path.join(ROOT, 'scripts/replay/storage-api-up.sh')], { env: { ...process.env, NAME: DB, OUT, STORAGE_IMAGE, LOCAL_JWT_SECRET: secret }, stdio: 'inherit' });
  sh(['run', '-d', '--name', REST, '--network', INTERNAL, '-e', `PGRST_DB_URI=postgres://authenticator:postgres@${DB}:5432/postgres`,
    '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, POSTGREST_IMAGE]);
  sh(['run', '-d', '--name', EDGE, '--network', FN_NET, '-v', `${path.join(ROOT, 'supabase/functions')}:/fn:ro`,
    '-e', `SUPABASE_URL=http://${GW}:8000`, '-e', `SUPABASE_SECRET_KEYS=${JSON.stringify({ default: SERVICE })}`,
    EDGE_IMAGE, 'start', '--main-service', '/fn/delete-account', '--port', '9000']);
  sh(['run', '-d', '--name', GW, '--network', FN_NET, '-p', `127.0.0.1:${PORT}:8000`, 'node:20-alpine', 'node', '-e', GATEWAY]);
  sh(['network', 'connect', INTERNAL, GW]);
  sh(['network', 'connect', AUTH_NET, GW]);
  for (let i = 0; i < 60; i += 1) {
    const r = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: ANON } }).catch(() => null);
    if (r && r.status < 500) break;
    await sleep(1000);
  }
}

async function callFunction(token, body) {
  // the runtime loads its imports on the first call
  for (let i = 0; i < 40; i += 1) {
    const r = await fetch(`${URL_}/functions/v1/delete-account`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (r && r.status !== 503) { const text = await r.text(); return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }; }
    await sleep(3000);
  }
  throw new Error(`the function never answered:\n${quiet(['logs', '--tail', '30', EDGE])}`);
}

(async () => {
  await up();
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const JPEG = crypto.randomBytes(2048);
  const person = async (label, isAdmin = false) => {
    const email = `${label}-${crypto.randomUUID().slice(0, 8)}@local.invalid`; const password = crypto.randomBytes(16).toString('hex');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser: ${error.message}`);
    const id = data.user.id;
    psql(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
          values ('${id}', 'Local Person', date '1995-03-01', now(), now(), 'America/New_York', true, false, ${isAdmin}) on conflict (id) do update set is_admin = ${isAdmin};`);
    const c = client();
    const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password });
    if (e2) throw new Error(`sign in: ${e2.message}`);
    return { id, c, token: s.session.access_token };
  };
  const put = async (p, bucket, name, bytes = crypto.randomBytes(512)) => {
    const { error } = await p.c.storage.from(bucket).upload(`${p.id}/${name}`, bytes, { contentType: 'application/octet-stream' });
    if (error) throw new Error(`upload ${bucket}: ${error.message}`);
    return { bucket, name: `${p.id}/${name}`, bytes };
  };
  const inStorage = async (f) => (await admin.storage.from(f.bucket).download(f.name)).error == null;
  const queue = (id) => one(`select count(*) from private.account_file_cleanup where account_id = '${id}'`);
  const gone = (id) => one(`select count(*) from auth.users where id = '${id}'`) === '0';
  psql(`update private.account_security_settings set deletion_protection_enabled = false;`);

  console.log('A. no hold');
  const a = await person('free');
  const aPhoto = await put(a, 'profile-photos', 'main.jpg'); const aOld = await put(a, 'profile-photos', 'old.jpg');
  const aVoice = await put(a, 'chat-media', 'voice-1.m4a'); const aIntro = await put(a, 'profile-audio', 'voice-intro-1.m4a');
  psql(`update profiles set photo_url = '${aPhoto.name}' where id = '${a.id}';`);
  // 20270403: a gathering cover lives under the gathering's id, not the person's
  const coverGathering = psql(`insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values ('${a.id}', 'Walk', 'Walk', now() + interval '3 days', 26.7, -80.03, 'Coffee', 'abc', 'everyone', true) returning id;`).split('\n')[0];
  const aCover = { bucket: 'gathering-photos', name: `${coverGathering}/cover.jpg` };
  await admin.storage.from('gathering-photos').upload(aCover.name, crypto.randomBytes(256), { contentType: 'image/jpeg' });
  psql(`update gatherings set cover_photo_path = '${aCover.name}' where id = '${coverGathering}';`);
  rec('the cover is really in Storage', await inStorage(aCover));
  const ra = await callFunction(a.token);
  rec('the function answers ok, with the number of files Storage confirmed', ra.status === 200 && ra.json?.ok && ra.json?.filesRemoved === 5, ra);
  rec('the gathering cover left too', !(await inStorage(aCover)));
  rec('the account is gone', gone(a.id));
  rec('every file is gone: photo, replaced photo, voice message, voice intro', !(await inStorage(aPhoto)) && !(await inStorage(aOld)) && !(await inStorage(aVoice)) && !(await inStorage(aIntro)));
  rec('nothing kept, nothing queued', one(`select count(*) from private.held_account_evidence where account_id = '${a.id}'`) === '0' && queue(a.id) === '0');
  rec('no deletion marker left', one(`select count(*) from private.account_deletion_markers where account_id = '${a.id}'`) === '0');

  console.log('A2. a cancelled gathering: the cover leaves on the hourly run, the account stays');
  const host = await person('host');
  const g2 = psql(`insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values ('${host.id}', 'Walk', 'Walk', now() + interval '3 days', 26.7, -80.03, 'Coffee', 'abc', 'everyone', true) returning id;`).split('\n')[0];
  const g2Cover = { bucket: 'gathering-photos', name: `${g2}/cover.jpg` };
  await admin.storage.from('gathering-photos').upload(g2Cover.name, crypto.randomBytes(256), { contentType: 'image/jpeg' });
  psql(`delete from gatherings where id = '${g2}';`);
  const rc = await callFunction(SERVICE, { purge_due: true });
  rec('the cover is gone, the host is not', rc.status === 200 && !(await inStorage(g2Cover)) && !gone(host.id), rc);
  rec('nothing left in the queue for it', queue(host.id) === '0');

  console.log('B. a hold');
  const mod = await person('admin', true); const other = await person('other');
  const b = await person('held');
  const bPhoto = await put(b, 'profile-photos', 'main.jpg', JPEG); const bVoice = await put(b, 'chat-media', 'voice-1.m4a');
  psql(`update profiles set photo_url = '${bPhoto.name}' where id = '${b.id}';`);
  const reportId = psql(`insert into reports (reporter_id, reported_id, reason) values ('${other.id}', '${b.id}', 'Inappropriate photo') returning id;`).split('\n')[0];
  const hold = await mod.c.rpc('admin_place_legal_hold', { target_type_param: 'report', target_id_param: reportId, reason_param: 'Preservation request from counsel', reference_param: 'REF-1' });
  rec('the hold reports one file kept', hold.data?.files?.kept === 1, hold);
  await b.c.storage.from('profile-photos').remove([bPhoto.name]);
  rec('the person removing their own photo: no error shown, the file stays', await inStorage(bPhoto));
  const objectId = one(`select object_id from private.legal_hold_files where hold_id = '${hold.data.hold_id}';`);
  const rb = await callFunction(b.token);
  rec('the deletion goes through, indistinguishably', rb.status === 200 && rb.json?.ok === true && !/hold|evidence/i.test(rb.text), rb);
  rec('the account is gone', gone(b.id));
  rec('the held original is still there; the voice message is not', (await inStorage(bPhoto)) && !(await inStorage(bVoice)));
  const dl = await admin.storage.from('profile-photos').download(bPhoto.name);
  rec('byte for byte', dl.data && Buffer.from(await dl.data.arrayBuffer()).equals(JPEG));
  await admin.storage.from('profile-photos').remove([bPhoto.name]);
  rec('even the service role can\'t remove it through Storage', await inStorage(bPhoto));
  const before = await mod.c.storage.from('profile-photos').createSignedUrl(bPhoto.name, 60);
  rec('an admin gets no link before opening it on record', !!before.error, before);
  const opened = await mod.c.rpc('admin_open_held_file', { hold_id_param: hold.data.hold_id, object_id_param: objectId, purpose_param: 'Reviewing for REF-1' });
  rec('opening returns where it is', opened.data?.[0]?.object_name === bPhoto.name, opened);
  const link = await mod.c.storage.from('profile-photos').createSignedUrl(bPhoto.name, 60);
  rec('then a link is issued', !!link.data?.signedUrl, link);
  rec('the opening is on record, with the reason', one(`select count(*) from private.legal_hold_file_access where object_id = '${objectId}' and admin_id = '${mod.id}' and purpose = 'Reviewing for REF-1'`) === '1');
  const stranger = await other.c.storage.from('profile-photos').createSignedUrl(bPhoto.name, 60);
  rec('another person gets no link', !!stranger.error, stranger);
  const strangerOpen = await other.c.rpc('admin_open_held_file', { hold_id_param: hold.data.hold_id, object_id_param: objectId, purpose_param: 'Trying to open this' });
  rec('and can\'t open it', strangerOpen.error?.hint === 'admin_only', strangerOpen);

  console.log('C. a failed copy');
  const c = await person('stuck');
  const cPhoto = await put(c, 'profile-photos', 'main.jpg');
  psql(`update profiles set photo_url = '${cPhoto.name}' where id = '${c.id}';`);
  const caseId = psql(`insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', '${c.id}') returning id;`).split('\n')[0];
  await mod.c.rpc('admin_place_legal_hold', { target_type_param: 'review_case', target_id_param: caseId, reason_param: 'Preservation request from counsel' });
  psql(`create or replace function private.test_refuse_copy() returns trigger language plpgsql as 'begin raise exception ''held evidence copy failed''; end';
        create trigger test_refuse_copy before insert on private.held_account_evidence for each row execute function private.test_refuse_copy();`, 'postgres');
  const rc = await callFunction(c.token);
  rec('a generic error, nothing from the database', rc.status === 500 && rc.text === '{"error":"Failed to delete account"}', rc);
  rec('the account and file are untouched', !gone(c.id) && (await inStorage(cPhoto)) && one(`select count(*) from profiles where id = '${c.id}'`) === '1');
  rec('the failure is recorded', one(`select count(*) from private.account_deletion_failures where account_id = '${c.id}' and step = 'preserve'`) === '1');
  rec('an admin was told, with counts only', one(`select count(*) from push_outbox where recipient_id = '${mod.id}' and dedupe_key like 'account_deletion:%' and body not like '%${c.id}%'`) === '1');
  psql('drop trigger test_refuse_copy on private.held_account_evidence; drop function private.test_refuse_copy();');
  const rc2 = await callFunction(c.token);
  rec('the retry succeeds and keeps the evidence', rc2.status === 200 && gone(c.id) && one(`select count(*) from private.held_account_evidence where account_id = '${c.id}' and record_type = 'review_case'`) === '1', rc2);

  console.log('D. Storage down');
  const d = await person('storagedown');
  const dPhoto = await put(d, 'profile-photos', 'main.jpg');
  psql(`update profiles set photo_url = '${dPhoto.name}' where id = '${d.id}';`);
  sh(['stop', STORAGE]);
  const rd = await callFunction(d.token);
  rec('the account still goes', rd.status === 200 && gone(d.id), rd);
  rec('the file waits, nothing is lost track of', queue(d.id) === '1' && one(`select attempts from private.account_file_cleanup where account_id = '${d.id}'`) === '1');
  sh(['start', STORAGE]);
  for (let i = 0; i < 30; i += 1) { const r = await fetch(`${URL_}/storage/v1/status`).catch(() => null); if (r && r.status === 200) break; await sleep(2000); }
  rec('Storage is back and the file is still there', await inStorage(dPhoto));
  const rh = await callFunction(SERVICE, { purge_due: true });
  rec('the hourly run removes it', rh.status === 200 && !(await inStorage(dPhoto)) && queue(d.id) === '0', rh);

  console.log('E. the scheduled path');
  const pushes = async () => JSON.parse(await (await fetch(`${URL_}/_pushes`)).text());
  const e = await person('scheduled');
  const eCase = psql(`insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', '${e.id}') returning id;`).split('\n')[0];
  await mod.c.rpc('admin_place_legal_hold', { target_type_param: 'review_case', target_id_param: eCase, reason_param: 'Preservation request from counsel' });
  psql(`insert into private.account_deletion_requests (user_id, requested_at, purge_at, status) values ('${e.id}', now() - interval '8 days', now() - interval '1 day', 'pending');`);
  psql(`create or replace function private.test_refuse_copy() returns trigger language plpgsql as 'begin raise exception ''copy failed''; end';
        create trigger test_refuse_copy before insert on private.held_account_evidence for each row execute function private.test_refuse_copy();`);
  const n0 = (await pushes()).length;
  const re1 = await callFunction(SERVICE, { purge_due: true });
  rec('a failed copy: not deleted, and no notice sent', re1.json?.deleted === 0 && !gone(e.id) && (await pushes()).length === n0, re1);
  psql('drop trigger test_refuse_copy on private.held_account_evidence; drop function private.test_refuse_copy();');
  const re2 = await callFunction(SERVICE, { purge_due: true });
  const notice = (await pushes()).slice(-1)[0];
  rec('then it goes, keeping the evidence', re2.json?.deleted === 1 && gone(e.id) && one(`select count(*) from private.held_account_evidence where account_id = '${e.id}'`) !== '0', re2);
  rec('the notice says what is happening and what may be kept', notice?.title === 'Your Nearby account is being deleted' && /limited records/.test(notice?.body || ''), notice);
  rec('no refusal or failure text anywhere in the answers', ![ra, rb, rd, rh, re1, re2].some((r) => /held|hold|evidence/i.test(r.text)));

  psql(`alter table private.held_account_evidence disable trigger user; alter table private.legal_hold_files disable trigger user; alter table private.legal_hold_file_access disable trigger user;
        alter table private.legal_holds disable trigger legal_hold_immutable; alter table private.suspended_account_records disable trigger suspended_record_guard;
        delete from private.legal_hold_file_access; delete from private.legal_hold_files; delete from private.held_account_evidence; delete from private.legal_holds;
        delete from private.account_file_cleanup; delete from private.account_deletion_markers; delete from private.account_deletion_failures;
        delete from private.suspended_account_records where decisions::text like '%Local test%';
        delete from reports where reason = 'inappropriate_photo' and reporter_id is null and reported_id is null; delete from reports where reporter_id = '${other.id}'; delete from push_outbox where dedupe_key like 'account_deletion:%';
        delete from storage.objects where bucket_id = 'profile-photos' and name = '${bPhoto.name}';
        alter table private.held_account_evidence enable trigger user; alter table private.legal_hold_files enable trigger user; alter table private.legal_hold_file_access enable trigger user;
        alter table private.legal_holds enable trigger legal_hold_immutable; alter table private.suspended_account_records enable trigger suspended_record_guard;`, 'supabase_admin');
  for (const p of [mod, other]) { psql(`delete from profiles where id = '${p.id}'; delete from auth.users where id = '${p.id}';`); }
  if (process.env.KEEP !== '1') for (const x of [GW, REST, EDGE]) quiet(['rm', '-f', x]);
  console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
  fs.writeFileSync(path.join(OUT, 'function-result.txt'), failures ? `FAILED ${failures}\n` : 'ALL PASS\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); console.error(quiet(['logs', '--tail', '40', EDGE])); process.exit(1); });
