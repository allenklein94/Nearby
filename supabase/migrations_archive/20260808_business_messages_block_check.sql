-- business_messages had no blocks enforcement at all on either INSERT
-- policy, unlike every comparable messaging path in this codebase: the
-- regular 1:1 messages table's own INSERT policy checks not is_blocked(...),
-- and invite_friend_to_gathering/send_social_invite both check blocks before
-- sending. A blocked pair could still message each other through business
-- conversations in both directions (a follower to a business owner who
-- blocked them, or a business owner to a follower who blocked them) -- the
-- SELECT policy already correctly filters blocked senders out of a reader's
-- own view, but that just hides the message from the blocker, it doesn't
-- stop it from being sent/stored in the first place.
drop policy if exists "Business owners can reply within an existing conversation" on public.business_messages;
create policy "Business owners can reply within an existing conversation"
on public.business_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and from_business = true
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.managed_partner_id = business_messages.partner_id
  )
  and not is_blocked(auth.uid(), conversation_with_id)
);

drop policy if exists "Followers can message a business they follow" on public.business_messages;
create policy "Followers can message a business they follow"
on public.business_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and from_business = false
  and conversation_with_id = auth.uid()
  and exists (
    select 1 from business_followers bf
    where bf.brand_partner_id = business_messages.partner_id and bf.user_id = auth.uid()
  )
  and not exists (
    select 1 from profiles p2
    where p2.managed_partner_id = business_messages.partner_id
    and is_blocked(auth.uid(), p2.id)
  )
);
