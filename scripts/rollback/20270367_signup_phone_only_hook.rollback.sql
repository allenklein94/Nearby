-- Rollback for migration 20270367. FIRST switch the hook off in Auth
-- (NEARBY_SIGNUP_HOOK_APPROVAL=signup-hook-off node scripts/trust-safety/signup-hook-settings.js disable):
-- a configured hook whose function is gone refuses every sign-up, phone included. Then:
drop function if exists public.hook_before_user_created(jsonb);
