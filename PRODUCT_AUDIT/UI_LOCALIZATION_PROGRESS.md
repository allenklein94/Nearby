# UI localization pass 5 — progress tracker (started 2026-09-29)

Scope (owner, 2026-09-29): all ordinary consumer UI text. Excluded: business experience, admin, legal, data (names, business titles,
user text, canonical values, server-composed push bodies). Inventory: `UI_STRING_INVENTORY_2026-09-29.md`.

How: `src/i18n/ui/<ns>.js` (11 languages) merged as `translations.<lang>.ui`; screens call `t('ui.<ns>.<key>')`, code outside components
`tr()`. Dates/times/distances/counts via `src/i18n/display.js`. A converted file is added to `ui/coverage.js` `LOCALIZED_FILES`, and
`uiInventory.test.js` then fails on any English literal left in it (`scripts/i18n/uiInventory.js`). Guards: `uiStrings.test.js`.

## Done
- infra (translate `tr`, ui merge, display wrappers, common namespace, scanner, tests)
- PlansScreen (ns `plans`)

## Next (in order)
shared copy modules (EmptyCopy registry, PlanCard/status labels, LoadErrorState, recoverableError, primaryAction, confirmations),
Home, Discover, Gatherings, GatheringDetail, Create/EditGathering, Activity, Profile, Settings, AskBusiness, BusinessRequestDetail,
chat screens, onboarding, remaining screens, components.
