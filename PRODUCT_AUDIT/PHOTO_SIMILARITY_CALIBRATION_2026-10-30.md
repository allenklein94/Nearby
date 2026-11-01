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

## Owner decision (2026-10-30)

Initial threshold **dHash <= 10, pHash <= 10**. Detection stays disabled until separately approved for production (after
0368/0369 + the `moderate-photo` redeploy are live and the privacy review / Privacy Policy sentence is done); the
activation migration is not written yet (development frozen). Reason: the 314-photo set is too small to establish a
real-world false-match rate.

## Activation (2026-11-01)

The activation migration is now written and staged (20270380, owner 2026-11-01), NOT deployed: `PRODUCT_AUDIT/PHOTO_DETECTION_ACTIVATION_PLAN_2026-11-01.md`.

## Larger calibration (2026-11-01, at the approved 10/10; threshold NOT changed)

**Set:** 1,473 files: 993 Lorem Picsum / Unsplash photos, 200 randomuser.me portraits, 160 constructed shared-background
images (40 backgrounds, 4 different faces pasted on each), 120 constructed same-face images (the same face on different
backgrounds). Sources + licences in the local `manifest.json` (never committed). 17 byte-identical files dropped, so
**1,456 photos**, **1,059,240 pairs of different photos**, 33,486 edited copies (23 edits each). Same hashing module as
`moderate-photo`. Run: `calibrate-photo-hashes.js general portraits shared-bg same-face` (local results
`/workspaces/.nearby-calibration/calib-2026-11-01.{json,log}` + `fp-10-10.txt`, not committed).

**Pairs flagged at 10/10: 28 of 1,059,240.** Each one inspected, by kind:

| Kind | Count | What they are | Real false match? |
|---|---|---|---|
| Same picture under two source ids | 2 | picsum-128 / picsum-456 (one Unsplash photo published twice), randomuser women-2 / women-85 (same portrait served twice); distance 0 | No: correct duplicates the set itself contained |
| A photo vs its own copy with a face pasted on | 9 | each "general" photo against a constructed image that uses it as background (distance 8-10) | No: an edited copy of the same photo |
| Two different people on a pixel-identical background | 16 | constructed shared-background groups (distance 4-10) | **Yes, worst case.** Real photos of two people at the same place won't share every background pixel, so this overstates the real risk; real family / look-alike / same-venue photos were NOT in the set |
| Two unrelated real photos | 1 | picsum-279 / picsum-467: two near-featureless foggy seascapes by the same photographer, exactly at distance 10 | **Yes** (low-detail image at the boundary) |

So among real, unrelated photos (general + portraits, about 690,900 pairs, incl. 16,653 portrait-on-portrait pairs) there
is **1 false match at 10/10**, at the boundary; portrait-on-portrait: **0** (apart from the duplicate). The constructed
worst case adds 16. Any match only opens a case for a person to review under 20270357's rules (3 accounts, or 2 with
similar names); it never restricts or tells anyone.

**Margin** (pairs of different photos whose closest pairing is at or below the distance, cumulative; includes the 2
duplicates and the constructed images): <=8: 14, <=10: 28, <=11: 29, <=12: 60, <=13: 67, <=14: 141, <=16: 313, <=18: 1,028,
<=20: 4,309. Going to 12/12 would roughly double the flagged pairs (60); 10/10 sits just before the climb.

**Missed duplicates (recall at 10/10, per edit):** caught (>= 97%): resize 50% / 25%, JPEG q30, brighter, blur, greyscale,
mirror, centred crop 10% / 20%, mirror + crop 20%, JPEG q10 (98.1%), re-saved twice, thumbnail upscaled, a screenshot
cropped back to the photo (97.9%). Partly: contrast 90.7%, 10% border 85.8%, 5% off-centre crop 49.7%, 5 degree rotation
20.5%, 30% crop 13.7%. **Not caught:** a full phone screenshot of the photo (0.1%), 20% off-centre crop (0.1%), 10%
off-centre crop (1.4%), 90 degree rotation (0%). Same face on a different background: **0 matched** (closest 12): these
hashes compare whole images and never detect the same person in a different photo. Claimed-edit recall 99.1%.

**Compared with the 314-photo run:** that run had 0 false matches to 12/12; this one finds 1 real false match at exactly
10 and confirms the shared-background worst case. The approved 10/10 is unchanged (owner: never change the threshold from
this run).

**Still not covered:** real dating-profile selfies, group photos, family members and look-alikes (need owner-supplied,
consented photos).

## Not verified

- Real uploads through `moderate-photo` on production (0368 + the function redeploy are NOT deployed).
- Behaviour at scale (matching scans in-use hashes; fine now, needs an index structure before many thousands of accounts).
