// The production taxonomy sync's approval gate (owner 2026-11-28): the code binds the exact difference and commit.
const { inventoryDiff, approvalCode } = require('./sync-code-dependencies');
const fs = require('fs');
const path = require('path');

const prod = [
  { tag: 'Nightlife', file: 'src/constants/onboardingInterests.js', consumer: 'quick_picks', occurrences: 1, group: null },
  { tag: 'Coffee', file: 'docs/business.html', consumer: 'static_signup_export', occurrences: 2, group: 'food_drink' },
];
const next = [
  { tag: 'Nightlife', file: 'src/constants/onboardingInterests.js', consumer: 'quick_picks', occurrences: 2, group: null },
  { tag: 'Concerts', file: 'src/constants/onboardingInterests.js', consumer: 'quick_picks', occurrences: 1, group: null },
  { tag: 'Coffee', file: 'docs/business.html', consumer: 'static_signup_export', occurrences: 2, group: 'food_drink' },
];

test('difference names only real new / changed / removed rows', () => {
  const d = inventoryDiff(prod, next);
  expect(d).toEqual([
    { change: 'new', tag: 'Concerts', file: 'src/constants/onboardingInterests.js', consumer: 'quick_picks', occurrences: 1 },
    { change: 'changed', tag: 'Nightlife', file: 'src/constants/onboardingInterests.js', consumer: 'quick_picks', from: 1, occurrences: 2 },
  ]);
  expect(inventoryDiff(next, prod).map((r) => r.change).sort()).toEqual(['changed', 'removed']);
  expect(inventoryDiff(prod, prod)).toEqual([]);
});

test('the approval code changes with any other difference or commit', () => {
  const d = inventoryDiff(prod, next);
  const c = approvalCode(d, 'abc');
  expect(approvalCode(d, 'abc')).toBe(c);
  expect(approvalCode(d, 'abd')).not.toBe(c);
  expect(approvalCode(d.slice(1), 'abc')).not.toBe(c);
});

test('the write path is gated: approval, clean tree, merged main, before runSql writes', () => {
  const src = fs.readFileSync(path.join(__dirname, 'sync-code-dependencies.js'), 'utf8');
  const gate = src.indexOf('if (refusals.length)');
  const write = src.indexOf('select sync_category_code_dependencies');
  expect(gate).toBeGreaterThan(0);
  expect(write).toBeGreaterThan(gate);
  for (const k of ['NEARBY_TAXONOMY_SYNC_APPROVAL', 'origin/main', 'dirty']) expect(src).toContain(k);
});
