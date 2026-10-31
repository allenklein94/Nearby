#!/usr/bin/env node
// Language calibration for user-content screening (migration 20270373). Runs the calibration set
// (src/utils/ugcCalibration.js) through the REAL classifier and reports, per language, whether it passes the proposed rule.
// It writes NOTHING to any database: a passing run only PROPOSES an activation migration (a file in --out) that the owner
// approves and deploys through deploy.js. Until then every language stays 'pending' = held for a person.
//
// The classifier is the edge function's own module (supabase/functions/_shared/userContentClassifier.ts), transpiled and
// loaded here unchanged, so the prompt and model can't drift from what production runs.
//
// GATED: a controlled environment, owner-approved (it sends the set's texts to Anthropic; ~200 short calls):
//   NEARBY_UGC_CALIBRATION_APPROVED=1 ANTHROPIC_API_KEY=... node scripts/trust-safety/ugc-calibration.js --out <dir>
//   [--repeats 3] [--only en,es]
// The key comes from the environment only (never a file in the repo, never printed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');
const { CALIBRATION_SET, PASS_RULE, evaluateCalibration, activationSql } = require('../../src/utils/ugcCalibration');

const CLASSIFIER = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'userContentClassifier.ts');

function loadClassifier(env = process.env) {
  const source = fs.readFileSync(CLASSIFIER, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  const Deno = { env: { get: (k) => env[k] } };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'Deno', outputText)(mod, mod.exports, require, Deno);
  return mod.exports;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const out = flag('--out');
  const repeats = Number(flag('--repeats') || PASS_RULE.repeats);
  const only = flag('--only') ? flag('--only').split(',') : null;
  if (process.env.NEARBY_UGC_CALIBRATION_APPROVED !== '1') {
    console.error('Refused: set NEARBY_UGC_CALIBRATION_APPROVED=1 (owner-approved run in a controlled environment).');
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Refused: ANTHROPIC_API_KEY is not set.'); process.exit(2); }
  if (!out) { console.error('usage: --out <dir> is required'); process.exit(2); }
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) { console.error('--repeats must be 1-10'); process.exit(2); }

  const { classifyUserText, USER_CONTENT_MODEL } = loadClassifier();
  const set = CALIBRATION_SET.filter((s) => !only || only.includes(s.language));
  const runs = [];
  for (const sample of set) {
    for (let r = 0; r < repeats; r += 1) {
      const verdict = await classifyUserText(sample.text, sample.kind);
      runs.push({ language: sample.language, expect: sample.expect, label: sample.label, repeat: r, verdict });
      process.stdout.write(verdict ? '.' : 'x');
    }
  }
  process.stdout.write('\n');
  const results = evaluateCalibration(runs);
  if (only) for (const l of Object.keys(results)) if (!only.includes(l)) delete results[l];

  fs.mkdirSync(out, { recursive: true });
  const report = { ranAt: new Date().toISOString(), model: USER_CONTENT_MODEL, rule: PASS_RULE, repeats, results, runs };
  const body = JSON.stringify(report, null, 2);
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  fs.writeFileSync(path.join(out, 'ugc-calibration-report.json'), body);
  const sql = activationSql(results, `ugc-calibration ${report.ranAt} ${USER_CONTENT_MODEL} report sha256:${digest}`);
  if (sql) fs.writeFileSync(path.join(out, 'ugc-calibration-activation.PROPOSED.sql'), sql);

  for (const [language, r] of Object.entries(results)) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${language.padEnd(5)} harmful low ${r.harmfulLow}/${r.harmful} (high ${r.harmfulHigh}), `
      + `benign low ${r.benignLow}/${r.benign}, language ${r.languageMatch}/${r.answered}${r.reasons.length ? `  <- ${r.reasons.join('; ')}` : ''}`);
  }
  console.log(`\nreport: ${path.join(out, 'ugc-calibration-report.json')} (sha256 ${digest})`);
  console.log(sql ? `proposed activation (NOT applied): ${path.join(out, 'ugc-calibration-activation.PROPOSED.sql')}` : 'no language passed: nothing proposed');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { loadClassifier };
