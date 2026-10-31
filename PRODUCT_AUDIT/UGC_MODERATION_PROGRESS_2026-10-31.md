# User-content moderation (owner approved 2026-10-31, external-user security gate) — progress tracker

Branch `post-tier1/ugc-moderation` (stacked on `post-tier1/offer-safety`). Migration 20270373 (staged, NOT deployed).
Build 87 / main / production unchanged. No merge, deploy, publish or activation without separate owner approval.

## Findings (read-only on prod + code reading, 2026-10-31)
- Every consumer content write is a DIRECT table write by the signed-in client (supabase-js insert/update):
  profiles (display_name, bio, prompts, basics, pronouns/gender/orientation free text), gatherings (title, description),
  communities (name, description; edit via update_community), gathering_questions (question_body, answer_body),
  photo_comments (comment_text), community_messages / gathering_messages / plan_messages (body), messages (1:1).
- Screening today = client-side only: screens call `checkTextModeration` -> edge `moderate-text` (AWS Comprehend
  DetectToxicContent, `LanguageCode: 'en'` hard-coded, FAIL-OPEN: any error returns safe:true; the client also returns
  safe:true on error or no session). A direct API write skips it entirely; the database checks nothing.
- AWS documents DetectToxicContent as English-only. So 10 of the 11 app languages (es de fr pt ht zh vi tl ru ko) are
  effectively unscreened even on the app path.
- Business content: already bound server-side by 0372 (not repeated here).

## Design (summary; full text in the migration header)
- Public content (profile text, gathering title/description, community name/description, Q&A, photo comments):
  pre-publication, server-enforced. A BEFORE INSERT/UPDATE trigger needs, for every changed screened text, a screening
  row the edge function recorded for THIS user and THIS exact text (sha256 of the trimmed text), < 30 min old. Missing =
  refused, hint `screening_required`, nothing written. Outcomes: publish / hold (human review) / refuse (high risk;
  never recorded as usable). Server writes exempt; review-apply uses the 0361 private transaction marker.
- Hold: inserts are written with moderation_state 'held' (seen only by the author); edits keep the old published text
  and park the new text. Admin approve = apply / make visible; reject = removed. Never an account consequence.
- Languages: per-language calibration table. A language counts as screened only after a calibration run on the real
  classifier passes for it; until then even a "low" result is HELD for human review (safe fallback). Initially all 11
  are pending (no live run is possible without Anthropic credit).
- Group chat (community + gathering): published at once, screened after by a server queue (trigger enqueues every
  message, so no write path skips it); high risk = hidden pending review (evidence kept), uncertain = queued for review.
- Private 1:1 messages + group-plan chat: unchanged (report + evidence). Plan chat = owner decision (see report).
- Classifier: Anthropic (claude-haiku-4-5, the provider screen-business-content already uses), new shared module.

## Status
- [x] write-path inventory: writers above (Findings); SECURITY DEFINER readers inventoried in the migration header (section 3):
      the ones handing a gathering/community to someone else (invitations + their push, business requests, partnership
      requests, the signed-out invite-link preview) refuse or hide held content (hint `held_not_shareable`)
- [x] migration 20270373 + rollback (`scripts/rollback/20270373_user_content_screening.rollback.sql`)
- [x] NEW edge function `screen-user-content` (binding + fail closed + chat batch); `moderate-text` left unchanged (private screens still use it)
- [x] client: `services/userContentScreening.js`, 8 public-text screens, held + unavailable + limit + not-shareable messages (11 languages; 10 machine-authored, need native review)
- [x] admin: held user content in AdminContentReviewScreen
- [x] journey harness stand-in (UGC_STAND_IN, opt-out realUgcScreening) + journey `ugcModeration`
- [x] concurrency script `scripts/replay/ugc-moderation-concurrency.js`; calibration set (`utils/ugcCalibration.js`, 11 languages)
      + gated runner `scripts/trust-safety/ugc-calibration.js` (NOT run: needs Anthropic credit + owner approval; writes nothing, only proposes an activation migration)
- [x] full verification (2026-10-31, after the codespace restart):
      Jest 536 suites / 7277 tests; from-scratch replay 497/497 + journeys 858/858 + all 9 concurrency scripts on it
      (ugc 5 scenarios x 10 rounds); prod journeys 858/858 with 0348-0373 as prelude (rolled back); `ugcModeration` 8/8,
      fails 8/8 with 0348-0372 only; rollback round trip: replay (rollback then re-apply = identical catalog, 5012 items) and
      prod (aborted; 0373 changes 143 items, rollback restores all, exact ACL order too, 5105 items); grants replay ==
      prod+0348-0373 3285/3285.
- [x] post-deploy step (`post-deploy.js` 20270373) + gated signed-in test `src/qa/ugcScreeningSignedIn.live.js` (NOT run: 0373 not live)
- [ ] NOT DONE / gates: no deploy, merge or edge deploy authorized; calibration run (all 11 languages stay "pending" = held for a
      person until it passes and its activation migration is approved); every device must run a build that screens through
      screen-user-content before 0373 (build 87 does not); native review; device checks.
