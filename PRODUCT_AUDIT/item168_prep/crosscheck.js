#!/usr/bin/env node
// Item 168 prep: internal cross-check of the three deliverables. Read-only; prints PASS/FAIL per check, exits 1 on any FAIL.
//   node PRODUCT_AUDIT/item168_prep/crosscheck.js
// Inputs: mapping.json, approved_wordings.json, sql/14_business_impact.sql, evidence/01_tags.json (live tags, re-dump with
// sql/01_tags.sql to refresh), evidence/12_wording_conflicts.json, the spec, and the app's CATEGORY_GROUPS.
const fs = require('fs');
const path = require('path');
const { requireSrc } = require('../../scripts/taxonomy/loadSrc');

const DIR = __dirname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const mapping = read('mapping.json');
const wordings = read('approved_wordings.json');
const live = read('evidence/01_tags.json').filter((t) => !t.retired);
const conflicts = read('evidence/12_wording_conflicts.json');
const impactSql = fs.readFileSync(path.join(DIR, 'sql/14_business_impact.sql'), 'utf8');
const spec = fs.readFileSync(path.join(DIR, '../V1_TAXONOMY_SPEC_2026-10-03.md'), 'utf8');
const { CATEGORY_GROUPS } = requireSrc('constants/gatheringCategories.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed += 1;
};
const eqSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const diff = (a, b) => [...a].filter((x) => !b.includes(x));

const before = mapping.tags.filter((t) => t.change !== 'new');
const after = mapping.tags.filter((t) => t.group_after);
const afterByGroup = {};
for (const t of after) (afterByGroup[t.group_after] ??= []).push(t.tag);

// 1. Every live tag is mapped exactly once, with its live group; nothing is mapped that does not exist.
check('every live tag mapped exactly once', eqSet(before.map((t) => t.tag), live.map((t) => t.tag)),
  `unmapped: ${diff(live.map((t) => t.tag), before.map((t) => t.tag))}; unknown: ${diff(before.map((t) => t.tag), live.map((t) => t.tag))}`);
check('mapped "before" groups equal the live groups', before.every((t) => live.find((l) => l.tag === t.tag)?.group_key === t.group_before));
check('no duplicate tag names after the pass', new Set(after.map((t) => t.tag)).size === after.length);

// 2. The app's CATEGORY_GROUPS (the client copy) equals the live table today (so the "before" side is one truth).
const codeTags = CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])].map((tag) => ({ tag, group: g.key })));
check('app CATEGORY_GROUPS equals the live table (before)', eqSet(codeTags.map((t) => `${t.group}|${t.tag}`), live.map((t) => `${t.group_key}|${t.tag}`)));

// 3. Final membership equals every count the spec states.
const expected = { sports_fitness: 19, activities_recreation: 11, outdoors_nature: 19, travel_experiences: 17, entertainment_nightlife: 23, arts_culture_learning: 13 };
for (const [g, n] of Object.entries(expected)) check(`${g} has ${n} tags after (spec)`, (afterByGroup[g] ?? []).length === n, `has ${(afterByGroup[g] ?? []).length}`);
check('19 groups after (spec: "Result: 19 canonical groups")', Object.keys(afterByGroup).length === 19, Object.keys(afterByGroup).join(', '));
check('mapping lists 20 group rows (19 after + stay_getaway merged away)', mapping.groups.length === 20);
const sf = ['Fitness', 'Gyms', 'Personal Training', 'Yoga', 'Pilates', 'Cycling', 'Running', 'Martial Arts', 'Climbing', 'Skating', 'Sports', 'Pickleball', 'Padel', 'Tennis', 'Basketball', 'Soccer', 'Volleyball', 'Golf', 'Swimming'];
check('Sports & Fitness is exactly the item-171 final list', eqSet(afterByGroup.sports_fitness ?? [], sf));
const ar = ['Bowling', 'Walking', 'Adventure', 'Cars', 'Axe Throwing', 'Laser Tag', 'Go-Karts', 'Paintball', 'Trampoline Parks', 'Horseback Riding', 'Recreation Centers'];
check('Activities & Recreation is exactly the item-171/172 final list', eqSet(afterByGroup.activities_recreation ?? [], ar));
check('Kids Sports stays in Family & Kids', (afterByGroup.family_kids ?? []).includes('Kids Sports'));
check('Glamping in Travel & Getaways, Camping in Outdoors (one group per tag)', afterByGroup.travel_experiences.includes('Glamping') && afterByGroup.outdoors_nature.includes('Camping'));

