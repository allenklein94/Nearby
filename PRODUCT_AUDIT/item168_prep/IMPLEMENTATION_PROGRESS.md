# Item 168 implementation tracker (branch item-168-category-pass; owner approved D1-D6 on 2026-10-11)
Release gate: do NOT apply the migration to prod, deploy edge functions, or merge to main (web export) until the owner
verifies mapping, impact, regression tests and rollback plan. Dry runs only, rolled back.
- [x] A. Migration written (supabase/migrations/20270294_v1_category_pass.sql)
- [x] A2. Dry run (migration + scripts/live-verify/v1-category-pass.sql ALL OK, rolled back; prod unchanged: version 1, 241 live) on prod, rolled back, with assertions
- [x] B. Client constants/code (CATEGORY_GROUPS, needs/D3, places, classifier, styles, rail D5, D6 paths, synonyms, max-5 UI, customer-only pickers, league format)
- [x] C. Edge functions (3 VALID_CATEGORIES + prompt), not deployed
- [x] D. Translations (translations_v1.json; bizDash3 upToFiveCategories; gatheringOptions league) (11 languages)
- [x] E. Web export (branch only): docs/business.html signup page (V1 group list, customer-only tags not offered, max 5 in all; regenerated, code-dependencies.json rebuilt) and the Expo business export docs/business/ regenerated
- [x] F. Tests updated + src/constants/v1CategoryPass.regression.test.js; jest 407 suites all pass; journeys 20/20 (live schema, pre-migration)
- [ ] G. Migration + rollback runbook; impact query re-run
- [ ] H. Full diff review
