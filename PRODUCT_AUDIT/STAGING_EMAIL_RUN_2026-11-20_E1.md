# Staging E1 (verification codes) + Stage A cleanup (2026-11-20, owner approved)

Owner approval (chat, 2026-11-20): E1 on staging incl. wrong code, expired code and the 5-try limit, provided the final code
can still be issued; Stage A cleanup only, with the reviewed script, counts verified before commit; Stage B untouched.
Staging only (`nearby-staging`), test owner W (7bfdc2ed…), address = the approved support@ inbox. Log: scratchpad e1-run.log.

## E1

Before: why a new code can't lock W out (code reading, `business-email`): `start` upserts the row with `code_attempts: 0`,
a fresh code + 30-min expiry, so `too_many_attempts` only blocks the CURRENT code; the next code is always accepted after
the 60 s wait.

| UTC | Step | Result |
|---|---|---|
| 01:08:12 | start #1 | 200 `{ok:true}`; row: verified_at NULL (alerts paused), enabled true, attempts 0 |
| 01:08:13-15 | 5 wrong codes | each `wrong_code` (client: "That code doesn't match. Check it and try again."), attempts 5 |
| 01:08:15 | 6th wrong code | `too_many_attempts` ("Too many tries. Send a new code.") PASS |
| 01:08:27 | code #1 expiry moved into the past (staging SQL), any code | `code_expired` ("That code has expired. Send a new one.") PASS (expiry is checked before the try limit) |
| 01:08:28 | start #2 at 15 s | 429 "Please wait a minute before requesting another code" PASS (cooldown) |
| 01:09:21 | start #2 | 200 `{ok:true}`; attempts back to 0, new code live, still unverified |

Server answers only; the on-screen wording comes from `businessEmailReasonCopy` (not checked in a browser this run).
| 01:12:07 | owner pasted code #2 from the newest email; confirm | 200 `{ok:true}`: verified_at 01:12:07, enabled true, attempts 0, code cleared; W's mutes empty (all alerts on) |

**E1 PASS (server).** W's address (support@, thisisnearby.com) is verified again and email alerts are enabled. Session
revoked (logout 204, refresh 400), file shredded; W has 0 live sessions. Alerts were paused 01:08:12-01:12:07 (no test
alerts sent in that window).

## Stage A cleanup (committed 2026-11-20 ~01:11 UTC)

Pre-check = the reviewed dry run exactly: 2 requests (1ae7f3c6, f4dc22cd; + 2 business rows, 2 plans, 2 routing decisions by
cascade), 13 outbox rows (all to test accounts, 13 of 13), 18 location-aware session records (all for sessions that no longer
exist). Run as one transaction with the fixture guard and exact row-count checks (any mismatch = rollback). After: requests,
request rows, plans, routing decisions, outbox, session records = 0. Untouched (Stage B): 3 test businesses (W, W2, Location 2),
3 memberships, 3 followers, 17 messages, W's email settings row, 4 test accounts, the staging Resend key.
