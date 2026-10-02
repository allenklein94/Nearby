-- Community chat: a message is visible only when neither the viewer nor the sender has blocked the other.
--
-- Same defect and same fix as gathering chat (20270263): the SELECT policy read `blocks` inline under the VIEWER's RLS,
-- and blocks RLS only shows the blocks the viewer created, so a member who was blocked by a sender still read that
-- sender's messages. It now calls the one bidirectional helper `viewer_blocked_either_way` (20270138, SECURITY
-- DEFINER, answers only about the CALLER and the given user).
--
-- Every read of community_messages goes through this policy: the paged history, the by-id fetch a realtime INSERT
-- triggers, Home's "Continue Communities" recent-message count, and Supabase Realtime itself. No SECURITY DEFINER
-- function reads community_messages. Membership half of the policy and the INSERT policy are unchanged.

drop policy if exists "Members can view community chat, excluding blocked senders" on public.community_messages;
create policy "Members can view community chat, excluding blocked senders"
  on public.community_messages
  as permissive
  for select
  to authenticated
  using (
    exists (
      select 1 from community_members cm
       where cm.community_id = community_messages.community_id
         and cm.user_id = auth.uid()
    )
    and not public.viewer_blocked_either_way(community_messages.sender_id)
  );
