#!/usr/bin/env node
// A freshly replayed database has nobody in it, and several concurrency scripts expect a business owner and customers. LOCAL replay database only.
//   node scripts/replay/concurrency-people.js seed    adds them if missing (safe to repeat)
//   node scripts/replay/concurrency-people.js clean   removes only these
const crypto = require('crypto');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const DOMAIN = 'concurrency-people.local.invalid';

(async () => {
  const url = process.env.NEARBY_LOCAL_DB_URL;
  if (!url) throw new Error('NEARBY_LOCAL_DB_URL is required: this never runs against production.');
  const db = new Client({ connectionString: url });
  await db.connect();
  if (process.argv[2] === 'clean') {
    const { rows } = await db.query(`select id from auth.users where email like $1`, [`%@${DOMAIN}`]);
    const ids = rows.map((r) => r.id);
    const partners = (await db.query(`select managed_partner_id p from profiles where id = any($1::uuid[]) and managed_partner_id is not null`, [ids])).rows.map((r) => r.p);
    await db.query(`delete from profiles where id = any($1::uuid[])`, [ids]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await db.query(`delete from brand_partners where id = any($1::uuid[])`, [partners]);
    console.log(`removed ${ids.length}`);
  } else {
    const n = (await db.query(`select count(*)::int n from auth.users where email like $1`, [`%@${DOMAIN}`])).rows[0].n;
    if (n === 0) {
      const partner = (await db.query(`insert into brand_partners (name, active, latitude, longitude) values ('Concurrency Test', true, 26.36, -80.08) returning id`)).rows[0].id;
      for (let i = 0; i < 6; i += 1) {
        const id = crypto.randomUUID();
        await db.query(`insert into auth.users (id, email, aud, role, instance_id, created_at, updated_at) values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now())`, [id, `${id}@${DOMAIN}`]);
        await db.query(`insert into profiles (id, display_name, birthdate, terms_accepted_at, timezone, photo_verified, profile_hidden, managed_partner_id)
          values ($1, 'Concurrency Person', date '1995-03-01', now(), 'America/New_York', true, false, $2)
          on conflict (id) do update set display_name = 'Concurrency Person', managed_partner_id = $2`, [id, i === 0 ? partner : null]);
      }
    }
    console.log('ready');
  }
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
