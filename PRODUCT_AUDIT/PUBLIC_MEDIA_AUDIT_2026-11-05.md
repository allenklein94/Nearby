# Public media audit: Stories and business media (2026-11-05)

Owner request: a focused, read-only audit of consumer Stories (submission, storage, moderation, visibility, direct-API
bypasses) and every public media entry point, with the smallest safe launch policy. Nothing was changed by this audit.

Method: code reading, plus probes under the real `authenticated` role on an isolated from-scratch replay (all staged
migrations through 0389, in rolled-back transactions), plus read-only production counts. Not tested: the real Storage API,
a real phone, or production writes. "Proven" below means the probe ran; "code reading" means it did not.

Production today (read-only): 0 stories, 0 public stories, 0 gathering covers, 0 community covers. Exposure is design
exposure, not known abuse. `stories` and `gathering-photos` buckets have no size or file-type limit.

## 1. Every media entry point

| Surface | Who sees it | Screening today | Modified client can skip it? |
|---|---|---|---|
| Offer image | Requesting customer | Yes, once 0372 is live | Yes until 0372 is live; screening has never succeeded in production |
| Offer / library / experience video | Customers | Client-chosen frames only | Refused by 0388 (staged) |
| Business logo | Everyone | Yes, in `screen-business-content` | Not reviewed further here |
| Business Moment photo | Every signed-in user | **None** | Refused by 0389 (staged) |
| Business Moment video | Every signed-in user | **None** | Refused by 0388 (staged) |
| Public Story photo / video | Every signed-in user, not only nearby | **None** | Yes, nothing to skip |
| Friends-only Story | Matches + accepted friends | **None** | Yes |
| Gathering memory | Host + approved attendees | **None** | Yes |
| Gathering cover photo | Anyone who may see the gathering | **None** | Yes |
| Community cover (`cover_photo_url`) | Community viewers | **None** | Client can write any URL; no uploader found in the app, code reading only |
| Profile photos | People who can see the profile | `moderate-photo`; client triggers it, so visibility must follow the result (0349, staged) | Covered by 0349 once live |
| Chat images | The conversation | None; `moderate-chat-image` exists but nothing in the app or migrations calls it | Reports-based by owner decision (text); images not separately decided |

## 2. Stories findings

