-- Gathering group chat: a message is visible only when neither the viewer nor the sender has blocked the other.
--
-- The SELECT policy already said "excluding blocked senders either way", but it read `blocks` inline under the
-- VIEWER's RLS, and blocks RLS only shows the blocks the viewer created. So when an attendee blocked the host, the
-- attendee's messages stayed visible to the host (in the chat, and so in the Message count, which is a count-only
-- read of the same rows). Fix: use the one bidirectional helper `viewer_blocked_either_way` (20270138, SECURITY
-- DEFINER, reads blocks as owner, only answers about the CALLER and the given user), the same rule attendee reads use.
--
-- Every client read of gathering_messages goes through this policy (paged history, single-row fetch for a realtime
-- INSERT, the host's count-only read); Supabase Realtime evaluates the same SELECT policy per subscriber. No SECURITY
-- DEFINER function reads gathering_messages. The membership half of the policy and the INSERT policy are unchanged;
-- the caller's own messages stay visible (no one is blocked against themselves).

drop policy if exists "Host and approved attendees can view gathering chat, excluding " on public.gathering_messages;
create policy "Host and approved attendees can view gathering chat, excluding "
  on public.gathering_messages
  as permissive
  for select
  to authenticated
  using (
    (
      exists (select 1 from gatherings g where g.id = gathering_messages.gathering_id and g.host_id = auth.uid())
      or exists (
        select 1 from gathering_interest gi
         where gi.gathering_id = gathering_messages.gathering_id
           and gi.user_id = auth.uid()
           and gi.status = 'approved'
      )
    )
    and not public.viewer_blocked_either_way(gathering_messages.sender_id)
  );
