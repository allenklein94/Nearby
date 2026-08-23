-- Phase 6 of the "build everything" plan (see CLAUDE.md): a real, one-time
-- first-run demonstration moment on Home, shown once a brand-new account's
-- first real Home load happens. Reuses the exact "shown once, flip a flag,
-- never again" shape profiles.seen_browse_callout already established --
-- a plain, self-editable boolean column, no trusted_update guard needed
-- (matches seen_browse_callout's own posture: purely a client-visible UI
-- flag, not a privileged/security-sensitive field).
alter table public.profiles
  add column if not exists seen_home_first_run_moment boolean not null default false;