// 4. Every new tag and every moved tag is named in the spec (nothing invented).
for (const t of mapping.tags.filter((x) => x.change === 'new' || x.change.startsWith('moved') || x.change.startsWith('retired'))) {
  if (!spec.includes(t.tag)) check(`"${t.tag}" appears in the spec`, false);
}
check('every new / moved / retired tag appears in the spec text', mapping.tags.filter((x) => x.change === 'new' || x.change.startsWith('moved') || x.change.startsWith('retired')).every((t) => spec.includes(t.tag)));
check('Locksmith is NOT created (flagged only, item 180)', !after.some((t) => t.tag === 'Locksmith'));
check('no Baseball / Softball / Hockey / Cruises / Dance Fitness category (wordings only)', !after.some((t) => ['Baseball', 'Softball', 'Hockey', 'Cruises', 'Dance Fitness', 'Department Stores', 'Kids Classes'].includes(t.tag)));

// 5. The impact SQL uses the same mapping (its VALUES lists equal mapping.json).
const valuesOf = (cte) => {
  // From "<cte>(cols) as (values" to the parenthesis that closes "as (": works for one-line and multi-line lists.
  const head = impactSql.match(new RegExp(`\\n${cte}\\([^)]*\\) as \\(values`));
  if (!head) return [];
  let depth = 1;
  let i = head.index + head[0].length;
  const start = i;
  for (; i < impactSql.length && depth > 0; i += 1) {
    if (impactSql[i] === '(') depth += 1;
    else if (impactSql[i] === ')') depth -= 1;
  }
  const body = impactSql.slice(start, i - 1);
  return [...body.matchAll(/\('([^']+)'(?:,'([^']+)')?\)/g)].map((x) => (x[2] ? `${x[1]}|${x[2]}` : x[1]));
};
check('impact SQL `moved` == mapping moves', eqSet(valuesOf('moved'), mapping.tags.filter((t) => t.change.startsWith('moved')).map((t) => `${t.tag}|${t.group_after}`)));
check('impact SQL `added` == mapping new tags', eqSet(valuesOf('added'), mapping.tags.filter((t) => t.change === 'new').map((t) => `${t.tag}|${t.group_after}`)));
check('impact SQL `retired` == mapping retirements', eqSet(valuesOf('retired'), mapping.tags.filter((t) => t.change.startsWith('retired')).map((t) => t.tag)));
check('impact SQL `customer_only` == mapping customer-only', eqSet(valuesOf('customer_only'), mapping.customer_only));

// 6. Customer-only / business-selectable split covers Dating & Social exactly.
check('customer-only + business-selectable = the whole Dating & Social group', eqSet([...mapping.customer_only, ...mapping.business_selectable_dating], afterByGroup.dating_social));

// 7. Need tags after the pass all exist, none retired, none customer-only, none business-only.
const afterNames = after.map((t) => t.tag);
check('every need tag exists after the pass', mapping.need.NEED_TAG_KEYS_after.every((t) => afterNames.includes(t)), diff(mapping.need.NEED_TAG_KEYS_after, afterNames).join(', '));
check('no retired / customer-only tag is a need tag', !mapping.need.NEED_TAG_KEYS_after.some((t) => mapping.customer_only.includes(t) || t.startsWith('Pet Friendly')));
check('Camping is not a need tag (item 179 Q2)', !mapping.need.NEED_TAG_KEYS_after.includes('Camping'));
check('Massage / Spa Day stay wants (item 176)', !mapping.need.NEED_TAG_KEYS_after.some((t) => ['Massage', 'Spa Day'].includes(t)));

// 8. Every approved wording targets a tag that exists after the pass, never a retired one.
const badTargets = wordings.filter((w) => w.tags.some((t) => !afterNames.includes(t)));
check('every approved wording targets a tag that exists after the pass', badTargets.length === 0, badTargets.map((w) => `${w.phrase} -> ${w.tags}`).join('; '));
check('no approved wording conflicts with a live synonym (server search key)', conflicts.every((c) => !c.existing_synonym_tags || eqSet(c.existing_synonym_tags, c.tags)));
const canonClash = conflicts.filter((c) => c.equals_canonical_tag && !c.equals_canonical_tag.every((t) => c.tags.includes(t)));
check('no approved wording equals a DIFFERENT canonical tag name', canonClash.length === 0, canonClash.map((c) => c.phrase).join(', '));
check('wording evidence covers every approved wording', conflicts.length === wordings.length);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASS');
process.exit(failed ? 1 : 0);
