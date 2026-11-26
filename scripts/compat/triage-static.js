// Classifies each call a static check flagged (not ok at that version): does the code around it handle the missing
// function / column? node triage-static.js <app src dir> <version.static.txt>
//   fallback  = an explicit missing-function / missing-column branch near the call (isMissingFunction, PGRST202, 42883,
//               42703, PGRST204, missingColumn, withoutColumn, selectWithIdVerified, selectPeople ...)
//   degrades  = the error is caught or checked and the function returns an empty / null / false result (no throw)
//   THROWS    = neither: the caller gets an error (a screen shows its error / Try Again). Needs a reachability check.
const fs = require('fs'), path = require('path');
const [root, file] = process.argv.slice(2);
const FALLBACK = /isMissingFunction|isMissingColumn|PGRST202|PGRST204|42883|42703|missingColumn|withoutColumn|selectWithIdVerified|selectPeople|optionalProfileColumns|readOptional|notInstalled|not_installed/;
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter((l) => !l.includes('| ok |'));
const out = { fallback: [], degrades: [], THROWS: [] };
for (const l of rows) {
  const [kind, result, name, detail, at] = l.split(' | ').map((s) => s.trim());
  const [f, line] = at.split(':'); const src = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  const n = Number(line) - 1;
  // the enclosing function: back to the nearest line starting a function, forward to the next top-level close brace
  let a = n; while (a > 0 && !/^(export )?(async )?function |^\s*(const|let) \w+ = (async )?\(|^export const \w+ = /.test(src[a])) a--;
  let b = n; while (b < src.length - 1 && !/^}/.test(src[b])) b++;
  const body = src.slice(a, b + 1).join('\n');
  const near = src.slice(Math.max(0, n - 12), n + 14).join('\n');
  const cls = FALLBACK.test(body) ? 'fallback'
    : (/catch\s*(\(|\{)|if \(error\)\s*(return|\{\s*(console\.\w+\([^)]*\);\s*)?return)|\.catch\(\(\) =>|\?\? \[\]|error \? (null|\[\]|false)/.test(near) && !/throw /.test(near) ? 'degrades' : 'THROWS');
  out[cls].push(`${kind} ${name} (${result}) ${at}`);
}
for (const k of Object.keys(out)) { console.log(`## ${k}: ${out[k].length}`); for (const r of out[k]) console.log('  ' + r); }
