// Item 139: "this object is gone (or no longer yours to see)" is not the same as "the load failed". A push tap or link can
// name an object that was deleted, or that RLS no longer lets this person read; the screen must say so plainly and offer a
// way back, never a Try Again that can only fail again, and never open some other screen instead.
// PostgREST answers `.single()` on zero rows with PGRST116; RLS hides a row the same way, so both read as not found.
export const NOT_FOUND = 'not_found';

export function notFoundError() {
  const e = new Error('This is no longer available.');
  e.code = NOT_FOUND;
  return e;
}

export function isNotFound(e) {
  return !!e && (e.code === NOT_FOUND || e.code === 'PGRST116');
}

// For a `.single()` result: a missing row becomes notFoundError(); any other error is rethrown as before.
export function throwSingleError(error) {
  if (!error) return;
  if (isNotFound(error)) throw notFoundError();
  throw new Error(error.message);
}
