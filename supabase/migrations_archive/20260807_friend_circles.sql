-- Closes roadmap Phase 5 "Friend Circles": FriendsScreen.js has always been
-- a flat list, with no grouping concept (Work/Fitness/Family/Travel-style)
-- anywhere in the schema. This is real, useful, no-new-signal work (unlike
-- AI Concierge/Momentum, nothing here is invented or needs an LLM), so it's
-- built directly rather than flagged for a separate review.
create table friend_circles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

alter table friend_circles enable row level security;

create policy "Users manage their own friend circles"
  on friend_circles for all
  using (auth.uid() = user_id);

-- A join table, not a column on friendships, since one friend can belong
-- to several circles (e.g. someone who's both "Work" and "Fitness") and a
-- circle only ever makes sense relative to its owner's own friend list —
-- friend_user_id is intentionally not constrained to an existing
-- friendship row, same looseness the doc's own Work/Fitness/Family/Travel
-- examples imply (a lightweight personal label, not a second relationship
-- table to keep in sync).
create table friend_circle_members (
  id uuid primary key default uuid_generate_v4(),
  circle_id uuid references friend_circles(id) on delete cascade,
  friend_user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (circle_id, friend_user_id)
);

alter table friend_circle_members enable row level security;

-- Ownership is via the parent circle's user_id, same indirect-ownership
-- shape already used elsewhere in this schema for join/detail tables.
create policy "Users manage members of their own circles"
  on friend_circle_members for all
  using (exists (select 1 from friend_circles where id = circle_id and user_id = auth.uid()));
