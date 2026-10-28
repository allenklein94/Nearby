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

// run(columns) builds and awaits the query (single row or list); returns { data, error } with rows shaped as above.
export async function selectPeople(run, columns) {
  const first = await selectWithIdVerified(run, columns);
  if (!isMissingAge(first?.error)) return first;
  const res = await selectWithIdVerified(run, legacyColumns(columns));
  if (res?.error || !res?.data) return res;
  const data = Array.isArray(res.data) ? res.data.map((r) => shapeLegacyRow(r, columns)) : shapeLegacyRow(res.data, columns);
  return { ...res, data };
}
