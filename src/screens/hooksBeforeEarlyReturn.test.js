// Rules of hooks, the crash kind (found 2026-10-11 while building item 25 #4): BusinessRequestDetail called useMemo/useRef/
// useState BELOW its "if (loading && !request) return <loader>" lines, so the render after loading called more hooks than
// the first one and React throws ("Rendered more hooks than during the previous render"). It was never caught because the
// app has never run on a device. Source scan: inside a top-level component, no hook after its first early return.
const fs = require('fs');
const path = require('path');

const DIRS = ['screens', 'components', 'motion'];

function offenders() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(__dirname, '..', d);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js') || f.includes('.test.')) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
      let inComp = false;
      let early = null;
      lines.forEach((l, i) => {
        if (/^(export default )?function [A-Z]\w*\(/.test(l)) { inComp = true; early = null; return; }
        if (/^}/.test(l)) { inComp = false; early = null; return; }
        if (!inComp) return;
        if (early == null && /^ {2}if \(.*\)\s*(return\b|\{\s*$)/.test(l)) {
          if (/return\b/.test(l) || /^ {4}return\b/.test(lines[i + 1] || '')) early = i;
          return;
        }
        if (early != null && /^ {2}(const|let) .*\buse[A-Z]\w*\(|^ {2}use[A-Z]\w*\(/.test(l)) out.push(`${d}/${f}:${i + 1}`);
      });
    }
  }
  return out;
}

test('no component calls a hook after an early return', () => {
  expect(offenders()).toEqual([]);
});
