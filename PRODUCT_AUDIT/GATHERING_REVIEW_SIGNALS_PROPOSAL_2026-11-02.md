# Gathering review signals: threshold proposal (owner idea 11, 2026-11-02)

Status: PROPOSAL ONLY, awaiting owner decision. Nothing built. Branch `post-tier1/gathering-review-signals` (stacked on
`post-tier1/crossed-paths-safeguards`); off main, build 87 unchanged, nothing deployed. Host-distance signal: NOT built (owner).

## What exists (read from the staged migrations)
- **Review machinery (0363 + 0365, staged):** `private.behavior_signal_settings` (one row, every number null = OFF),
  `private.behavior_events` (short-lived raw events), `private.behavior_signals` (one private note per person per kind),
  review cases in the 0357 queue as `signal = 'behavior'`, ONE open case per person, opened on corroboration (2 different
  kinds within 24 h) or by an "alone" kind; at most 20 new behaviour cases a day, overflow counted + waiting list.
  Never restricts, hides or notifies anyone. Approved precedent: join burst = 15 distinct gatherings joined in 60 min,
  invited joins never count.
- **Creation (0362, staged):** 5 / 15 gatherings per 24 h (new / established), every creation logged in
  `private.limited_action_log` ('gathering', kept 30 days), cancelling never refunds.
- **Cancellation:** `cancel_gathering` DELETES the gathering row; no cancellation record exists today.
- **Capacity:** TOTAL people incl. host, `null` = no limit (Create's DEFAULT), else 4 / 10 / a stepper starting at 15,
  +1 per tap, no upper bound (DB only checks > 0). So most public gatherings will have no capacity at all.
- **Other size anchors:** Trending = 5 joined guests; prod has 26 test gatherings, all past: no real data to calibrate on.

## Fit with the existing system
Each signal is a new KIND in the same tables (no new table except a small cancel log), attached to the HOST (cases are per
person); the gathering id + counts go in `evidence` (no text, no location). Website admin screen: label text for the new
kinds only, no new screen. Same pattern as 0363 -> 0365: one migration with detectors OFF, one with the approved numbers.
Migration order: after 0384.

## Proposed thresholds (starting values, not usage-proven)

### 1. Rapid attendee growth (`attendee_surge`)
- Counts: distinct accounts with a new join row on ONE gathering (or its recurring series) within the window; invited
  joins never count (same rule as join burst); the host never counts; leaving and re-joining counts once.
- **Proposed: >= 15 uninvited joins in 60 min**, mirroring the approved join-burst numbers (15 / 60 min).
- Case rule, **two options for you to choose:**
  - (a) corroboration only (needs a second, different signal on the host within 24 h). Fewer false cases: a popular
    legitimate event never opens a case alone.
  - (b) alone, but only when **at least half of those joiners are New accounts** (0358 trust level: < 7 days or no
    verified phone). This targets coordinated fake attendance specifically.
  - Recommendation: **(b)**. A popular event joined by established accounts stays a private note only.

### 2. Repeated create-then-cancel (`create_cancel`)
- Needs a new minimal log: `cancel_gathering` (and the host's own delete) records host id + created_at + cancelled_at +
  whether anyone else had joined or was invited (no title, no location), kept 30 days like the creation log.
- Counts only cancellations BEFORE the start AND with at least one other person joined or invited (cancelling an empty
  draft harms nobody; weather / illness cancellations of real gatherings are why the count isn't 1).
- **Proposed: >= 3 such cancellations within 7 days, each within 48 h of its creation.**
- Case rule: **alone** (already 3 separate events). Bound: the 5 / 15 daily creation cap still applies.

### 3. Very large public gathering (`large_public_gathering`)
- Public gatherings only (friends-only / private never count). Two triggers, because capacity is usually null:
  - **capacity set to >= 50** at creation or edit (from the stepper's 15 that is 35 deliberate taps), or
  - **joined attendance reaches 25** (5x the Trending threshold), whatever the capacity.
- Once per gathering (series counts once). The gathering is created, shown and joinable exactly as now.
- Case rule: **alone** (the point is a human glance). Recurring series and a host who already had a large gathering
  reviewed with "No action needed" in the last 90 days: no new case (avoids re-reviewing a known regular).

### Shared limits
- All three feed the existing daily cap of **20 new behaviour cases** (overflow kept waiting, never dropped).
- Everything OFF until a separate migration sets your approved numbers.

## Not included
Host-distance (owner: not reliable evidence), automatic actions of any kind, user-facing messages, new screens, scoring.

## Decisions needed from you
1. Attendee surge: 15 in 60 min? Case rule (a) or (b)?
2. Create-then-cancel: 3 in 7 days, each within 48 h, only with someone else involved?
3. Large public: capacity >= 50 or attendance >= 25? Skip known regulars reviewed in the last 90 days?
