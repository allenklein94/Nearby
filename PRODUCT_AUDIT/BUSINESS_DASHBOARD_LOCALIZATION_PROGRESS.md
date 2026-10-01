# Business dashboard localization (owner request 2026-10-01; reverses the 2026-09-29 "business stays English" decision for the dashboard)

Scope: `BusinessDashboardScreen` (app + business website, same screen) and the components it renders
(DemandNearYouCard, SettingConflictNotice, BusinessHoursEditor, TellNearbyBusinessCard, SponsoredPromotionsPanel,
BusinessNotificationPreferences, BusinessEmailNotifications), plus the helper files that compose its sentences.
Language = the device/browser language (LanguageContext), same as the consumer app.

Stays English, by rule:
- The one-tap reply texts sent to the customer (`quickOfferResponse.js`: standard availability, usual terms line,
  alternative-time text). The server skips AI screening only on an exact match with those English strings.
- Sponsored TERMS text (legal), server/database messages shown verbatim (setting conflicts come from the database).
- Business names, customers' words, stored values.

## Phases (commit after each)
- [x] 1+2. Screen lines 1-~4000 (namespace `bizDash1`, 225 keys, 11 languages; module-level tab/offer-type labels still English, phase 4)
- [x] 3. Screen lines ~4000-~6000 (namespace `bizDash2`, 278 keys; plural fragments rewritten as whole sentences; occasion/category names via categoryName)
- [x] 4. Screen lines ~6000-end + module-level labels (namespace `bizDash3`, 346 keys; tab/tool/offer-type/duration/status constants now key-only; Resy/OpenTable stay English as brand names; screen added to LOCALIZED_FILES so the leftover-English scan now covers it)
- [x] 5. Components (namespace `bizComp`, 134 keys, 11 languages: DemandNearYouCard, SettingConflictNotice, BusinessHoursEditor, TellNearbyBusinessCard, SponsoredPromotionsPanel, BusinessNotificationPreferences, BusinessEmailNotifications; all added to LOCALIZED_FILES; status messages keep the KEY in state and translate at render, server text shown verbatim)
- [x] 6. Helper files that compose dashboard sentences (namespace `bizHelp`, 232 keys, 11 languages): billing breakdown, invoices, offer value, match fit, best time, outcome lines, price labels, demand card (category/occasion names via categoryName), opportunity card + match reasons, opportunity CTAs and reply confirmations, offer submission status + policy phrases, creative summary, discount cap, offer/availability/priority-time validation, demand preview, sponsored status/stats/dates, hours validation + the editor's status/week rows (shared with the public profile), location notice, weather check age, the 18 business empty states (EmptyCopy reads `ui.bizHelp.empty.<id>`). Numbers/money/clock/dates through `i18n/bizFormat.js` (English path = the old formatters). Tests: `i18n/bizHelpers.test.js`
- [x] 7. Business web export regenerated, full Jest 4022/4022, guards updated (`uiStrings` business labels now follow the language)

Still English, by rule or outside scope: quickOfferResponse texts sent to customers, sponsored terms, server/database messages (setting conflicts, submission `reason`), requested-item chips on the CONSUMER request form (`RequestedItemsPicker`; the dashboard now shows them translated), plan add-on labels (`planAddonLabel`), the Admin/AI screens. Machine-authored translations, not reviewed by native speakers. Taxonomy code-dependency inventory rebuilt locally, not synced to prod (owner-run `sync-code-dependencies.js`). Not device/browser-tested.
