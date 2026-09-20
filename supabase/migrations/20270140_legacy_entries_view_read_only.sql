-- relationship_legacy_entries_public: make the anonymized "wisdom library" view genuinely READ-ONLY.
--
-- 20260816_audit_leftover_fixes made this view owner-rights ON PURPOSE (the base table's SELECT policy is
-- closed; the view exposes only the five anonymized columns). That design stays. The bug: the view also
-- carried Supabase's default blanket grants, and a simple view is auto-updatable, so INSERT/UPDATE/DELETE
-- through it ran with the OWNER's privileges and bypassed RLS -- verified live (rolled back): an anonymous
-- caller could UPDATE and DELETE any entry. Only the client's own base-table insert (RLS-checked, match
-- participants only) is a legitimate write.
--
-- Also: reads are for signed-in users only. The one client reader (getLegacyEntries) runs signed in, and these
-- are personal relationship reflections, so anon no longer needs SELECT.

revoke all on public.relationship_legacy_entries_public from anon, authenticated;
grant select on public.relationship_legacy_entries_public to authenticated;
