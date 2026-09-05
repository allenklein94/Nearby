// Group Insights plan (2026-09-18) -- client-side mirrors of
// get_gathering_group_insights()'s own real thresholds (see the migration,
// supabase/migrations/20260918_gathering_group_insights.sql), used only for
// UI copy decisions (e.g. an empty-state hint like "unlocks at N
// attendees"). Never used to re-derive or re-threshold a number the RPC
// didn't send -- the RPC is the single source of truth for tiering.
export const GROUP_MAKEUP_MIN_ATTENDEES = 3;
export const DATING_GROUP_MAKEUP_MIN_ATTENDEES = 15;
export const PRECISE_MIN_ATTENDEES = 10;
