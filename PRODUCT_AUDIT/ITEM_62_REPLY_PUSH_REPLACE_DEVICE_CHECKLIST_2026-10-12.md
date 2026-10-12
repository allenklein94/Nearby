# Item 62 — several replies, one notification: device checklist (2026-10-12)

Status: **ALL PENDING.** Built and live (migration `20270303_reply_push_replaces_in_place.sql`, `send-push` v23); journey
`replyPushCollapse` 11/11 and the send-push test pass. Nothing here has been seen on a phone. Item 62 is NOT complete until every
row below is recorded on a real iPhone AND a real Android phone.

Record for each run: device, OS version, app build, Focus/Do Not Disturb off, notification settings for Nearby (sound on/off,
banner style), app state (killed / background / foreground), and the exact result. A failure is recorded, not worked around.

## How to produce the pushes

- One customer account on the phone with an open request (e.g. "Coffee for 4 tonight") that reached 3 businesses.
- Replies through the normal business flow need offer screening (Anthropic credit; never bypass screening). Without credit,
  the second sender works without AI: a business posting availability that fits the request (`post_business_availability`,
  Availability in the business app) produces a real reply push to the customer.
- Send the replies 20-60 s apart with the app in the background or killed; repeat once with the phone locked.

## Checks (iPhone and Android each)

| # | Check | iPhone | Android |
|---|---|---|---|
| 1 | 1st reply: one notification "☕ {Business} responded" with today's body | PENDING | PENDING |
| 2 | 2nd reply: the shown notification is REPLACED (still one in the shade/Notification Center), now "☕ 2 businesses responded" / "See their replies to your coffee request." | PENDING | PENDING |
| 3 | 3rd reply: still one notification, "3 businesses responded" | PENDING | PENDING |
| 4 | **Does each replacing reply sound / vibrate / light the screen again?** Record exactly what happens for the 2nd and 3rd reply, locked and unlocked. (Expected but unverified: iOS and Android alert again on each replacement unless the OS suppresses it; this is the owner's open question.) | PENDING | PENDING |
| 5 | A reply to a DIFFERENT open request appears as its own, separate notification and never replaces the first request's | PENDING | PENDING |
| 6 | Tap the 1-reply notification: opens that request on that offer | PENDING | PENDING |
| 7 | Tap the roll-up: opens that request (all replies), not one business's offer | PENDING | PENDING |
| 8 | The "View Offer" action button still appears on both the single and the roll-up notification | PENDING | PENDING |
| 9 | App in the foreground: the in-app arrival pill still says "2 offers came in" style (unchanged), and the OS banner behavior is recorded | PENDING | PENDING |
| 10 | Android notification channel "important-alerts" is unchanged (no new channel appears) | n/a | PENDING |

## Known limits (accepted by the owner, 2026-10-12)

- The count is true when the push is sent. A business withdrawing later does not change a notification already on the phone.
- A retry (hand-off failure) is re-worded from the live count at that moment; with no open reply left it is not sent.
- Delivery order between two pushes seconds apart is decided by APNs/FCM; if they arrive out of order the phone can briefly show
  the earlier (lower, but true when sent) count. Record it if seen.
- Push text is English only, like every push.
