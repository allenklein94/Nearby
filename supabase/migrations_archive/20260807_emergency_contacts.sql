-- Closes the "emergency contact" half of roadmap #15 (Safety). The other
-- half — a date safety check-in flow with a scheduled local reminder and a
-- one-tap "share my plans" message — already existed (date_checkins,
-- services/dateSafety.js, DateCheckInModal.js), just under different names
-- than the ones originally grepped for. What's genuinely new here is a
-- persistent, reusable emergency contact so the user isn't required to
-- pick a share recipient from scratch every single time.
create table emergency_contacts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id) on delete cascade,
  name text not null,
  phone text not null,
  relationship text,
  created_at timestamptz default now()
);

alter table emergency_contacts enable row level security;

-- Same shape as the existing "Users manage their own check-ins" policy on
-- date_checkins (this codebase's established owner-scoped RLS pattern for a
-- personal-safety table) — one ALL policy, no separate WITH CHECK needed.
create policy "Users manage their own emergency contacts"
  on emergency_contacts for all
  using (auth.uid() = user_id);
