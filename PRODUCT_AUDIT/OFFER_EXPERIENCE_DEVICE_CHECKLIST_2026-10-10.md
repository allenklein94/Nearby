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

## 1. Request sent (moment 1)

- [ ] Customer asks for coffee for 4 tonight. The just-sent line reads "We asked N nearby businesses…" and two soft rings
  go out behind it once. ★ With Reduce Motion: the line only, no rings.
- [ ] A duplicate request, or one that reached nobody: no rings.
- [ ] Business gets the opportunity push/digest per its rules; the card opens on Opportunities.

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
- [ ] Tap the pill: the screen dims slightly, a point of light travels into the offer card, the coral frame settles on it.
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
- [ ] Booking still confirming / failed: reads "Offer accepted · confirming your booking" / "…didn't go through".
- [ ] Group plan: "You're booked" only after everyone needed confirmed.

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

## Record

| Step | iPhone | Android | Chrome | Safari | Phone browser | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
