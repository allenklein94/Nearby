// People anti-scraping (owner idea 9, 2026-11-01; migration 20270382): Dating Browse reads strangers ONLY through the
// server function browse_dating_candidates, which caps the page and counts the distinct new people it returns per
// account per day. Before 20270382 is live that function does not exist (PostgREST PGRST202 / Postgres 42883), so the
// SAME page is read from dating_candidates_visible_to_me as before. Once it is live the view returns only people the
// viewer already has a reason to see, so the function is the one Browse path.
import { supabase } from './supabase';
import { selectPeople } from './peopleRead';

export function isMissingFunction(error) {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883';
}

// buckets = the ~7-mile area labels (wideAreaLabel); offset/limit = the page (stable id order on both paths).
export async function browseDatingCandidates({ buckets, offset, limit, columns }) {
  const res = await supabase.rpc('browse_dating_candidates', {
    buckets_param: buckets,
    offset_param: offset,
    limit_param: limit,
  });
  if (!isMissingFunction(res?.error)) return { data: res?.data ?? null, error: res?.error ?? null };
  return selectPeople((cols) => supabase
    .from('dating_candidates_visible_to_me')
    .select(cols)
    .in('wide_area', buckets)
    // A stable order is required for paging (item 131 audit).
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1), columns);
}
