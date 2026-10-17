# Offer experience: device + browser checklist (2026-10-10)

Owner decision (item 17): no more offer presentation options until this pass is done. Everything below is built and
covered by Jest / journeys / rolled-back live scripts; none of it has been seen on a real phone or browser.

**Status: not yet executed.** Mark each line pass / fail / note, with the device, OS version and build.

## Setup

- Two signed-in accounts: a **customer** and a **business owner** (an approved business with an address, hours and a
  largest group size set), within each other's radius.
- Phones: one iPhone and one Android, both on a build that includes `expo-video-thumbnails` (needed for video screening).
  Business website: `docs/business/` on GitHub Pages in desktop Chrome + Safari, and a phone browser.
- **Anthropic credit must be added first.** Without it every offer check ends as an outage: the customer sees
  "responding…" briefly, then nothing, and no offer is ever published. Steps 4-7 cannot pass until credit exists.
- Test once with Reduce Motion **off**, then repeat the starred (★) steps with Reduce Motion **on**
  (iOS: Accessibility > Motion; Android: Remove animations).

## Recording rules and overlaps (2026-10-12)

- Do not bypass offer screening while Anthropic credit is unavailable. Steps that depend on a screened reply stay PENDING until
  credit is added. A failure is recorded as seen; locked behavior is never changed to work around it.
- Keep each platform's column separate (Record table). An untested platform stays PENDING.
- The same observation counts on these other lists, with the same device row:
  - section 1, bullets 1-2 = item 55 #1;
  - section 4, bullets 1-3 = item 55 #7 (business responds stays the signature, outside the Pulse);
  - section 6, bullets 1-2 = item 32 section 3 (the merge plays right after the accept);
  - section 8, bullet 3 = item 28 #1, #9 and #11.

## 1. Request sent (moment 1)

- [ ] Customer asks for coffee for 4 tonight. The just-sent line reads "We asked N nearby businesses…" and two soft rings
  go out behind it once. ★ With Reduce Motion: the line only, no rings.
- [ ] A duplicate request, or one that reached nobody: no rings.
- [ ] (idea 158) The line is readable from the very first frame (never after the rings), reads exactly "We asked N nearby
  businesses. You'll be notified when they respond.", and N = the businesses that really got it: compare with the business
  side (each reached business sees the opportunity) or `select count(*) from business_request_offers where request_id = ...`
  (service role). Never the number searched. One business reached = "We asked 1 nearby business."
- [ ] (idea 158) Reduce Motion on: the line only, no rings, nothing else changes. No larger animation, no extra confirmation screen.
- [ ] Business gets the opportunity push/digest per its rules; the card opens on Opportunities.
- [ ] (idea 157) Ask ONE business (Ask Coastal Coffee): Send replaces the form with the request screen at once (no
  confirmation step, no return to Home/Discover); the line reads "Request sent to Coastal Coffee. You'll be notified when
  they respond."; rings only when it really reached them. Later, the reply push opens that exact reply.
- [ ] (idea 157) The success banner plays N -> ✨ -> ✓ AND the Pulse rings together: record whether the pair feels like
  too much ("a massive confirmation"). Report only; both are approved, never change motion from this check.

## 2. Business replies

- [ ] Business: Accept → Standard availability (one tap). Customer gets the reply without the AI check (fixed text).
- [ ] Business: Special offer with a title, price, 20% discount, a photo, an available window and "valid until".
  Preview offer shows the same card the customer will see. Send.
- [ ] Business: "Your offers" shows Reviewing your offer… → Offer sent (or In review / Needs changes with a reason).
- [ ] A video over 30 s, or one with unknown length, is refused on the phone with the plain message.

## 3. "Coastal Coffee is responding…" (item 16)

- [ ] Customer has the request open while the business presses Send on a special offer: the line appears with one dot
  pulse, within a few seconds. ★
- [ ] Business only opens the request or the editor without sending: the customer sees **nothing**.
- [ ] Reply published: the line disappears and the timeline reads "Coastal Coffee made you an offer".
- [ ] Reply held for the team / refused / check fails: the line disappears quietly, no offer appears.
- [ ] Leave the screen and come back mid-check: line still shown only if the check is still running.

## 4. Arrival and reveal (moments 2-3)

- [ ] Customer on another screen when the reply lands: the pill "✨ Coastal Coffee made you an offer" appears near the top
  (check its position under each header), holds ~6 s, leaves on its own. Any OS banner that overlaps it: note it.
- [ ] Tap the pill: the screen does NOT dim (owner, 2026-10-12, same as item 23); a point of light travels into the offer card,
  the coral frame settles on it.
  ★ With Reduce Motion: the screen just opens on the outlined card.
- [ ] The card builds step by step: business + logo → "Heard your request" → status → offer → price ("20% OFF") → when →
  "I'll take this one" with one coral glow. The button is tappable throughout. ★
- [ ] Reply arriving while the request is already open: the card builds in place (fixed in item 16).
- [ ] Reopening the request later: the card is already finished, nothing replays.
- [ ] First-ever reply: pill reads "A local business just responded to your request"; the card says "Your first reply
  from a local business". Never again after that.

## 5. Media presentation (items 10-11, locked by item 17)

- [ ] Landscape photo fills the frame; portrait flyer, square graphic with text and 9:16 video poster are shown whole over
  a blurred copy (no text cut off, no bars). Note how strong the blur looks on iOS vs Android.
- [ ] Video: poster only, nothing plays or downloads until tapped; then plays muted with controls.
- [ ] Wide wordmark logo and square logo both fit their circle without touching the edge.
- [ ] Two businesses replying to the same request: both cards have the same structure; only content differs.
- [ ] "Today · 5–9 PM" combined line when valid until is at or after the window end; the countdown keeps its own line
  when ending soon, and updates without leaving the screen.

