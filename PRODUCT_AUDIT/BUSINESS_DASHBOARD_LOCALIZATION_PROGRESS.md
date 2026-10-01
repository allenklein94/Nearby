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
- [ ] 3. Screen lines ~4000-~6000
- [ ] 4. Screen lines ~6000-end + module-level labels
- [ ] 5. Components
- [ ] 6. Helper files that compose dashboard sentences
- [ ] 7. Regenerate business web export, full Jest, guards
