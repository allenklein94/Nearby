# Nearby — Video Screening Device Test Checklist

**Status:** Not yet executed
**Scope:** Native video upload, background screening, approval, and offer-creative selection
**Release gate:** Physical-device verification required
**Built in:** commit `f0fa88d1` (migration `20270288`, `screen-business-content` v40); missing/invalid-duration guard added after it

Do not mark video screening production-ready until the native-device tests AND the real-user edge-function end-to-end
checks have both succeeded. A successful upload alone is not a successful screening test.

## 0. Known gaps going in (as built, updated 2026-10-10)

1. **Missing or invalid duration metadata: ADDRESSED by a phone-side guard, pending device verification.** `videoLimitProblem`
   (`src/utils/offerMedia.js`) now refuses a video whose duration is missing or not a real positive number (undefined, null,
   NaN, infinite, non-numeric, 0 or less) before anything is uploaded or screened, with "We couldn't tell how long this
   video is. Pick a different video or record it again." (11 languages; the 10 non-English versions are machine-written).
   Covered by Jest tests (`src/utils/creativeLibrary.test.js`, mutation-checked). Not yet seen on a device: check that real
   picks from iOS and Android report a duration, so valid videos are not refused.
2. **Misleading duration metadata: STILL OPEN.** A video could report under 30 s while the file holds a longer clip. The
   server cannot measure length (it sees the file size, capped at 25 MB, and the sampled frames); no server-side or
   trusted-processing duration check exists. Expect FAIL on that row until the owner decides how to enforce it.
3. **Duplicate uploads: still possible.** "Try again" on an item whose check could not finish re-checks the same library
   row (no duplicate). Adding the same video again with "+ Add" creates a second item, because every upload is a new stored
   file. Record which path was tested.
4. **Screening provider unavailable: BLOCKED.** Anthropic credit is exhausted, so every check ends in "Try again". Record
   screening attempts as BLOCKED, never as a pass.

Also note: the picker still passes `videoMaxDuration: 30`. It is expected to have no effect on iOS photo-library picks; if
the system trim screen appears, record it (the rule is that Nearby never trims).

## 1. Prerequisites

- [ ] Build and install the actual native iOS or Android app (not Jest, not a web preview).
- [ ] Confirm the native video-screening dependency (`expo-video-thumbnails`) is installed and loads.
- [ ] Use an authenticated test account for an approved business.
- [ ] Confirm migration `20270288` and the `screen-business-content` edge function (v40 or later) are deployed to the
      intended environment.
- [ ] Confirm the screening provider has working credentials and enough Anthropic credit.
- [ ] Prepare known-good, known-rejected and ambiguous video samples.
- [ ] Prepare videos shorter than, exactly at, and longer than 30 seconds.
- [ ] Confirm test media is authorized for use and contains no sensitive personal information.
- [ ] Verify logs and backend monitoring are available (edge-function logs, `business_creatives`,
      `business_content_screening_results`).

**Record before testing**

| Field | Value |
|---|---|
| Test date and tester | |
| App version and commit | |
| iOS/Android version | |
| Device model | |
| Native build configuration | |
| Backend environment | |
| Screening dependency version | |
| Screening provider status | |

## 2. Upload and device permissions

- [ ] Upload a video from the device's photo library.
- [ ] Grant photo-library access when prompted.
- [ ] Test limited photo-library access on iOS, if supported.
- [ ] Test denied access and confirm the user gets a useful explanation.
- [ ] Test selecting a video from a cloud-backed library that has not finished downloading.
- [ ] Test cancelling the file picker.
- [ ] Test a large but otherwise valid video (near the 25 MB cap, and just over it).
- [ ] Test a supported video format and an unsupported or corrupted file.
- [ ] Confirm the app stays responsive during upload.
- [ ] Confirm retrying an upload does not create duplicate library entries (see section 0, item 3; note which path).

## 3. Video-duration enforcement

| Test case | Expected result | Result |
|---|---|---|
| Video shorter than 30 seconds | Accepted for screening, if all other checks pass | |
| Video exactly 30 seconds | Accepted for screening, if all other checks pass | |
| Video longer than 30 seconds | Refused; screening and approval must not proceed | |
| Duration metadata missing or invalid | Refused on the phone before upload with "We couldn't tell how long this video is. Pick a different video or record it again." (section 0, item 1) | |
| Misleading or inconsistent duration metadata | Server or trusted processing path enforces the limit (STILL OPEN, section 0, item 2: expect FAIL) | |

For videos longer than 30 seconds, verify the exact English message:

> Videos can be up to 30 seconds. Trim it on your phone and try again.

- [ ] Both messages (over 30 s, unknown length) are translated correctly in each supported language (10 non-English
      versions are machine-written).
- [ ] Real videos picked on this device report a duration, so a valid video is never refused as "unknown length".
- [ ] The app does not trim, re-encode into a shorter clip, or silently keep 30 seconds.
- [ ] A refused long video cannot enter the "Use your saved creative" picker.
- [ ] The same refusal applies in the offer form's own media picker, not only in "Your photos & videos".

## 4. Screening state transitions

