#!/usr/bin/env node
// Item 168 rollback rehearsal against production, in ONE transaction that is always rolled back (nothing persists):
// snapshot -> migration 20270294 -> post-apply activity (a group-only Sports & Fitness business, a profile interest group,
// an alias) -> rollback -> the rollback's own postconditions -> extra checks below.
//   SUPABASE_ACCESS_TOKEN=... node scripts/rollback/item168-rollback-dryrun.js
const fs = require('fs');
const path = require('path');
const { runSql } = require('../live-verify/lib/db');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const activity = `
do $$
declare mgr uuid := (select id from profiles order by created_at limit 1);
begin
  insert into brand_partners (name, category, active) values ('Item168 rehearsal gym', 'sports_fitness', false);
  update profiles set interest_groups = array['sports_fitness', 'travel_experiences'] where id = mgr;
  insert into category_aliases (phrase, category, subcategory) values ('item168 rehearsal phrase', 'sports_fitness', 'Yoga');
end $$;`;

const extra = `
do $$
declare mgr uuid := (select id from profiles order by created_at limit 1);
begin
  assert (select category from brand_partners where name = 'Item168 rehearsal gym') = 'activities_recreation', 'post-pass business folds back';
  assert (select interest_groups from profiles where id = mgr) @> array['activities_recreation'], 'post-pass interest group folds back';
  assert (select category from category_aliases where phrase = 'item168 rehearsal phrase') = 'activities_recreation', 'post-pass alias folds back';
  assert (select group_key from category_tag_groups where tag = 'Hotels') = 'stay_getaway', 'Hotels back in Stay & Getaway';
  assert (select group_key from category_tag_groups where tag = 'Yoga') = 'activities_recreation', 'Yoga back in Activities';
  assert (select retired_at is not null from category_tag_groups where tag = 'Tea'), 'Tea retired, not deleted';
  assert (select retired_at is null from category_tag_groups where tag = 'Pet Friendly Places'), 'Pet Friendly Places live again';
  assert (select count(*) from category_taxonomy_changes where reason like 'Item 168 rollback%') >= 57, 'rollback audited (31 moves + 2 restores + 24 retires)';
end $$;`;

const sql = [
  'begin;',
  read('scripts/rollback/20270294_v1_category_pass.snapshot.sql'),
  read('supabase/migrations/20270294_v1_category_pass.sql'),
  activity,
  read('scripts/rollback/20270294_v1_category_pass.rollback.sql'),
  extra,
  "select 'ROLLBACK REHEARSAL OK' as result, (select count(*) from category_tag_groups where retired_at is null) as live_tags, cardinality(category_major_keys()) as groups;",
  'rollback;',
].join('\n');

runSql(sql)
  .then((r) => { console.log(JSON.stringify(r)); })
  .catch((e) => { console.error(e.message); process.exit(1); });
