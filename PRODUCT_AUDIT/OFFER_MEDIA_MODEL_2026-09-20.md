# Rich offers: data model now, video/animated reveal in Phase 2 (2026-09-20)

Decision (owner): design the offer object to carry media + details now; make video and the animated reveal Phase 2.
No schema change was needed to reach the decision; this records what already exists and what Phase 2 must add.

## What a business's response to a request (`business_request_offers`) already carries

| Wanted            | Already there                                                                 | Gap |
|-------------------|-------------------------------------------------------------------------------|-----|
| Image             | `media_path` + `media_type='image'` (private bucket `business-offer-media`, signed URL) | none. Rendered on the consumer offer card. |
| Video             | `media_path` + `media_type='video'` (upload + storage already work)           | Consumer card shows only "Video attached" (no player). Phase 2. |
| Rich text         | `offer_title` (headline), `offer_description`, `included_items text[]` ("✓ item" rows) | none by design. Structured lines, not free HTML/markdown: nothing to sanitize, nothing to spoof. |
| Offer details     | `offer_type`, `offer_price` + `price_is_per_person`, `discount_pct` (cap enforced), `proposed_time` | none |
| CTA               | Accept ("I'll take this one") / decline, driven by `status`                   | none. CTA stays fixed and Nearby-worded; a business never supplies button text or links. |
| Expiration        | `expires_at` column + expiry job (`status='expired'`)                        | Verify the offer writer sets a sensible default before the reveal UI promises a countdown (do not show a timer built on a null). |
| Redemption instructions | Only on standing `brand_offers.redemption_instructions`. A request offer's terms travel in the description ("usual terms" line). | Real gap: no structured field on a request offer. Add `redemption_instructions text` (<=500) in Phase 2 through the SAME `submit_business_offer` path (drop the old overload explicitly), screened like the description. |

## Phase 2 must, in this order
1. **Screen media before it reaches a consumer.** Offer media is currently accepted "unscreened" (only the text is classified). Text-only offers are fine today; video makes an unreviewed business clip appear inside a consumer's own request. Require an image classification of a poster frame (the logo classifier already does vision) and hold-for-review on medium/uncertain, fail closed on a screening outage (same 503 path as text).
2. **Player** (`expo-av` is already a dependency): tap-to-play, muted by default, never autoplay-with-sound, poster frame first, size/duration cap at upload (e.g. 30 s, 20 MB), Reduce Motion respected, no autoplay on the list -- only inside the opened offer.
3. **Animated reveal** through the Motion system: a "Coastal Coffee sent you an offer" beat -> title -> media -> price line -> Accept. Use `SEQUENCES` tokens, business-transaction tone (fast, trustworthy per Item 122), no haptic on arrival (Item 130), collapses to the settled card under Reduce Motion. The reveal is presentation only: the same offer data, same Accept.
4. `redemption_instructions` (above), shown after acceptance in the booked view.

## Rules that stay fixed
- Minimum-payload/privacy: media is shown only to the requester of that offer; nothing about the requester goes to the business.
- No invented numbers: price/savings lines come only from `offer_price`/`discount_pct`; never a computed "you save".
- The business owner never gets a free-text CTA or link; Nearby owns the action wording.
- AI-free quick response (standard availability) stays media-free and unchanged.

## Existing creative as the creative layer (item 28, 2026-09-20)
The business's own ad/video is the CREATIVE; the offer stays the structured object ("2 drinks + pastry for $12, valid until 7 PM,
Accept"). Nearby never turns a creative into the offer.

| Option asked for     | Decision |
|----------------------|----------|
| Upload photo / video | Built in Phase 2 (screened; video through sampled frames). |
| Use existing creative | Built: `business_creatives` library. Media that passes screening in an offer is saved automatically; the next offer picks it as a thumbnail ("Use your saved creative"): no re-upload, no re-screening (a creative is an immutable, already-screened file). Owner-read only; archive = remove from the list. |
| Paste supported media/content (link) | NOT built, on purpose: an external link cannot be screened by Nearby, can change after approval, and would play or send the customer off-app (breaks "never feels a marketplace"). To reuse an ad, the owner uploads the file once. A future "import from a link" would have to download + store + screen the file itself before it could become a creative. |
| Create simple offer | Unchanged (fixed-text quick response stays AI- and media-free). |
| "Valid today until 7 PM" | Built: `business_request_offers.valid_until`, owner-picked (Today/Tomorrow + time picker, never inferred), <= 30 days, enforced by `accept_business_offer` and swept by `expire_stale_business_requests`; the customer sees "Valid until 7:00 PM" and no Accept once it passes. |

The library only ever holds media whose OWN screening tier was low (a held/blocked media is never saved). Held offers approved by a
reviewer carry `creative_id` and `valid_until` (refused if the end time has since passed).
