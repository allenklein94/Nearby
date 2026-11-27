#!/usr/bin/env node
// Design-system audit (owner, 2026-11-27, item 34): READ-ONLY scan of every screen + component style for values that bypass
// the shared tokens in src/theme.js (typography, spacing, radius, shadow, colours) and for controls missing accessibility
// basics. Prints counts; `--json` writes the full findings. Never edits a file.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'src');
const DIRS = ['screens', 'components'];
const SCALE = { fontSize: [34, 26, 20, 16, 13, 12], radius: [8, 14, 20, 999], spacing: [4, 6, 12, 18, 24, 36] };
const files = DIRS.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join(d, f)));
const tally = (m, k, f) => { m[k] = m[k] || { n: 0, files: new Set() }; m[k].n++; m[k].files.add(f); };
const out = { fontSize: {}, fontWeight: {}, radius: {}, padding: {}, hex: {}, inlineShadow: {}, touchNoRole: {}, smallControl: {} };
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)) tally(out.fontSize, m[1], f);
  for (const m of src.matchAll(/fontWeight:\s*'(\d+|bold|normal)'/g)) tally(out.fontWeight, m[1], f);
  for (const m of src.matchAll(/borderRadius:\s*(\d+)/g)) tally(out.radius, m[1], f);
  for (const m of src.matchAll(/(?:padding|margin)(?:Horizontal|Vertical|Top|Bottom|Left|Right)?:\s*(\d+)\b/g)) tally(out.padding, m[1], f);
  for (const m of src.matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/g)) tally(out.hex, m[1].toUpperCase(), f);
  for (const m of src.matchAll(/shadowColor:/g)) tally(out.inlineShadow, 'shadowColor', f);
  // a TouchableOpacity / Pressable opening tag with no accessibilityRole inside it (best effort: up to the closing '>')
  for (const m of src.matchAll(/<(TouchableOpacity|Pressable|TouchableHighlight)\b([^>]*?)>/gs)) {
    if (!/accessibilityRole/.test(m[2]) && !/accessible=\{false\}/.test(m[2])) tally(out.touchNoRole, m[1], f);
  }
  for (const m of src.matchAll(/(\w*(?:[Bb]utton|[Cc]hip|[Bb]tn|[Tt]oggle)\w*):\s*\{([^{}]*)\}/g)) {
    const h = /(?:minHeight|height):\s*(\d+)/.exec(m[2]);
    if (h && Number(h[1]) < 44 && !/hitSlop/.test(src)) tally(out.smallControl, `${m[1]}=${h[1]}`, f);
  }
}
const summarize = (m, scale) => Object.entries(m).sort((a, b) => b[1].n - a[1].n)
  .map(([k, v]) => ({ value: k, uses: v.n, files: v.files.size, onScale: scale ? scale.includes(Number(k)) : undefined }));
const report = {
  files: files.length,
  fontSize: summarize(out.fontSize, SCALE.fontSize),
  fontWeight: summarize(out.fontWeight),
  radius: summarize(out.radius, SCALE.radius),
  spacingLiterals: summarize(out.padding, SCALE.spacing),
  hexColours: summarize(out.hex),
  inlineShadows: summarize(out.inlineShadow),
  touchablesWithoutRole: summarize(out.touchNoRole),
  smallControlsWithoutHitSlop: summarize(out.smallControl),
};
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(report, null, 1)); return; }
const tot = (a, pred = () => true) => a.filter(pred).reduce((s, x) => s + x.uses, 0);
console.log(`files scanned: ${report.files}`);
console.log(`fontSize literals: ${tot(report.fontSize)} (off the 6-step scale: ${tot(report.fontSize, (x) => !x.onScale)}); top:`, report.fontSize.slice(0, 12).map((x) => `${x.value}x${x.uses}`).join(' '));
console.log(`borderRadius literals: ${tot(report.radius)} (off token: ${tot(report.radius, (x) => !x.onScale)}); top:`, report.radius.slice(0, 12).map((x) => `${x.value}x${x.uses}`).join(' '));
console.log(`spacing literals: ${tot(report.spacingLiterals)} (off token: ${tot(report.spacingLiterals, (x) => !x.onScale)})`);
console.log(`hex colours in screens/components: ${tot(report.hexColours)} (${report.hexColours.length} distinct)`);
console.log(`inline shadows: ${tot(report.inlineShadows)} in ${report.inlineShadows[0]?.files ?? 0} files`);
console.log(`touchables without accessibilityRole: ${tot(report.touchablesWithoutRole)}`);
console.log(`button/chip/toggle styles under 44 pt (file has no hitSlop): ${tot(report.smallControlsWithoutHitSlop)}`);
