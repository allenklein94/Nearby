# Version policy hardening (owner, 2026-11-27: merge after the remaining safeguards)

Branch release/version-policy. 0434 stays in place (no renumbering). Production enforcement stays OFF.

- [x] Strict mode for unidentified clients (c23328443)
- [x] Edge functions: shared probe in the 23 app-called functions (b08e657bb); client functionFetch + 426 handling (7c7edbaf4)
- [x] Cached required screen re-checks every 30 s in front, released when lowered/off (7c7edbaf4)
- [x] Strict mode: static GitHub Pages endpoints (invite, occasion-invite, shared-night, track, business.html) exempt by path (690fe295e)
- [x] Storage writes covered (restrictive policy, non-raising check) + real Storage API test (690fe295e, 2941afc01)
- [x] Owner script: strict on/off with approval code (690fe295e, 6815ae2b9)
- [x] deploy.js: server floor substitutes only with strict on AND the migration touches nothing uncovered (auth, realtime, static-page endpoints, unwired edge functions) (690fe295e)
- [ ] Full rerun: Jest, journeys, replay, rollback, compat, exports
- [x] Docs: CLAUDE.md, inventory, process, approval packet, device checklist (0264a79df; CLAUDE.md pending)
- [ ] Merge to main + push
- [x] Edge guard: every app-called edge function asks the gate or is exempt with a reason (4c23fed47)
