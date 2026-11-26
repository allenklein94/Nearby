// The location this device's Business Mode is SHOWING (multi-location, migration 20270426, STAGED). Sent to the server
// with every REST request as x-nearby-business; the server refuses the request when the account's selected location is
// no longer that one (another device or the website switched it), so a stale screen can never write to the other
// location. The header can only refuse, never grant: the server never trusts it for permission.
//
// claim(id) when Business Mode has loaded a location; release(token) when that Business Mode goes away (only the claim
// that is still current is released, so a late load from an unmounted screen can't clear a newer claim). A refusal
// clears the claim and tells the listeners (Business Mode reloads for the location the server has selected).

export const ACTING_BUSINESS_HEADER = 'x-nearby-business';
export const SELECTION_CHANGED_HINT = 'business_selection_changed';
// Switching and listing must work from a stale screen (that is how it recovers): never sent there.
const UNSCOPED_RPCS = ['/rpc/select_managed_business', '/rpc/get_my_businesses', '/rpc/note_location_aware_session'];

let current = null;
let generation = 0;
const listeners = new Set();

export function claimActingBusiness(partnerId) {
  generation += 1;
  current = typeof partnerId === 'string' && partnerId ? partnerId : null;
  return generation;
}

export function releaseActingBusiness(token) {
  if (token === generation) current = null;
}

export function actingBusiness() {
  return current;
}

export function onSelectionChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Header for one request, or null (not a REST call, an unscoped RPC, or no location claimed).
export function actingBusinessHeaderFor(url) {
  if (!current || typeof url !== 'string') return null;
  const at = url.indexOf('/rest/v1/');
  if (at < 0) return null;
  const path = url.slice(at + '/rest/v1'.length).split('?')[0];
  if (UNSCOPED_RPCS.includes(path)) return null;
  return current;
}

export function isSelectionChangedError(body) {
  return !!body && typeof body === 'object' && body.hint === SELECTION_CHANGED_HINT;
}

function selectionChanged() {
  current = null;
  generation += 1;
  listeners.forEach((l) => { try { l(); } catch { /* a listener never breaks the request */ } });
}

// Wraps fetch for the Supabase client: adds the header to REST calls while a location is claimed, and notices the
// server's refusal (the response itself is returned unchanged, so the caller's own error handling still runs).
export function withActingBusiness(baseFetch) {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    const id = actingBusinessHeaderFor(url);
    if (!id) return baseFetch(input, init);
    const headers = new Headers(init?.headers ?? (typeof input === 'object' ? input?.headers : undefined));
    headers.set(ACTING_BUSINESS_HEADER, id);
    const response = await baseFetch(input, { ...init, headers });
    if (response.status === 400) {
      try {
        if (isSelectionChangedError(await response.clone().json()) && current === id) selectionChanged();
      } catch { /* not JSON: not ours */ }
    }
    return response;
  };
}
