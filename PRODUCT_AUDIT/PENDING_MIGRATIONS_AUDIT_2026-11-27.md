# Pending production migrations: full audit + deployment plan (2026-11-27)

PREPARATION ONLY. Nothing here was deployed. Production checked read-only today: `migration:status --target=prod` =
ledger at **20270347**; **88 pending** (0348-0435, no gaps; 0435 = this round's cuisine, the rest unchanged). Approval
codes + per-migration post-deploy checks + rollback notes: `MIGRATION_APPROVAL_PACKETS_0348-0433.md` (regenerated today,
now through 0435). History, walls and requirements R1-R12: `MIGRATION_CATCHUP_PLAN_2026-11-23.md` section 8.

## 1. Short answers

| Question | Answer |
|---|---|
| Is anything broken because they're pending? | Yes, a handful of LIVE gaps (column L below), most importantly: any signed-in account reads every profile column (0348); build 87's Dating Browse + Crossed Paths are empty and "Set as main photo" fails (0348 / 0349, device findings 19 + 20); suspension doesn't exist (0351); crossed-paths sightings + pushes for people who never opted in (0353, 0383); Friends Crossed Paths re-shows people you passed on (0433). The rest are protections or features that simply aren't live yet. |
| Can they all go at once? | No. `deploy.js` forces number order, one approval per file, and two walls split them: **Phase A (0348-0372)** works with build 87; **Phase B (0373-0435)** needs build 88 on every device + working Anthropic credit (0373 refuses unscreened public text; 0382 breaks build 87's Dating). |
| Obsolete / superseded? | None should be dropped. 0359 is corrected by 0360/0361 in the same sitting (never live alone). 0388 / 0389 are deliberate TEMPORARY pauses (video offers, Business Moments) that a future migration lifts once media moderation exists. Several later files redefine earlier functions (CREATE OR REPLACE), so the intermediate state exists only inside a sitting; every file still has to be applied for the ledger. |
| Website checks? | 0348 (owner's five-tab website pass before + after, R8), 0419 (`docs/business.html` sign-up publishes with it), 0422 (website re-exported first, else it prints "{viewedCount}"), 0424-0427 (Business Mode sends the location header), 0430 (Bookings "Confirm visit"), 0434 strict mode (only after the current export is published). The updated export is built + checked headlessly (section 5). |
| Backup / rollback? | `deploy.js` refuses without a verified + encrypted backup < 24 h (today's 20:02 UTC backup is valid until 2026-11-28 20:04 UTC). Every file has a rollback, proven in isolation (all back to 0347 except ACL order + whitespace). Data-moving files (0375, 0393, 0400, 0402-0406) and 0416 / 0423 / 0432 / 0435 lose data on rollback: count + export first; only the backup has what a job already deleted. |

## 2. 0348 and 0349 (the two from the phone session), ready for your approval

| | 0348 profile column privacy | 0349 verification self-grant guard |
|---|---|---|
| Fixes on build 87 | Dating Browse + Crossed Paths empty (finding 19); closes N6 | "Set as main photo" (finding 20: `swap_main_photo`); self-granted verification/admin; unapproved photo files |
| File hash = prepared code | YES (sha256 unchanged, checked today) `20270348:12372a27…a515` | YES `20270349:e14971c0…11cf` |
| deploy.js gates today (rolled-back check, nothing sent) | Only refusals: your approval code + approval ref + session id, and the stale compatibility evidence (re-run today, section 4) | same (+ 0348 recorded first) |
| Still needed from you | R2 App Store Connect: no public build <= 86; R3 Tier 1 (or your decision that the 2026-11-27 device session counts); the five-tab website pass (Coastal Coffee) right before; approval code | same; then `moderate-photo` redeploy right after (its own approval) |
| Right after | `get_my_profile()` own / cross-user / signed-out + catalog; journeys profileColumnPrivacy, datingConsent, appVersionCompatibility, build87Compatibility; you repeat the website pass | journeys photoScreeningBinding, businessVerification, trustSafety; `photo-storage-api.js` read-only; on the phone: Set as main photo |
| Rollback | re-opens N6: never with outside users | issued photo links stay valid 15 min |

They go back to back (0349 needs 0348 recorded). Batch 1 continues 0350-0354 the same sitting or later, each its own code.

## 3. Deployment batches (dependency-safe; number order is forced anyway)

| Batch | Files | Gate |
|---|---|---|
| 1 | 0348-0354 | Wall A: build 87 on every device, no public build <= 86, Tier 1, same-day backup |
| 2 | 0355-0362 | Privacy sentences for 0355 + 0357 published the same day; 0358-0361 one sitting |
| 3 | 0363-0366 | `report-presence` redeploy after 0363 |
| 4 | 0367-0369 | 0367 hook installs OFF; Auth switch = separate approval |
| 5 | 0370-0372 | `screen-business-content` from the 0415 branch or later at 0372 |
| 6-13 | 0373-0435 | Wall B: build 88 everywhere (TestFlight + any store release), Anthropic credit returns allow/deny, website re-exported + published, distribution + website evidence lines, Batch 1-5 checks PASS |

## 4. Compatibility evidence (re-run today)
Local replay (isolated network, `/workspaces/.nearby-verify/v477`), recorded in `PRODUCT_AUDIT/evidence/release-compat.md`:
- **This branch's build (next build):** runtime 15/15 at 0347 and at every batch boundary (0354, 0362, 0366, 0369, 0372, 0373,
  0381, 0398, 0406, 0417, 0429, 0432, 0433, 0434, 0435). It needs no pending migration (no circular dependency): on today's
  production it uses two known fallbacks (peopleRead hide-switch columns, preferencePolls profile columns) and the cuisine
  column fallback.
- **Build 87 (released):** 15/15 at 0354-0372 (Phase A safe); 14/15 at 0347 = the live Dating defect 0348 fixes; fails from
  0373 by design (Wall B / client floor).

## 5. Website
Export built from this branch (`/workspaces/.nearby-verify/v476`, NOT published): builds clean; differs from the published
`docs/business/` by one JS bundle + index.html; headless browser (mocked Supabase, no network) 123/123, offer-preview dock
128/128 at 320-430 pt. Not covered (needs you, in a real browser): the signed-in pre-0348 pass (Coastal Coffee account,
five tabs + one profile save), then the same pass right after 0348. Publishing = its own approval.

## Per-migration table

Kind: **L** = closes a gap that is LIVE on production today; **F** = a feature that waits on it; **S** = a safeguard / infrastructure (its protection is not live until deployed). Phase A/B as above.

| # | File | Batch (phase) | Kind | Effect on production while pending | Deploy notes (website, edge functions, data) |
|---|---|---|---|---|---|
| 0348 | profile_column_privacy | 1 (A) | L | N6: any signed-in account reads all 107 profile columns of a visible profile (privacy). Build 87 Dating Browse + Crossed Paths empty today (finding 19) = fixed by 0348 or build 88's fallback | W: website five-tab pass before + after (R8); breaks build <= 86 |
| 0349 | verification_self_grant_guard | 1 (A) | L | Self-grant of photo_verified/admin possible; "Set as main photo" fails on build 87 (finding 20: swap_main_photo arrives here); unapproved photo files listable | E: moderate-photo redeploy right after |
| 0350 | identity_verified_separate | 1 (A) | L | "Verified" badge means three different things (photo screen, ID, not suspended) |  |
| 0351 | account_suspension | 1 (A) | L | Admin "Suspend" changes 0 rows: no real suspension exists |  |
| 0352 | phone_required_for_social | 1 (A) | S | No verified phone required for social actions/discovery | outlook business account becomes business-only |
| 0353 | crossed_paths_push_consent | 1 (A) | L | Crossed-paths push names the other person regardless of their consent |  |
| 0354 | id_verification_upload_limits | 1 (A) | L | ID bucket accepts any file type/size |  |
| 0355 | report_evidence_and_action_log | 2 (A) | S | Reports carry no evidence or admin action log | Privacy sentence same day |
| 0356 | progressive_trust_rate_limits | 2 (A) | S | Rate-limit mechanism (enforces nothing alone) |  |
| 0357 | duplicate_account_signals | 2 (A) | S | Duplicate/fake account signals for admin review | Privacy sentence same day |
| 0358 | trust_safety_thresholds | 2 (A) | S | Approved rate-limit + photo-signal numbers | 0358-0361 one sitting |
| 0359 | trusted_write_scope | 2 (A) | S | Trusted-write flag scope fix (found while testing 0356) | superseded in effect by 0360/0361 the same sitting: never live alone |
| 0360 | trusted_flag_client_roles | 2 (A) | S | Client-forged trusted flag ignored |  |
| 0361 | enforcement_skip_marker | 2 (A) | S | Enforcement skips use a private marker, never the flag |  |
| 0362 | gathering_creation_limits | 2 (A) | L | Gatherings: flat 10/day trigger -> 5 new / 15 established per 24 h |  |
| 0363 | behavior_review_signals | 3 (A) | S | Behaviour review signal foundations (all OFF) | E: report-presence redeploy |
| 0364 | server_only_function_grants | 3 (A) | L | get_social_forecast connection-hold DoS + stall-nudge cron callable by any signed-in account |  |
| 0365 | behavior_signal_thresholds | 3 (A) | S | Approved behaviour-signal numbers (activates 0363) |  |
| 0366 | intention_change_count_privacy | 3 (A) | L | get_intention_change_count leaks another person's count |  |
| 0367 | signup_phone_only_hook | 4 (A) | L | Email sign-up still possible on prod (hook installs OFF; separate Auth switch approval) | Auth switch separate |
| 0368 | similar_photo_signals | 4 (A) | S | Near-duplicate photo hashes (detection OFF) | E: moderate-photo (not redeployed) |
| 0369 | review_case_history | 4 (A) | S | Append-only review case history | website-only Admin Review screen |
| 0370 | report_reason_codes | 5 (A) | S | Stable report reason codes + check constraint |  |
| 0371 | business_verification | 5 (A) | F | Business verification |  |
| 0372 | offer_safety | 5 (A) | S | Offer safety screening hooks | E: screen-business-content from the 0415 branch or later |
| 0373 | user_content_screening | 6 (B) | S | Public text must be screened (refuses unscreened writes) | WALL B: build 87 cannot save public text after this; needs build 88 + Anthropic credit |
| 0374 | suspended_number_retention | 6 (B) | S | Suspended-number retention for re-signup review |  |
| 0375 | account_takeover_protection | 6 (B) | S | Account takeover protection | recovery gates before launch |
| 0376 | shared_device_signals | 6 (B) | S | Shared device token signal |  |
| 0377 | friend_request_burst_limit | 6 (B) | S | Friend requests 5 per 10 min (15/day is already live) |  |
| 0378 | shared_public_text_signals | 6 (B) | S | Shared public text signal |  |
| 0379 | shared_review_case_links | 6 (B) | S | Shared review case links |  |
| 0380 | photo_detection_activation | 6 (B) | S | Photo detection activation (10/10 threshold) |  |
| 0381 | impersonation_and_business_reports | 6 (B) | S | Impersonation + business reports |  |
| 0382 | profile_anti_scraping | 7 (B) | L | Profile anti-scraping (Browse paging cap) | breaks build 87 Dating; build 88 ported (page-at-a-time) |
| 0383 | crossed_paths_consent | 7 (B) | L | LIVE DEFECT: sightings recorded for any two people in the same cell, opted in or not | E: report-presence |
| 0384 | crossed_paths_safeguards | 7 (B) | S | Crossed-paths safeguards |  |
| 0385 | gathering_review_signals | 7 (B) | S | Gathering review signals (short-notice cancels) |  |
| 0386 | gathering_review_signal_thresholds | 7 (B) | S | Gathering signal numbers |  |
| 0387 | screening_outage_alerts | 7 (B) | S | Screening outage alerts |  |
| 0388 | video_offers_paused | 7 (B) | S | Video offers paused (temporary, before outside businesses) | future migration reverses it once video moderation exists |
| 0389 | business_moments_paused | 7 (B) | S | Business Moments paused (temporary) | same |
| 0390 | stories_security | 7 (B) | L | Stories security |  |
| 0391 | media_reports | 7 (B) | S | Media reports |  |
| 0392 | gathering_community_reports | 7 (B) | S | Gathering/community reports |  |
| 0393 | admin_content_removal | 7 (B) | S | Admin content removal |  |
| 0394 | gated_perk_gate_removed | 7 (B) | L | Deleting a gathering/community a perk is gated on fails (defect found by 0393's journey) |  |
| 0395 | legal_holds | 7 (B) | S | Legal holds |  |
| 0396 | link_safety | 7 (B) | S | Link safety |  |
| 0397 | report_feedback | 7 (B) | S | Report feedback |  |
| 0398 | unsafe_report_reason | 7 (B) | S | Unsafe report reason |  |
| 0399 | admin_account_restrictions | 8 (B) | S | Admin account restrictions |  |
| 0400 | id_document_retention | 8 (B) | S | ID document retention | moves/deletes records: backup first |
| 0401 | admin_account_facts | 8 (B) | S | Admin account facts |  |
| 0402 | held_account_evidence | 8 (B) | S | Held account evidence | moves records |
| 0403 | deletion_hardening | 8 (B) | S | Deletion hardening | moves/deletes records |
| 0404 | admin_case_link_count | 8 (B) | S | Admin case link count |  |
| 0405 | account_deletion_blockers | 8 (B) | S | Account deletion blockers |  |
| 0406 | deleted_account_unresolved_records | 8 (B) | S | Deleted-account unresolved records |  |
| 0407 | fake_credibility_removals | 9 (B) | F | Fake-credibility removals (host reputation line, referral reward) | client side must ship first (build > 87) |
| 0408 | gathering_feedback_private | 9 (B) | L | gathering_feedback rows readable by other accounts (2 rows today) |  |
| 0409 | trending_established_attendees | 9 (B) | F | Trending needs 5 established attendees | client in build 88 |
| 0410 | familiar_hosts | 9 (B) | F | Familiar-host tie-break |  |
| 0411 | host_attendance_respects_blocks | 9 (B) | L | Host reads attendance of someone who blocked them |  |
| 0412 | repeated_host_cancellations | 9 (B) | S | Repeated host cancellations signal |  |
| 0413 | shared_link_signals | 9 (B) | S | Shared website signal (OFF until Privacy sentence) |  |
| 0414 | business_duplicate_warnings | 9 (B) | S | Business duplicate warnings | deploy.js refuses until its evidence lines exist |
| 0415 | business_note_screening | 9 (B) | S | Business note screening | one screen-business-content deploy at 0372 from this branch or later |
| 0416 | offer_evidence | 9 (B) | L | Reported offers deleted with the customer's account | rollback refuses while evidence rows exist |
| 0417 | dating_tattoo_piercing_preferences | 9 (B) | F | Dating tattoo/piercing soft preferences |  |
| 0418 | web_business_claim_needs_profile | 10 (B) | F | Website-only owners: claim waits for a profile |  |
| 0419 | business_service_area | 10 (B) | F | Business service area ("We go to customers") | website sign-up page (docs/business.html) publish with it |
| 0420 | offer_screening_auto_retry | 10 (B) | F | Offer screening automatic retry | E: screen-business-content redeploy |
| 0421 | push_token_invalidation | 10 (B) | L | Dead push tokens never cleared; that alert never emailed | E: send-push right after |
| 0422 | business_offer_view_privacy | 10 (B) | L | Customer read receipts reach the business | gate: build > 87 on business devices + website re-export |
| 0423 | business_contact_details | 10 (B) | F | Business phone + website (private) |  |
| 0424 | business_memberships | 10 (B) | F | Multi-location memberships |  |
| 0425 | trust_functions_membership | 10 (B) | F | Trust functions read memberships |  |
| 0426 | business_selection_guard | 10 (B) | F | Stale business-selection guard (pre-request hook) |  |
| 0427 | location_aware_client_required | 10 (B) | F | Location-aware client required for 2+ locations |  |
| 0428 | business_message_alerts | 10 (B) | F | Business message alerts |  |
| 0429 | business_message_alert_mute_window | 10 (B) | F | Business message alert mute window |  |
| 0430 | business_visit_confirmation | 11 (B) | F | Business visit confirmation (customer mark vs business confirm) | ship the new client before (builds <= 87 show "Visit confirmed" for the customer's tap) |
| 0431 | visit_confirmation_routing_track_record | 11 (B) | F | Routing track record reads confirmed visits | with 0430 |
| 0432 | visit_confirmation_analysis_views | 11 (B) | F | Analysis views read confirmed visits | with 0430; rollback 0432->0430 loses who confirmed |
| 0433 | own_friend_swipes_readable | 11 (B) | L | LIVE DEFECT: Friends Crossed Paths shows people you already swiped on | server only; build 87 benefits |
| 0434 | app_version_policy | 12 (B) | S | Minimum supported version policy (installs OFF) | enforcement + strict mode = separate approvals |
| 0435 | gathering_cuisine | 13 (B) | F | Gathering cuisine as a structured fact (this round) | no build gate (fallback in the new build) |
