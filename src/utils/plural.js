// The one place a count gets its noun (rule 7: "1 people going" is the UI
// disagreeing with its own data). countLabel(1, 'person', 'people') -> "1 person".
// A non-numeric count returns null so callers print nothing, never "NaN spots".
export function countLabel(n, singular, pluralForm = `${singular}s`) {
  const num = Number(n);
  if (n == null || n === '' || !Number.isFinite(num)) return null;
  return `${num} ${num === 1 ? singular : pluralForm}`;
}