## 6. Acceptance (moment 4)

- [ ] Tap "I'll take this one" (one tap only; a second tap does nothing while it is working).
- [ ] The same card becomes the booked card: ✓ ring + "You're booked", then business, when, "4 people", then How to redeem.
  Success vibration once. ★ With Reduce Motion: the finished card, no animation.
- [ ] The rest of the screen does NOT slide or fade to its new layout (screen-wide smoothing removed, owner 2026-10-12): only the
  accepted card animates, then item 32's gentle scroll to Your Plan. Record whether the acceptance feels jumpy; if it does, report
  it, do not add motion (see `OFFER_SCREEN_WIDE_MOTION_DEVICE_CHECKLIST_2026-10-12.md`).
- [ ] Booking still confirming / failed: reads "Offer accepted · confirming your booking" / "…didn't go through".
- [ ] Group plan: "You're booked" only after everyone needed confirmed. After ~4.5 s the card fades with a slight shrink; the
  content below then moves up in ONE step (no smooth slide). Record whether that reads as a jump.

## 7. Business progress and redemption (moments 5-6)

- [ ] Business dashboard open while the customer accepts: push "A customer accepted your offer"; the card's line moves
  Offer sent → Accepted with one green glow within ~1 s, no vibration. Reopening the dashboard replays nothing.
- [ ] Business confirms the visit (code or Mark as completed): business card shows Redeemed; customer's booked card shows
  "✓ Visit confirmed" live with one glow if the customer has it open.
- [ ] Same steps on the business **website**, desktop and phone browser.

## 8. Motion only for real events (item 15)

- [ ] Tapping Discover chips/tabs, switching Things/People and Dating/Friends, the Messages tabs, and changing filters:
  instant, no pop or dip. Does it feel calm or abrupt? Note it.
- [ ] Long lists (Discover, offers, group plan options) appear without a cascade.
- [ ] Host with their gathering open while someone joins: the Going figure updates within ~1 s and glows once in green;
  no vibration; a second identical event does not replay it. ★

## 9. Two times in one reply (item 119, added 2026-10-16)

- [ ] Business, Make an Offer with "Alt. time": after the first time, "+ Add another time" appears; picking a second time shows it
  with a Clear chip; Clear removes only the second time. The live Customer Preview shows both times as plain lines.
- [ ] Business, Offer Alternative sheet: same "+ Add another time"; the sent text reads "...one of these times instead." with two
  times, "...this time instead." with one.
- [ ] Customer: ONE card for that business (never two), both times as rows under "Pick a time"; "I'll take this one" is dimmed
  and does nothing until a time is tapped; the tapped row turns coral at once (no animation). VoiceOver/TalkBack reads each row as
  "Choose <time>", selected state announced.
- [ ] Customer asked for 7 PM and the reply offers 8:30 PM and 7 PM: if it is "Our pick", "Fits 7 PM" sits beside the 7 PM row
  only (not on the pick line, never beside 8:30).
- [ ] Taking 8:30: the booked card, Your Plan and Plans all say 8:30; no trace of 7 PM anywhere.
- [ ] Group plan (2+ phones): each person picks a time and confirms; "N of M confirmed" counts the time picked on that phone;
  people choosing different times = nothing books; one person switching to the others' time books it once, at that time.
- [ ] A one-time reply looks and books exactly as before (no rows, no "Pick a time").

## 10. One business revision: price and time only (item 118, added 2026-10-16)

Revisions carry no text or media, so this section needs no Anthropic credit once an offer exists (the ORIGINAL offer still
goes through screening). The `send-push` edge function must be redeployed with the migration for the push's calm priority.
- [ ] Business: under its own open reply (Opportunities), "Change price or time" appears only on a reply it wrote by hand (never on
  an automatic/availability reply) and only while the offer is open. The sheet shows only the fields that reply has (its price,
  its discount, its one or two times) and "You can change this offer once."
- [ ] Business: typing a higher price shows "A changed price can only be lower or the same." and Send stays dimmed; a smaller
  discount shows the discount line; an unchanged sheet can't be sent. The live Customer Preview shows the new terms with "Updated".
- [ ] Business: after Send, "Your updated offer is on its way"; the reply now reads "You've already changed this offer once." and
  the button is gone. The business sees nothing about whether anyone had confirmed or opened it.
- [ ] Customer, request screen open while the business revises: the same card (never a second card) shows the new price/time and a
  quiet "Updated" above the price, with no animation, no old price, no strikethrough, no "save $X". A picked time that no longer
  exists is cleared and "I'll take this one" waits for a new pick.
- [ ] Customer: one notification "<business> updated their offer" replaces the request's existing one (no second banner in the
  tray), with no sound (medium priority); tapping it opens the request on that offer. Record whether the replacement re-alerts.
- [ ] Customer had the card open from before the change and taps "I'll take this one": "Updated / This offer just changed. Check the
  new terms." and the card refreshes; nothing is booked. Taking it again books the NEW terms (booked card, Your Plan, Plans and any
  payment amount all show the revised price/time).
- [ ] Group plan (2+ phones): after some people confirmed, the business revises; every confirmation is cleared, those who had
  confirmed get "Confirm the current terms in your group plan." (opens the group plan), the card shows "Updated", and it books only
  when everyone confirms the new terms.
- [ ] After the customer accepts, a revision is impossible, and a revision push queued just before is not delivered.

## Record

| Step | iPhone | Android | Chrome | Safari | Phone browser | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
