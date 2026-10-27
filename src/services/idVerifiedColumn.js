// The Verified badge reads id_verified (trust & safety fix 3), a column that exists only once its migration is live. A
// build installed BEFORE that deploy (the Session B TestFlight build) would otherwise lose these whole reads: today the
// server answers 42703 "column ….id_verified does not exist", so Friends Browse, Dating discovery and a profile would come
// back empty. ONE rule for every read that names it: run the read with id_verified; only when the server says THAT column
// is missing, run the same read again without it. The rows then carry no id_verified, so no badge shows (unknown =
// nothing; photo_verified is never a stand-in). Once the migration is live the first read always succeeds.
export function isMissingIdVerified(error) {
  return !!error && error.code === '42703' && /\bid_verified\b/.test(String(error.message || ''));
}

export function withoutIdVerified(columns) {
  return columns.split(',').map((c) => c.trim()).filter((c) => c && c !== 'id_verified').join(', ');
}

// run(columns) builds and awaits the query; returns its { data, error }.
export async function selectWithIdVerified(run, columns) {
  const first = await run(columns);
  if (!isMissingIdVerified(first?.error)) return first;
  return run(withoutIdVerified(columns));
}
