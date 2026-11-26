# Concurrency timing failure: investigation (2026-11-26, local replay only)

**Symptom.** `held-evidence-concurrency.js` check 4 ("two accounts under one hold deleted at once: neither waits for the
other") failed once during the build 88 rehearsal while an iOS export ran beside it; 3/3 passes alone.

**What check 4 did.** It counted a round as "queued" if the two deletions together took longer than 640 ms wall-clock
(2 x 120 ms hold + 400 ms).

**Controlled reproduction** (replay DB at 0433, the original check-4 logic, 30 rounds each, a lock-wait detector polling
`pg_stat_activity` every 5 ms for a `delete` waiting on a Lock; detector positive-controlled: it does catch a real row-lock queue):
| Condition | Over 640 ms | Real lock waits | Elapsed min / median / max |
|---|---|---|---|
| idle machine | 1/30 | 0 | 241 / 257 / 687 ms |
| 4 CPU burners on 2 cores | 0/30 | 0 | 379 / 403 / 627 ms |

**Conclusion.** Not a product defect: in 60 rounds the deletions never waited on each other's locks; only wall-clock time
moved with machine load (and once crossed the bound even idle). The test, not the migration, was wrong.

**Fix (test only, no migration or app change).** Check 4 now uses a barrier: each deletion stays open until BOTH have
finished their statements (5 s limit). A deletion blocked by the other's locks can't finish while the other is open, so the
barrier times out and the round fails as queued. Mutation proof: forcing the second deletion onto the same account =
"queued 8/8", FAIL. Under 4 CPU burners: ALL PASS. Same fragile upper-bound pattern fixed in
`screening-single-use-concurrency.js` (B now runs with `lock_timeout 5s` while A is still open: B returning proves no wait)
and `suspended-number-concurrency.js` (hold 1.5 s -> 6 s, bound 1.2 s -> 5.5 s). Both pass under the same load. The other
timing checks are LOWER bounds ("must have waited"), which load cannot break.
