-- Rollback for 20270410: drops get_my_familiar_hosts. A new build on the rolled-back database reads no familiarity (the call
-- fails = an empty map), so every ranking is exactly as before 0410; nothing was stored, so nothing else to undo.
drop function if exists public.get_my_familiar_hosts();
