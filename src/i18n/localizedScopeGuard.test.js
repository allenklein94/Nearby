// Localization pass 5 guard: Jest never renders screens, so a converted file that reads `t`, `language` or a loop variable
// outside the scope that defines it would only fail on a device (a ReferenceError that blanks the screen). This walks every
// localized file and fails on any reference to one of those names that has no binding where it is used.
// (Found 2026-09-30: ProfileScreen's gender chips called basicsOption(field.key, ...) with no `field` in scope.)
import fs from 'fs';
import path from 'path';
import { LOCALIZED_FILES } from './ui/coverage';

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const WATCHED = new Set(['t', 'tr', 'language', 'field', 'option', 'opt', 'item', 'o', 'p', 'g', 'f']);
const TRANSLATION_NAMES = new Set(['t', 'tr', 'language']);
const ROOT = path.join(__dirname, '..', '..');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = `${dir}/${e.name}`;
  if (e.isDirectory()) return walk(rel);
  return /\.js$/.test(e.name) && !/\.test\.js$|\.journey\.js$/.test(e.name) ? [rel] : [];
});

function unboundReferences(file, watched = WATCHED) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const bad = [];
  traverse(ast, {
    ReferencedIdentifier(p) {
      const { name } = p.node;
      if (!watched.has(name) || p.parentPath.isJSXAttribute()) return;
      if (!p.scope.hasBinding(name, true)) bad.push(`${file}:${p.node.loc.start.line} ${name}`);
    },
  });
  return bad;
}

describe('localized files only read t / language / loop variables where they are defined', () => {
  for (const file of LOCALIZED_FILES) {
    test(file, () => { expect(unboundReferences(file)).toEqual([]); });
  }
});

test('no source file reads t / tr / language without defining it', () => {
  const bad = walk('src').flatMap((file) => unboundReferences(file, TRANSLATION_NAMES));
  expect(bad).toEqual([]);
});
