import { supabase } from './supabase';

// Item 89 (CLAUDE.md, "Give the occasion a single shared conversation"):
// a real group chat for a business_request-destined Plan's host, its
// organizers (Item 88), and anyone the host has invited who's actually
// accepted (Item 36's invite_to_business_request, or the older
// propose_group_plan/confirm_group_plan flow) -- replacing scattered 1:1
// DMs for coordinating a shared plan. Mirrors gatheringChat.js's own
// 3-function shape verbatim (same table posture: RLS-enabled with real
// client policies gated by a SECURITY DEFINER predicate, so Realtime's
// postgres_changes can actually deliver a live INSERT -- see
// 20261109_plan_group_chat.sql's own header comment for why this
// deliberately differs from plan_organizers' "zero client policies"
// posture).

// Resolves the real shared Plan behind a business_requests id the caller
// already has on screen (the primary, or any of its Item 81 add-ons --
// the RPC resolves coalesce(parent_request_id, id) internally, same
// convention get_plan_organizers already established). Throws if the
// caller isn't a real participant, or no plan exists yet.
export async function getPlanChatInfo(businessRequestId) {
  const { data, error } = await supabase.rpc('get_plan_chat_info', {
    business_request_id_param: businessRequestId,
  });
  if (error) throw error;
  return data;
}

export async function getPlanParticipants(planId) {
  const { data, error } = await supabase.rpc('get_plan_participants', { plan_id_param: planId });
  if (error) throw error;
  return data;
}

// Paginated, cursor-based fetch backing usePaginatedMessages -- see that
// hook's own header comment for why this shape (newest-first, capped,
// throw-don't-swallow) is shared across every chat-style screen in the
// app.
export async function getPlanMessagesPage(planId, { limit = 50, beforeCreatedAt = null } = {}) {
  let query = supabase
    .from('plan_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) query = query.lt('created_at', beforeCreatedAt);

  const { data, error } = await query;
  if (error) {
    console.error('getPlanMessagesPage error', error);
    throw error;
  }
  return data ?? [];
}

// Single-row fetch (same profiles join) for a realtime INSERT payload,
// which only carries raw table columns.
export async function getPlanMessageById(messageId) {
  const { data, error } = await supabase
    .from('plan_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('id', messageId)
    .single();

  if (error) {
    console.error('getPlanMessageById error', error);
    return null;
  }
  return data;
}

export async function sendPlanMessage(planId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('plan_messages')
    .insert({ plan_id: planId, sender_id: userId, body });

  if (error) throw error;
}
