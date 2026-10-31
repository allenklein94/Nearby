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
- [ ] write-path inventory (readers + writers per table) recorded below
- [x] migration 20270373 + rollback (applies on the replay; rollback + re-apply clean)
- [x] NEW edge function `screen-user-content` (binding + fail closed + chat batch); `moderate-text` left unchanged (private screens still use it: see findings)
- [ ] client: moderation service, screens, held/unavailable messages (11 languages)
- [ ] admin: held user content in AdminContentReviewScreen
- [x] journey harness stand-in (UGC_STAND_IN, opt-out realUgcScreening) + journey `ugcModeration` 8/8 on the replay
- [ ] concurrency script; calibration fixtures (11 languages) + calibration runner
- [ ] full verification: Jest, prod journeys with prelude (rolled back), from-scratch replay + journeys + concurrency,
      grants comparison, rollback round trip
- [ ] records (CLAUDE.md line, CLAUDE_HISTORY.md top, post-deploy.js step)
