// Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
// plan, Phase H) -- a general consumer Occasions object, additive to the
// already-real, already-live birthday nudge (services/friends.js's
// getUpcomingConnectedBirthdays -- left completely untouched). This
// covers the 5 other real, previously-unbuilt types: anniversary,
// graduation, milestone, life_event, other.
import { supabase } from './supabase';

export async function getMyOccasions() {
  const { data, error } = await supabase
    .from('occasions')
    .select('*')
    .order('occasion_date', { ascending: true });
  if (error) {
    console.error('getMyOccasions error', error);
    return [];
  }
  const occasions = data ?? [];
  // State-machine audit gap 4: "Planned" must follow the Plan's live status, not merely that a plan was ever made.
  const planIds = occasions.map((o) => o.resulting_plan_id).filter(Boolean);
  if (planIds.length === 0) return occasions;
  const { data: plans } = await supabase.from('plans').select('id, status').in('id', planIds);
  const cancelled = new Set((plans ?? []).filter((pl) => pl.status === 'cancelled').map((pl) => pl.id));
  return occasions.map((o) => (o.resulting_plan_id && cancelled.has(o.resulting_plan_id) ? { ...o, plan_cancelled: true } : o));
}

export async function addOccasion({ occasionType, title, occasionDate, recursAnnually = true, connectedUserId = null, whoForName = null, whoForFriendId = null, surpriseMode = false, importedFromCalendar = false, datePrecision = 'exact' }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  const { data, error } = await supabase
    .from('occasions')
    .insert({
      user_id: user.id,
      occasion_type: occasionType,
      title,
      occasion_date: occasionDate,
      // Item 98 (CLAUDE.md, "Don't require exact dates"): controls how
      // occasion_date is interpreted/displayed downstream -- see
      // src/utils/occasionDatePrecision.js. `occasionDate` should already
      // be normalized for this precision (normalizeOccasionDateForPrecision)
      // before it ever reaches here.
      date_precision: datePrecision,
      recurs_annually: recursAnnually,
      // Item 65: structurally impossible to share a surprise occasion with
      // the person it's for -- also enforced by a DB CHECK constraint, but
      // pre-empted here so a caller never even hits that error.
      connected_user_id: surpriseMode ? null : connectedUserId,
      who_for_name: whoForName,
      who_for_friend_id: whoForFriendId,
      surprise_mode: surpriseMode,
      // Item 75: a pure provenance marker -- true only when this row was
      // created from an explicitly-picked device calendar event (see
      // deviceCalendar.js's own header comment for the full privacy
      // boundary this supports).
      imported_from_calendar: importedFromCalendar,
    })
    .select()
    .single();
  if (error) {
    console.error('addOccasion error', error);
    return { error: error.message };
  }
  return { data };
}

// "Occasion architecture should not be a silo" (CLAUDE.md, direct user
// request): once the wizard's own downstream hand-off actually creates a
// real gathering/business_request, this links the occasion to the real
// `plans` row that object's own existing trigger already created --
// closing the loop so "Nearby remembers... and helps you make it happen"
// is a real, queryable fact, not just a one-way fire-and-forget. Best-
// effort by design (see link_occasion_to_plan's own SQL comment) -- always
// called after the real creation already succeeded, never blocking it.
export async function linkOccasionToPlan({ occasionId, resultingGatheringId = null, resultingBusinessRequestId = null }) {
  const { error } = await supabase.rpc('link_occasion_to_plan', {
    occasion_id_param: occasionId,
    resulting_gathering_id_param: resultingGatheringId,
    resulting_business_request_id_param: resultingBusinessRequestId,
  });
  if (error) console.error('linkOccasionToPlan error', error);
}

// Item 62 (CLAUDE.md): "whether reminders are enabled" is a real per-
// occasion control, not just the blanket notify_social category toggle --
// a plain owner-scoped update (the table's own RLS policy already covers
// UPDATE via "for all"), same posture as delete/add above. Never touches
// any other occasion or preference.
export async function setOccasionReminderEnabled(occasionId, enabled) {
  const { error } = await supabase.from('occasions').update({ reminder_enabled: enabled }).eq('id', occasionId);
  if (error) {
    console.error('setOccasionReminderEnabled error', error);
    return false;
  }
  return true;
}

// Item 96 (CLAUDE.md, "Add surprise mode... Eventually: Reveal plan becomes
// an action"): owner-only. Flips surprise_mode off and -- now legal, since
// the CHECK constraint only blocks connected_user_id + surprise_mode
// together while surprise_mode is still true -- turns ON sharing with the
// real connected friend this occasion is for (the same mechanism Items
// 62/63 already built for "share this too"), plus a real reveal push.
export async function revealOccasion(occasionId) {
  const { data, error } = await supabase.rpc('reveal_occasion', {
    occasion_id_param: occasionId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteOccasion(occasionId) {
  const { error } = await supabase.from('occasions').delete().eq('id', occasionId);
  if (error) {
    console.error('deleteOccasion error', error);
    return false;
  }
  return true;
}

// Real, dismissible, days-ahead window -- own occasions plus a real
// connected person's occasion where the caller is genuinely still a
// friend/match (re-checked server-side at read time, not assumed from
// creation time).
export async function getUpcomingOccasions(daysAhead = 30) {
  const { data, error } = await supabase.rpc('get_upcoming_occasions', {
    days_ahead_param: daysAhead,
  });
  if (error) {
    console.error('getUpcomingOccasions error', error);
    return [];
  }
  // Item 104 (CLAUDE.md): get_upcoming_occasions() itself has no ORDER BY
  // (a plain plpgsql loop over an unordered query) -- every existing
  // caller that reads occasions[0] as "the soonest" (HomeScreen's own
  // occasion nudge) has been relying on incidental row order, a real,
  // previously-latent bug surfaced while building the "Upcoming in your
  // world" widget, which genuinely needs a correctly sorted list. Fixed
  // once here so every caller gets it for free.
  return (data ?? []).slice().sort((a, b) => a.days_until - b.days_until);
}

// Item 101 (CLAUDE.md, "Occasions can become recurring"): a real, owner-only
// recall of what actually happened the last time this occasion was
// fulfilled -- resolved server-side from the occasion's own resulting_plan_id
// chain (see get_occasion_recall()'s own migration comment). Best-effort:
// returns null on any failure, never blocks or errors the caller -- this
// enriches a "Plan Again" moment, it never gates it.
export async function getOccasionRecall(occasionId) {
  const { data, error } = await supabase.rpc('get_occasion_recall', {
    occasion_id_param: occasionId,
  });
  if (error) {
    console.error('getOccasionRecall error', error);
    return null;
  }
  return data ?? null;
}

// Item 102 (CLAUDE.md, "Businesses can participate in recurring
// occasions"): the consumer's own real, explicit, per-occasion consent
// that the business behind a real recall may recognize them as a
// returning customer next time -- default OFF, same "share this too,
// opt-in" posture Item 62's connected_user_id checkbox already
// established. A plain owner-scoped update (the table's own RLS policy
// already covers UPDATE), same posture as setOccasionReminderEnabled.
export async function setOccasionRecallShareable(occasionId, shareable) {
  const { error } = await supabase.from('occasions').update({ recall_shareable_with_business: shareable }).eq('id', occasionId);
  if (error) {
    console.error('setOccasionRecallShareable error', error);
    return false;
  }
  return true;
}