| # | Finding | Evidence | Severity for public launch |
|---|---|---|---|
| S1 | No moderation of any Story photo or video, and no held state | No screening code or trigger touches `stories` | High |
| S2 | A public Story reaches every signed-in user, not a nearby audience | Read policy: `is_public = true`, no distance | High, multiplies S1 |
| S3 | **`media_path` ownership isn't checked**: anyone can post a Story pointing at another person's file, and the storage rule then opens that file to everyone | Proven: a stranger could not see B's friends-only file (0 rows); after A inserted a public Story with B's path, the stranger could (1 row). A needs the path; paths are `<user id>/<milliseconds>.<ext>`, and anyone who could see the file has it. Also applies to gathering memories | High, a privacy defect independent of moderation |
| S4 | **`expires_at` is client-set**: a public Story can stay up forever | Proven: expiry 2099 accepted and readable by a stranger. The 24 h promise isn't enforced | High |
| S5 | **A Story can't be reported**: the viewer has no report action, and `reports.content_type` has no story type | Code reading + constraint. Only the person can be reported, without the content kept as evidence. So reports can't stand in for screening here | High |
| S6 | No verified-phone gate on posting | `stories` has no such trigger or policy clause (0352 doesn't list it). Code reading; all probe accounts had phones | Medium |
| S7 | `media_type` accepts anything, and the type isn't compared with the file; no file-type or size limit on the bucket | Proven: `'banana'` accepted | Medium. Viewers only play exact `'video'`, so this is junk rather than a bypass, but it weakens any later video rule |
| OK | Daily limit (20), suspended accounts refused, blocks hide both ways, storage reads follow the Story's visibility, uploads only into your own folder, clients have no UPDATE policy, location stored only as a blurred pin | Proven or code reading | |

## 3. Recommended launch policy (smallest safe)

Matches the owner's table, with one step earlier: **public Stories off until photo screening exists.** Keeping public
photos live without screening contradicts the Moments decision, since a public Story reaches the same audience with the same
missing check, and it can't even be reported (S5).

| Surface | First outside users | Public launch |
|---|---|---|
| Public Stories, photo and video | **Off** | Photos on only after screening + report path |
| All Story video (including friends and gathering memories) | **Off** | Off until video moderation exists |
| Friends-only Story photos | On, with the fixes below | On |
| Gathering memory photos | On, with the fixes below | On |
| Gathering covers | Decide with Stories: same gap, public reach | Screen with the same step |
| Business Moments | Off (0388 + 0389) | Off until screening exists |

**Smallest server change, one migration, about the size of 0388, NOT built, needs approval:**
1. refuse `is_public = true` and `media_type = 'video'` on new Stories (one switch, same pattern as 0388);
2. set `expires_at` on the server (S4);
3. require `media_path` inside the poster's own folder (S3);
4. restrict `media_type` to image / video (S7) and add the phone check (S6).

Items 2-4 are worth doing whatever is decided about public Stories, because S3 and S4 are defects, not policy.

**Later, before public Stories return:** screening reusing the existing image classifier, and a report path for a Story that
keeps the content (S5: needs a reason code, a `content_type` and a build). No new moderation platform. Reporting is the one
piece needing app work.

**Honest note on friends-only video:** turning it off follows the owner's table. The audience is private and consented, so
it is the one line that could reasonably stay on if the owner prefers; it would stay unmoderated and unreportable until S5 is fixed.

## 4. Client behaviour to fix in a later build (not build 87)

- Hide the post-a-Moment button and the business video option; `captureStoryMedia` offers photo and video together.
- If an older build attempts it, say plainly that it's temporarily unavailable, using the `business_video_paused` and
  `business_moments_paused` hints. Today the Moment path goes through the generic error with Try Again, which can't succeed.
- Upload happens before the row is refused, so a refused Moment leaves an orphaned file in the poster's folder. Harmless
  (unreadable with no row), but the later build should stop before uploading.

## 5. Owner decisions (2026-11-05) and what was built: migration 20270390 (STAGED, NOT DEPLOYED)

| Decision | Enforced by | State after deploy |
|---|---|---|
| Public Stories off | Server trigger, hint `stories_paused` | Off until image screening + a report path exist |
| All Story video off, memories included | Server trigger, hint `story_video_paused`; buckets take photos only | Off until video moderation exists |
| Friends-only Story photos only after verification + working reporting, otherwise off | Server trigger, hint `stories_paused` | **OFF: no Story report path exists yet** |
| Covers kept, never shown unreviewed | Storage read rule: host only | Viewers get the existing category image; the host still sees their own |
| Ownership, 24 h expiry, media types, phone | Trigger, check constraint, storage rule | S3, S4, S6, S7 closed |

Additional finding while building: S3 also let a forged Story get someone else's file deleted, because `delete_expired_stories`
deletes the path a row names. Closed by the same ownership check.

Limits: file type is the DECLARED type, so mislabelled bytes pass the bucket, though viewers play only `media_type = 'video'`.
Gathering memory photos stay on, unscreened, limited to the host + approved attendees. S1 stays open by design: the switches
contain it, nothing screens a Story yet. S5 is addressed by section 6 (staged). A cover has no screening path yet, so no viewer
sees any uploaded cover until one exists. The Storage API proof ran on the local image (v1.11.13), not production's.

## 6. Owner decisions (2026-11-05, second set) and what was built: migration 20270391 (STAGED, NOT DEPLOYED)

Migration 0390 approved as staged only. Decisions: gathering memory photos stay on, with server-enforced visibility, a way to report
and removal by the host or an admin; a focused report path for memories and Stories on the existing report system; public,
friends-only and video Stories stay off; the cover mismatch is fixed in a later build; nothing reaches build 87, main or production.

| Requirement | Enforced by | Proven by |
|---|---|---|
| Only someone who can see a photo can report it | The server reads it as the reporter | Journey: stranger, unknown id, expired Story refused |
| Your own photo can't be reported; a forged person or copy is ignored | Server sets poster and copy after the visibility check | Journey |
| Evidence survives expiry, removal, gathering loss, account deletion | The one file stays held in place, `private.report_media_evidence` | Journey + real Storage API |
| The poster can't alter or remove held evidence | The bucket has no client UPDATE or DELETE policy | Real Storage API: overwrite, PUT, single and bulk delete, move all fail, bytes unchanged |
| No unrelated media kept | One file per report; no_action releases it at once | Journey: exactly one file held; unheld files deleted |
| Only admins see held evidence, by signed link | Storage policy "Admins can view reported media" | Real Storage API, for each role |
| Host or admin can remove a memory | `remove_gathering_memory`, `admin_remove_reported_media`, both logged | Journey: attendee, stranger, suspended host, non-admin refused |
| A report and an expiry or removal can't lose evidence | Row lock taken at report time | 60 concurrent rounds in both orders |

Retention: held while the report is open; `no_action` releases at once; `action_taken` or a plain resolve keeps it until the report's
12-month purge; reopening restores the hold if the file still exists.

**Defect found while building:** the expiry job asked Storage to delete with a POST the API doesn't have (404 on the real API), so no
Story file has ever been deleted, on expiry or on removal. Removing a row only made the file unreadable. Production confirms it:
2 files, 0 stories (read-only, 2026-11-05). 0391 fixes it: every deleted row queues its file, and the hourly job sends one DELETE per
file. Existing orphans are queued once. Whether the job's key is accepted by production's Storage is untested: `post-deploy.js` has
a required check.

Limits, stated plainly:
- Memory photos are unscreened. Reports act after someone has seen the photo.
- A photo removed before anyone reports it, or a Story expired, can't be reported: the row is gone or unreadable. The app then
  files the report about the poster, without the photo. A poster can therefore delete before a report arrives.
- `action_taken` keeps the image for 12 months, matching reports. **Before outside users, counsel must set the handling of illegal
  imagery, above all child sexual abuse material: legal reporting and preservation duties can differ from this rule, and an admin
  viewing such a file needs a defined procedure. No runbook for this exists.**
- A refused DELETE isn't retried: that file stays, unreadable.
- A reported file with an open report stays held for as long as the report is open; there is no time limit, the same as reports.

**Privacy Policy sentence (DRAFT, needs legal review, publish with 0391):** "If you report a photo, we keep a copy of that photo and
the details of your report so our team can review it, even if the photo expires, is removed, or its owner deletes their account. If no
action is needed, we delete the kept photo when the review ends. If we act on the report, we keep it with the report for up to 12
months after the review ends. Only authorized reviewers can see it."

Native review: `ui.reportBlock.reportPhoto`, `ui.gatheringMemories.report` (10 languages, machine-authored).

**Not built, by decision:** the cover fix (later build; the host must see either the same image as everyone else or a clearly
labelled private preview), image screening, moderation of Story video, any new screen or moderation system.
