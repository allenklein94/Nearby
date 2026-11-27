// Trust & safety N6 (owner, 2026-10-28): other people's profile details come only from people_visible_to_me /
// dating_candidates_visible_to_me. Once migration 20270348 is live those views return `age` (never the birthdate) and
// leave gender / ethnicity empty when the person hid them. Before it is live they have no `age` column (the server
// answers 42703), so the SAME read runs again with the birthdate, and the rows are shaped exactly like the new views'
// rows: `age` computed here, the birthdate and the hide switches dropped, a hidden gender / ethnicity emptied. Callers
// only ever see `age`. Wraps selectWithIdVerified, so a missing id_verified column is still retried too.
import { selectWithIdVerified } from './idVerifiedColumn';

export function isMissingAge(error) {
  return !!error && error.code === '42703' && /\bage\b/.test(String(error.message || ''));
}

export function ageFromBirthdate(birthdate, today = new Date()) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age -= 1;
  return age;
}

const listOf = (columns) => columns.split(',').map((c) => c.trim()).filter(Boolean);

// The pre-N6 column list: age -> birthdate, plus the hide switches for any gender / ethnicity column asked for.
export function legacyColumns(columns) {
  const cols = listOf(columns).map((c) => (c === 'age' ? 'birthdate' : c));
  if (cols.includes('gender') && !cols.includes('gender_hidden')) cols.push('gender_hidden');
  if (cols.includes('ethnicity') && !cols.includes('ethnicity_hidden')) cols.push('ethnicity_hidden');
  return cols.join(', ');
}

export function shapeLegacyRow(row, columns, today = new Date()) {
  if (!row) return row;
  const asked = new Set(listOf(columns));
  const out = { ...row };
  if (asked.has('age')) out.age = ageFromBirthdate(row.birthdate, today);
  if (out.gender_hidden) { if ('gender' in out) out.gender = null; if ('gender_identity' in out) out.gender_identity = null; if ('interested_in_genders' in out) out.interested_in_genders = null; }
  if (out.ethnicity_hidden && 'ethnicity' in out) out.ethnicity = null;
  for (const c of ['birthdate', 'gender_hidden', 'ethnicity_hidden']) if (!asked.has(c)) delete out[c];
  return out;
}

const HIDE_SWITCHES = ['gender_hidden', 'ethnicity_hidden'];
export function isMissingHideSwitch(error) {
  return !!error && error.code === '42703' && /\b(gender_hidden|ethnicity_hidden)\b/.test(String(error.message || ''));
}

// Before 20270348, dating_candidates_visible_to_me passes gender / ethnicity through RAW and has no hide switches (only
// people_visible_to_me has them), so the legacy read above fails on the switch column (42703) and Dating Browse / Crossed
// Paths came back empty (found by the release compatibility run, 2026-11-27; live on production for build 87). The
// switches are then read for those people from people_visible_to_me; a person whose switches can't be read is treated as
// having hidden both (never shown by default).
async function readHideSwitches(ids) {
  const { supabase } = require('./supabase');
  const { data, error } = await supabase.from('people_visible_to_me').select('id, gender_hidden, ethnicity_hidden').in('id', ids);
  if (error || !Array.isArray(data)) return null;
  return new Map(data.map((r) => [r.id, r]));
}

// run(columns) builds and awaits the query (single row or list); returns { data, error } with rows shaped as above.
export async function selectPeople(run, columns, switchReader = readHideSwitches) {
  const first = await selectWithIdVerified(run, columns);
  if (!isMissingAge(first?.error)) return first;
  const legacy = legacyColumns(columns);
  let res = await selectWithIdVerified(run, legacy);
  let switches = null;
  const retried = isMissingHideSwitch(res?.error);
  if (retried) {
    const cols = listOf(legacy).filter((c) => !HIDE_SWITCHES.includes(c));
    if (!cols.includes('id')) cols.push('id');
    res = await selectWithIdVerified(run, cols.join(', '));
    if (res?.error || !res?.data) return res;
    const rows = Array.isArray(res.data) ? res.data : [res.data];
    switches = await switchReader(rows.map((r) => r.id).filter(Boolean)).catch(() => null);
  }
  if (res?.error || !res?.data) return res;
  const asked = new Set(listOf(columns));
  const shape = (r) => {
    if (!r || !retried) return shapeLegacyRow(r, columns);
    const sw = switches?.get(r.id);
    const out = shapeLegacyRow({ ...r, gender_hidden: sw ? !!sw.gender_hidden : true, ethnicity_hidden: sw ? !!sw.ethnicity_hidden : true }, columns);
    if (!asked.has('id')) delete out.id;
    return out;
  };
  const data = Array.isArray(res.data) ? res.data.map(shape) : shape(res.data);
  return { ...res, data };
}