### A. Successful approval
- [ ] Upload a known-good video.
- [ ] The initial state is **Reviewing…**.
- [ ] The app can stay open while screening runs; the state updates without a manual refresh (the section re-reads
      every 5 s while something is reviewing).
- [ ] The item becomes **Ready to use** only after server-side approval.
- [ ] The approved video appears in **Use your saved creative**.
- [ ] Select it for an offer; the correct stored asset is attached.
- [ ] The customer-facing offer uses the approved media and the screened poster frame.

### B. Rejected content
- [ ] Upload a video known to break the screening rules.
- [ ] The item becomes **Needs changes**.
- [ ] A useful reason is shown (a fixed policy category or a plain message, never the model's own text).
- [ ] The rejected video does not appear in the picker.
- [ ] Reopening the picker or retrying a request cannot bypass approval.

### C. Ambiguous content
- [ ] Upload a sample expected to need review or give an uncertain result.
- [ ] Uncertain results are not treated as approved (the item stays **Reviewing…** until the team decides).
- [ ] After a reviewer approves or denies it in Admin > Content Review (the image is shown there), the item moves to
      Ready to use or Needs changes.
- [ ] No customer-facing offer can use the item before approval.

### D. Screening service failure
- [ ] Test an unavailable screening provider.
- [ ] Test a timeout and a failed edge-function request.
- [ ] Test missing or invalid provider credentials in a safe test environment.
- [ ] Transient failures show **We couldn't finish checking this** + **Try again**.
- [ ] A failure never produces Ready to use.
- [ ] Retrying does not bypass screening or duplicate approved assets.

**Current blocker:** Anthropic credit is unavailable. If screening returns Try again, record the test as BLOCKED (or
FAILED, by cause); never count it as a successful screening test.

## 5. App lifecycle and network resilience

- [ ] Background the app while a video uploads.
- [ ] Background the app while screening runs.
- [ ] Lock the device and reopen the app.
- [ ] Navigate away from the library and return.
- [ ] Force-close and relaunch the app while screening runs.
- [ ] Turn off the network during upload.
- [ ] Restore the network and retry.
- [ ] Cut the network after upload but before the result returns.
- [ ] The status shown is read from the server, not guessed from local state.
- [ ] A stale client cannot mark a pending asset approved.

## 6. Storage and security

- [ ] Uploaded files sit under the correct business folder (`business-offer-media/<partner>/creative-*`).
- [ ] One business cannot view, modify or select another business's creative.
- [ ] Submitted-but-unapproved assets are not exposed through customer-facing URLs or offer queries.
- [ ] Only server-approved assets can be selected for offers.
- [ ] Changing a client-side status or request payload cannot bypass screening.
- [ ] Approved files cannot be overwritten in place after screening.
- [ ] Replacing media creates a new pending asset.
- [ ] Rejected assets stay unavailable to customers.
- [ ] Signed URLs and storage policies enforce the intended access.

Database-level parts of this section are already covered by `scripts/live-verify/creative-library-logo-upload.sql`
(29 checks, live ALL OK). The device test confirms them through the real app.

## 7. Customer and business experience

- [ ] Reviewing…, Ready to use and Needs changes are legible in light and dark mode.
- [ ] The rejection reason fits on a small screen.
- [ ] Long file names and business names do not break the layout.
- [ ] Approved creative appears in the picker without reinstalling the app.
- [ ] Pending, rejected and failed assets stay out of the picker.
- [ ] The existing offer-media placement and card layout are unchanged.
- [ ] The video poster appears before playback.
- [ ] Video playback stays tap-to-play (no autoplay).
- [ ] No logo or offer-media approval rule was weakened by the library changes (logo upload: a new logo stays hidden
      from customers until approved; a held replacement keeps the old approved logo showing).

## 8. Evidence to capture

For every test, record:

- Test case ID and device.
- Input media file name, format and duration.
- Expected and actual status.
- Screenshot or screen recording.
- Relevant client error and request/correlation ID.
- Matching backend screening result.
- Storage and picker visibility outcome.
- Pass, fail or blocked.
- Defect reference and notes.

Do not capture secrets, access tokens or unnecessary personal information.

## 9. Pass criteria

The device test passes only when:

1. The native dependency loads and video screening runs on a physical device.
2. Valid videos can be uploaded, screened, approved and selected.
3. Rejected, ambiguous and failed screenings never become approved by default.
4. The 30-second limit is enforced without automatic trimming.
5. Backgrounding, relaunching and network failures do not bypass approval.
6. Business ownership and storage protections are verified.
7. Customer-facing offer media stays gated by server-side approval.
8. Every observed issue is resolved or explicitly accepted before release.

## 10. Results template

| Field | Value |
|---|---|
| Device/build | |
| Environment | |
| Screening provider operational | Yes / No |
| Native dependency operational | Yes / No |

| Area | Passed | Failed | Blocked |
|---|---|---|---|
| Permissions and upload | | | |
| Duration enforcement | | | |
| Approval and rejection | | | |
| Retry and lifecycle | | | |
| Storage and security | | | |
| Offer-picker integration | | | |
| Localization and layout | | | |

**Open defects:**

**Evidence location:**

**Final decision:** Pass / Fail / Blocked
