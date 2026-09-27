#!/usr/bin/env node
// Rebuilds scripts/taxonomy/code-dependencies.json from the code. Run after editing any category name in app code or
// regenerating the signup export, then sync it: node scripts/taxonomy/sync-code-dependencies.js
const fs = require('fs');
const path = require('path');
const { ROOT, requireSrc } = require('./loadSrc');
const { buildInventory } = require('./codeDependencies');

const { CATEGORY_GROUPS } = requireSrc('constants/gatheringCategories.js');
const inventory = buildInventory(ROOT, CATEGORY_GROUPS);
fs.writeFileSync(path.join(__dirname, 'code-dependencies.json'), JSON.stringify(inventory, null, 1) + '\n');
console.log(`code-dependencies.json: ${inventory.rows.length} (tag, file) references`);
