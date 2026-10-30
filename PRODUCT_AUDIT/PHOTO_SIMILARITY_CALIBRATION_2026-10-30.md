# Near-duplicate photo calibration (20270368), 2026-10-30

Owner condition (2026-10-30): measure false matches AND missed matches before detection is switched on; ~20% cropping is a
testing target, not a promise; never act on an account automatically. Detection stays OFF: `similar_photo_max_dhash` /
`similar_photo_max_phash` are null in 0368, so nothing is compared and no case opens until the owner approves distances
(a separate, later migration).

## How it was measured

- Script: `scripts/trust-safety/calibrate-photo-hashes.js` (local only; nothing uploaded). Same hashing module as
  `moderate-photo` (`supabase/functions/_shared/perceptualHash.js`): dHash + pHash, 64 bits each, six variants per photo
  (whole, mirrored, centre 90%, centre 80%, each crop also mirrored).
- Test set: 200 general photos (picsum.photos, 600x800) + 120 stock headshots (randomuser.me portraits, the hard case: same
  pose, framing and background). 6 byte-identical files dropped (true copies, not "different photos"): **314 photos**.
- Each photo got 16 edited copies, each re-saved as JPEG like an upload: **5,024 copies**. Every pair of different photos:
  **49,141 pairs**.
- A pair matches when, for one allowed pairing (one photo's whole image against any variant of the other), BOTH distances are
  within the limits: the rule the database applies.
- Deno parity: the exact decode + hash path `moderate-photo` runs (Deno, `npm:jpeg-js`) gave identical hashes to the
  Node calibration for all **1,884** (314 x 6) photo-variant hashes (max distance 0)
  (`scripts/trust-safety/photo-hash-deno-parity.ts`).

## Results

Closest pair of DIFFERENT photos (the larger of the two distances, best pairing): **13**.

| dHash <= | pHash <= | false matches (of 49,141) | caught: edits we'd claim | centred 20% trim | 20% trim from a corner | 30% trim | contrast | 10% border | 5° rotation |
|---|---|---|---|---|---|---|---|---|---|
| 8 | 8 | 0 | 99.0% | 100% | 0% | 6.1% | 89.5% | 79.6% | 5.7% |
| 10 | 10 | 0 | 99.4% | 100% | 0% | 15.0% | 93.9% | 91.4% | 25.8% |
| 12 | 12 | 0 | 99.7% | 100% | 0% | 31.2% | 96.8% | 94.6% | 49.7% |
| 14 | 14 | 2 (headshot pairs) | 99.9% | 100% | 0% | 57.6% | 98.4% | 97.8% | 73.2% |
| 16 | 16 | 10 | 99.9% | 100% | 0.3% | 75.8% | 98.7% | 99.4% | 87.9% |
| 20 | 10 | 0 | 99.9% | 100% | 0% | 29.9% | 98.4% | 99.4% | 46.8% |
| 20 | 20 | 230 | 100% | 100% | 4.1% | 93.9% | 99.7% | 100% | 99.0% |

"Edits we'd claim" = resize to 50% / 25%, JPEG quality 30, brighter, more contrast, blur, greyscale, mirror, centred 10% and
20% trims, mirrored 20% trim (each 97-100% at the rows with 0 false matches). Never claimed: 30% trim, an off-centre trim,
borders, any rotation. A quarter turn is never caught (0% everywhere).

## What this means

- **~20% cropping:** caught when the trim is roughly centred (100%), NOT when a photo is cut from one side or corner (0%).
  So: "catches resized, re-saved, filtered, mirrored and centrally trimmed copies", never "catches 20% crops".
- **False matches:** none at or below 12/12, or at 20/10. They start at 14/14 and are headshot-on-headshot first, the expected
  risk (same pose and framing). Above that they rise fast (230 at 20/20).
- **Script recommendation:** dHash <= 20, pHash <= 10 (0 false matches, best recall). **Margin is thin:** the closest
  unrelated pair is at 13 and this is a 314-photo set from two sources. A more cautious start is 10/10 (0 false matches,
  99.4% of claimed edits). Either way a match only opens a case for a person to review, and only under 20270357's rules
  (3 accounts, or 2 with similar names); it never restricts or tells anyone.
- **Before switching on:** owner picks the distances; ideally re-run this script on a larger, more varied set (real-looking
  dating-profile photos, group photos, selfies) and recheck the false-match column.

## Not verified

- Real uploads through `moderate-photo` on production (0368 + the function redeploy are NOT deployed).
- Behaviour at scale (matching scans in-use hashes; fine now, needs an index structure before many thousands of accounts).
