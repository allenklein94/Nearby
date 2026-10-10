# Server-side video length check: decision record

**Date:** 2026-10-10 · **Decision:** Option A, approved by the owner · **Status:** built and deployed, NOT release-verified

## Decision

Check every uploaded video's length on the server, inside the existing `screen-business-content` edge function, by reading
the file's own MP4 / MOV timing boxes. No new hosting service, account, transcoder or vendor.

Rejected alternatives: trusting the phone's reported duration (a direct API call can upload anything); a separate
media-processing service with a decoder (new hosting and account); trimming (Nearby never trims).

## Rules (as built)

1. **Length is validated first.** In `screenOfferMedia` (`supabase/functions/_shared/offerMediaScreening.js`), after the
   ownership / frames / 25 MB checks and BEFORE any content screening. A refused video is never sent to the classifier.
2. **Fail closed.** Malformed, unreadable, missing or contradictory timing, a second video stream, a fragmented MP4, or a
   parser resource limit -> "We couldn't check this video's length."
3. **Limit.** Longer than 30.000 s (rounded to the millisecond, the precision the phone reports) -> "Videos can be up to
   30 seconds. Trim it on your phone and try again." Exactly 30 s passes. Never trimmed.
4. **Unapproved videos stay unavailable.** A passing check is recorded in `business_video_checks` (service role only,
   `duration_ms` 1..30000). Database triggers (migration `20270289`) refuse: a video library item becoming `ready` without
   that record; a video on an offer without that record AND without proof it passed content screening (a ready, live
   library item for the same file, or the team publishing that exact held item through
   `admin_review_business_content_screening`, which sets a transaction-local flag). Being an admin is not enough: the
   production owner account is also an admin and a blanket admin exception let it bypass screening (found and closed
   during verification).
5. **Bounded parser** (`supabase/functions/_shared/videoDuration.js`): file <= 25 MB, <= 4 MiB read in total (byte ranges;
   the movie data is skipped, never read), movie box <= 2 MiB, <= 64 top-level boxes, <= 4096 boxes, nesting depth <= 8,
   <= 16 tracks, <= 20,000 timing-table entries, <= 64 edit-list entries, <= 1.5 s wall time. Only known container boxes
   are entered; anything unexpected is refused.
6. **Retry behaviour preserved.** A storage read failure, an inexact range answer, a failed record write or a screening
   outage is a service failure (503 / library state `retry`), never an approval and never "needs changes".
7. **Scope: MP4 / MOV only.** Accepted brands: isom, iso2-iso6, mp41, mp42, avc1, M4V, qt. Everything else ->
   "This video format isn't supported. Use an MP4 or MOV video."

## Contradiction rules

Movie length = the movie header (`mvhd`). Each track header (`tkhd`) may not exceed it, and it may not exceed every track
(tolerance 100 ms). The single video track's media length (`mdhd`) must match the sum of its sample timing table (`stts`);
without an edit list its track header must match its media; with one, the edit list total must match its track header, and
every edit must play at normal speed. The length compared with 30 s is the LONGEST of the movie, every track header and the
video's media / sample timing, so an edit list cannot hide a longer clip.

## Verification done

- Jest `src/utils/videoDurationCheck.test.js`, 68 tests: real ffmpeg-encoded 29.9 / 30.0 / 30.1 s MP4 and MOV (fixtures in
  `src/utils/__fixtures__/video`), fast-start, video-only, fragmented, two video streams, WebM; missing / unknown /
  contradictory fields patched into real files; truncated / garbage / oversized-box / duplicate-box / no-moov / two-moov
  files; every resource limit; storage failure and inexact range answers; the shared screening step proves a refused video
  is never classified or recorded; the app's 11-language wording equals the server's English.
- Live SQL `scripts/live-verify/server-video-length-gate.sql`, 25 checks ALL OK on production (failed before the migration,
  passed as a dry run, applied, passed again): direct `submit_business_offer` by the owner refused for an unchecked and for
  an unscreened video, owner cannot read or write the check table or the library, team review publishes a checked held
  video and still refuses an unchecked one, images unchanged. Earlier creative / logo scripts still ALL OK; offer and
  core-loop journeys pass. Edge function v41 deployed with the parser bundled.

## Remaining limitations (release status)

- **Not verified:** the native-device test (`VIDEO_SCREENING_DEVICE_TEST_CHECKLIST.md`) and a real signed-in business end to
  end through the deployed function (no user token here; with no Anthropic credit every screening ends in Try again).
  Real iPhone (HEVC, metadata tracks) and Android files have NOT been run through the parser; the fixtures are ffmpeg files.
- Metadata is cross-checked, not decoded: a file whose every timing field consistently lies is not caught.
- Refused by design, possibly affecting real users: legacy QuickTime without `ftyp`, fragmented MP4, edits at another speed
  (check slow-motion and Photos-trimmed iPhone clips on the device).
- Signature Experience media remains unscreened (separate, pre-existing; not part of this change).
- Pre-existing, reported not changed: `submit_business_offer` is callable directly by a signed-in owner, so offer TEXT can
  skip the classifier through a direct call. Video media can no longer (the triggers above).
