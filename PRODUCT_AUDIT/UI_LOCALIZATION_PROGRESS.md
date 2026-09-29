# UI localization pass 5 — progress tracker (started 2026-09-29)

Scope (owner, 2026-09-29): all ordinary consumer UI text. Excluded: business experience, admin, legal, data (names, business titles,
user text, canonical values, server-composed push bodies). Inventory: `UI_STRING_INVENTORY_2026-09-29.md`.

How: `src/i18n/ui/<ns>.js` (11 languages) merged as `translations.<lang>.ui`; screens call `t('ui.<ns>.<key>')`, code outside components
`tr()`. Dates/times/distances/counts via `src/i18n/display.js`. A converted file is added to `ui/coverage.js` `LOCALIZED_FILES`, and
`uiInventory.test.js` then fails on any English literal left in it (`scripts/i18n/uiInventory.js`). Guards: `uiStrings.test.js`.

## Done
- infra (translate `tr`, ui merge, display wrappers, common namespace, scanner, tests)
- PlansScreen (ns `plans`)
- shared components (ns `shared`): LoadErrorState, DraftBanner, OnboardingTopBar, TabHeaderActions, GatheringStatusBadge, planStatus labels, recoverableError copy (sentence pair per `what` phrase)
- action labels + consumer confirmations (ns `actions`): primaryAction consumer CTAs/statuses, viewLabel, invite/Interested toasts; business-side labels stay English (tested)
- Home (ns `home` + `homeParts`): the screen, plus the helper lines it shows (greeting, quick picks, weekly recap, quick stats, insight lines + meet-tonight, load notice, first-run line, weather card, upcoming-world rows, occasion due/recall lines, goal shortcuts, spots-left labels); dates via `displayHeroWhen`; shared list joiner `i18n/list.js`. Still English on Home: the smart ask placeholder from a repeated pattern (`formatSmartPlaceholder`), the fuzzy occasion date text (`formatOccasionDateForPrecision`, with Occasions), `intentPhaseCaption` loader captions, Start Something / Quick Picks edit / dining / feedback modals (components pass)
- Discover (ns `discover`): mode/submode/type/result-tab labels, section headings (via `sectionTitle`, friends heading through `localizeReason`), hero badges by code, search box, open-now, weather banner, category view, intent block tags, loaders, story sheet, all a11y labels; new reason key `reasons.goodForWeather` (was a raw English reason). Still English on Discover: labels built by helpers it calls (`intentPhaseCaption`, result subtitles from the resolver, `cuisineLabel` fallback when no translation)
- EmptyCopy (ns `empty`): every consumer empty-state id; business/admin/ai ids stay English (tested)

## Next (in order)
Gatherings, GatheringDetail, Create/EditGathering, Activity, Profile, Settings, AskBusiness, BusinessRequestDetail,
chat screens, onboarding, remaining screens, components.
