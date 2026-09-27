#!/usr/bin/env node
// Rewrites the taxonomy + synonym copies embedded in docs/business.html from the app constants (the same source the app
// ships). Run after adopting a taxonomy change in code, then rebuild the code inventory and check the export:
//   node scripts/taxonomy/regenerate-signup-export.js && node scripts/taxonomy/build-code-dependencies.js
const fs = require('fs');
const path = require('path');
const { ROOT, requireSrc } = require('./loadSrc');
const { regenerate } = require('./signupExport');

const file = path.join(ROOT, 'docs', 'business.html');
const { CATEGORY_GROUPS } = requireSrc('constants/gatheringCategories.js');
const { seedRows } = requireSrc('constants/categorySynonyms.js');
const before = fs.readFileSync(file, 'utf8');
const after = regenerate(before, CATEGORY_GROUPS, seedRows());
fs.writeFileSync(file, after);
console.log(before === after ? 'docs/business.html already current' : 'docs/business.html regenerated');
