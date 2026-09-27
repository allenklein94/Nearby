// Code-dependency inventory for the taxonomy (2026-09-27, follows migration 20270232).
//
// The server can rename, move or retire a category, but it cannot see category NAMES written into app code. This file
// finds them: every string literal in shipped app code (src/**, tests excluded) and the static business signup export
// (docs/business.html) that exactly equals a category name, per file. The inventory is committed
// (scripts/taxonomy/code-dependencies.json, kept fresh by a Jest test) and synced to the database
// (sync-code-dependencies.js), where admin_preview_category_change lists what a change would leave stale and the change
// stays INCOMPLETE until those consumers are updated and the inventory re-synced.
//
// Pure: no network, no app imports. Callers pass the category list.
const fs = require('fs');
const path = require('path');

// Named consumers the owner asked to track explicitly; any other file is reported as "code".
const NAMED_CONSUMERS = {
  'src/constants/gatheringCategories.js': 'baseline_taxonomy',
  'src/constants/onboardingInterests.js': 'quick_picks',
  'src/constants/categorySynonyms.js': 'synonyms',
  'src/constants/energyLevel.js': 'energy',
  'src/constants/commitmentLevel.js': 'commitment',
  'src/constants/timeBudget.js': 'duration',
  'docs/business.html': 'static_signup_export',
};

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name) && !/\.(test|journey)\.js$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  out.push(path.join(root, 'docs', 'business.html'));
  return out.map((p) => path.relative(root, p).split(path.sep).join('/')).sort();
}

// Unquoted object keys ({ Coffee: 45, 'Fine Dining': 120 } -> "Coffee"): the tag maps (energy, commitment, duration...)
// write single-word tags this way.
function identifierKeys(src) {
  return [...src.matchAll(/(?:^|[{,\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*:(?!:)/g)].map((m) => m[1]);
}

// String literals ('..', "..", `..` without ${}) -> their text.
function stringLiterals(src) {
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] ?? m[2] ?? m[3];
    out.push(raw.replace(/\\(.)/g, '$1'));
  }
  return out;
}

// Which group each file PLACES a tag in (only the two files that encode placement): the app baseline and the static
// signup export. A move leaves these stale.
function placements(file, src, groups) {
  if (file === 'src/constants/gatheringCategories.js') {
    const map = {};
    for (const g of groups) for (const t of [...g.tags, ...(g.businessOnlyTags ?? [])]) map[t] = g.key;
    return map;
  }
  if (file === 'docs/business.html') {
    const m = src.match(/var APPLY_TAGS = (\{.*\});/);
    if (!m) return {};
    const map = {};
    for (const [k, tags] of Object.entries(JSON.parse(m[1]))) for (const t of tags) map[t] = k;
    return map;
  }
  return null;
}

// groups: CATEGORY_GROUPS (the app baseline). Returns a deterministic, JSON-ready inventory.
function buildInventory(root, groups) {
  const names = new Set(groups.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));
  const rows = [];
  for (const file of listFiles(root)) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const counts = new Map();
    const found = [...stringLiterals(src), ...(file.endsWith('.js') ? identifierKeys(src) : [])];
    for (const lit of found) if (names.has(lit)) counts.set(lit, (counts.get(lit) ?? 0) + 1);
    const place = placements(file, src, groups);
    for (const [tag, occurrences] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      rows.push({ tag, file, consumer: NAMED_CONSUMERS[file] ?? 'code', occurrences, group: place ? (place[tag] ?? null) : null });
    }
  }
  return { format: 1, rows };
}

module.exports = { NAMED_CONSUMERS, buildInventory, stringLiterals, identifierKeys, listFiles };
