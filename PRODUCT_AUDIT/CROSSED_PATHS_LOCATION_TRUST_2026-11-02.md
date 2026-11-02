# Crossed Paths: limit bypass check, client-supplied location risk, Privacy Policy draft (2026-11-02)

Scope: migration 20270384 (staged, NOT deployed) + the `report-presence` source. Owner asks (2026-11-02): confirm the probe
limits can't be trivially bypassed by resetting a session or switching accounts; assess and document the remaining risk of
client-supplied location squares (no new tracking or fingerprinting system); make the Privacy Policy describe mutual opt-in,
approximate proximity, retention and turning it off. Everything below is from code reading + the local replay
(journey `crossedPathsSafeguards`, `scripts/replay/crossed-paths-concurrency.js`); nothing ran on production.

## 1. Can the limits be bypassed?

The limits (owner approved as initial values 2026-11-02: a new square at most every 30 s, at most 20 new squares per rolling
hour, an eligible square lasts 10 minutes) live in `private.crossed_paths_probe`,
one row per ACCOUNT (`user_id`). Clients have no access to it; only the presence trigger and the switch write it.

| Attempt | Result |
|---|---|
| Sign out / sign in, new session, new access token, reinstall | No effect: nothing is keyed by session or device. |
| Send many reports at once | Serialized on the account's row (`for update`): 8 parallel new squares = 1 counted (concurrency script, step 1). |
| Delete own presence and report again | No effect: the counters are on the probe row, not the presence row (journey `off_on_and_presence_reset_keep_limits`). |
| Switch Crossed Paths off and on | **Was a bypass in the first 0384 draft** (off deleted the row, resetting the counters). FIXED: off now clears only the stored square; the counters (timestamps + a count, no location) stay until the row has been idle an hour (same journey step + `after_reset_exact_hit_not_recorded`). |
| Jump far between reports | report-presence still refuses > 700 mph against the account's own last report; 30 s at 700 mph = ~5.8 mi, so the speed check doesn't widen anything. |
| Delete the account, make a new one | New allowance, but needs a new verified phone (0352), a screened photo, the Dating/Friends pool and the switch; and every hit is announced to the target (below). |
| Several accounts at once | Each account has its own allowance: N accounts = N x 20 squares an hour. Not "trivial": each needs its own verified phone (0352), and many accounts on one phone open an admin review case once 0376 is activated (staged, detection off). No per-device or per-network limit was added (that would be the fingerprinting the owner declined). |

Conclusion: no trivial bypass remains; the multi-account case is bounded by phone verification and is a recorded residual.

## 2. The remaining risk of client-supplied squares

**What the server knows.** The phone sends a square (~11 m, 4 decimals). The server cannot check that the phone is really
there: a modified client or a GPS-spoofing tool can claim any square. Rate limits make *guessing* expensive; they don't
prove presence. Nothing in 0383/0384 changes that, and nothing short of hardware attestation of location (not available
to apps) would.

**What an attacker needs.** Their own verified account in the same pool (Dating or Friends) with Crossed Paths ON, and a
target who ALSO turned it on. Nobody who left the switch off can be found this way at all.

**What a claimed square can reveal.** A crossing is recorded only when both people have a fresh (< 10 min) eligible square
at most one square apart: roughly a 3 x 3 block, about 33 m x 30 m (~0.001 km2).

- *Sweeping an area* (attacker doesn't know where the target is): 20 guesses an hour cover ~0.02 km2 an hour, so 1 km2 takes
  about 50 hours per account, during which the target must stay put. Before 0384: about 2 minutes. Practically closed.
- *Confirming a guess* (attacker already suspects a place: home, work, a gym): one guess can confirm "within ~30 m in the
  last 10 minutes". **This is the real residual.** Limits on it:
  - the first hit creates a crossing and sends the target a "You crossed paths!" push with the attacker's own profile
    (the attacker is never anonymous to the target);
  - the target can block (hides it both ways at once) or switch Crossed Paths off (deletes it at once);
  - **one encounter per pair until it expires (owner decision 2026-11-02, BUILT in 0384):** the crossing is written once and
    never refreshed, so repeated claims of the target's square confirm nothing new for 48 hours. Switching off and on,
    leaving and rejoining Dating/Friends, or blocking and unblocking can't create a fresh one either: a private memory of
    the pair (`private.crossed_paths_encounters`: the two account ids + the expiry, no location, no crossing time, no client
    access) survives those and is deleted at the expiry (purge every 10 min) or with either account. After it expires, a new
    crossing is a new encounter and the target is told again (inherent to the feature).

**Options considered** (owner chose 2, 2026-11-02): 1. coarser time on the card (DECLINED: hides it on screen, repeated
updates still reveal it); 2. no refresh, one record per encounter (BUILT); 3. re-notify after a day (not needed with 2).

Remaining residual (by design, disclosed): two people who both turned it on, one of whom guesses the other's location, can
confirm "within ~30 m in the last 10 minutes" once per 48 hours per pair, and the target is told who it was each time.
Verified locally (2026-11-02): journey `crossedPathsSafeguards` 48/48 (no refresh within or after the hour, off -> on and
pool rejoin = no new encounter, expiry = a new one told once each, also on an unpurged row; fails 48/48 with 0384 rolled
back); `crossed-paths-concurrency.js` step 5 (4 rounds of off/on racing re-crossings: no second encounter, one push each;
FAILS with the memory trigger disabled).

## 3. Privacy Policy: FINAL WORDING FOR LEGAL REVIEW (not published; docs/privacy.html unchanged)

Status (owner, 2026-11-02): substance APPROVED IN PRINCIPLE, with two clarifications now made: (1) the approximate area is
stored internally and never shown to anyone; what the other person sees is listed separately; (2) switching off deletes
location and crossing records at once, but a minimal record (the two account IDs + its expiry) stays up to 48 hours to
prevent repeat encounters. Next: legal review of this text, then a SEPARATE owner approval to publish, in the same release as
0384 (never before: the switch doesn't exist until then). Matched against the live `docs/privacy.html` (§2 line 34, §3 line 52,
§6 lines 66-67) so the three sections agree.

**§2: replace the paragraph that starts "For "Crossed Paths" matching: to detect when two users are near each other..." with:**

> **Crossed Paths (optional, off by default).** Crossed Paths is off unless you turn it on in Settings ("Show when I cross
> paths with people"). Nearby tells you and another person that you crossed paths only if you have BOTH turned it on, you
> are both in Dating or both in Friends, neither of you has blocked the other, and you were near each other within the last
> several minutes. "Near" is approximate, roughly within a few dozen meters.
>
> *What the other person sees:* a notification at the time ("You and {your display name} were near each other just now",
> if they allow notifications), and in Crossed Paths: that you crossed paths, when it happened (how long ago, with the date
> and time to the minute), and your profile (display name, photos, bio and the details you chose to share). They never see a
> distance, an address, a map point or where it happened, and nobody sees your location.
>
> *Shared gatherings are separate:* the same Crossed Paths list can also show people you both attended a past gathering
> with ("You were both at {gathering}"). That comes from gathering attendance, not location, and does not depend on this
> setting.
>
> *What we use and keep:* to detect crossings, the App sends a rounded version of your current location. We keep only your
> most recent one, never a history or trail of your movements, and delete it automatically after one hour. While Crossed
> Paths is on, we also keep the rounded location we last used for matching for at most 10 minutes, and a count of how often
> it changed (no location) for about an hour, to limit misuse. When you cross paths with someone we create one record: the
> two accounts, when it happened, and an approximate area used only inside our systems (a point our servers place somewhere
> inside a fixed grid area several hundred meters across, never either person's actual location, and never shown to anyone).
> The record is not updated if you keep crossing paths, and it is deleted automatically 48 hours after it was created
> (checked every 10 minutes).
>
> *Turning it off:* you can turn Crossed Paths off at any time in Settings. Your crossed-paths records and the location kept
> for matching are deleted immediately, and no new crossings are recorded for you. One minimal record is not deleted
> immediately: for each person you had crossed paths with, we keep only your two account IDs and the time this record
> expires, for up to 48 hours after that crossing was first recorded. It contains no location and no time of the crossing,
> is never shown to anyone, and exists only so that switching Crossed Paths off and on again can't create a new crossing
> with the same person; it is then deleted automatically (or right away if either account is deleted). We also keep a
> record of each time you turn Crossed Paths on or off and when. Matches, Notices, messages and notifications you already
> received are separate and are not deleted when you turn it off.
>
> *What it can reveal:* because it is based on being near each other, another person who has also turned it on and is told
> you crossed paths learns that you were near them at about that time. Only turn it on if you are comfortable with that; you
> can turn it off, or block someone, at any time.

**§3 "With other users": replace** "are visible to other users you've crossed paths with, once your photo has passed
moderation." **with** "are visible to other users you've crossed paths with (only when you both turned Crossed Paths on), once
your photo has passed moderation. They are notified when it happens and see when you crossed paths (date and time), never where."
(The next sentence, "Your exact location is never shown to any other user.", stays.)

**§6 retention list: replace the two Crossed Paths items** ("The rounded location used to detect crossed paths is deleted
automatically after 1 hour." and "A crossed-paths record expires 48 hours after the two users were last near each other; ...")
**with:**

> - The rounded location used to detect crossed paths is deleted automatically after 1 hour. While Crossed Paths is on, the
>   rounded location last used for matching is kept at most 10 minutes, and the count of how often it changed (no location)
>   about an hour after it was last used.
> - A crossed-paths record is deleted automatically 48 hours after it was created (checked about every 10 minutes), or
>   immediately when either person turns Crossed Paths off. The minimal record of the two account IDs and its expiry is
>   deleted at the same 48-hour point, even if Crossed Paths was turned off earlier, or when either account is deleted.
>   Matches, Notices, messages and notifications are separate records and are not affected.

App-behaviour check (2026-11-02, code reading of the 0384 branch): (a) the time shown is the crossing's `last_seen_at`,
frozen at creation by 0384, rendered by `formatCrossedPathsTime` as "3 hours ago (Nov 2, 2:14 PM)" (exact to the minute;
past 7 days the stamp alone) and on cards as "N min ago": the earlier "about how long ago" understated it; (b) the
`crossed_paths_sighting` push (`notify_sighting_crossed_paths`, 20270353, unchanged by 0384) names the other person at the
moment of crossing: it was missing from "what the other person sees"; (c) `get_shared_gathering_partners` cards ("You were
both at {title}") appear in the same Crossed Paths list and are NOT gated by the new switch (unchanged by 0384; Dating side
via `dating_candidates_visible_to_me`, Friends via its own filter): now disclosed as separate. Profile shown = the
Dating/Friends candidate columns (name, photos, bio, age, interests, basics etc.), covered by "details you chose to share".
Wording-only corrections; no feature change. Whether shared-gathering cards should also follow the switch is an owner
product question, not decided here.

Consistency checked (§2 = §3 = §6): off by default + mutual opt-in; approximate area internal only, never shown; one record
per encounter, not refreshed, 48 h from creation; off = immediate deletion except the minimal ID-plus-expiry record up to 48 h;
consent changes logged. Each statement matches 0384 as built (journey `crossedPathsSafeguards`). §2 line 42 ("showing you
people you've crossed paths with") needs no change.

## 4. Wording changed on the branch (no distance anywhere)

- Card: "📍 Within about 35 feet" -> "📍 You crossed paths nearby" (keys renamed `ui.crossedPaths.crossedNearby` /
  `crossedNearbyWhen`; the old "35 feet" understated premium 3 x 3 matches of up to ~30 m).
- Dating mode help + feature description: the distance removed from the parenthesis.
- Crossed Paths info sheet (`discovery.radiusInfoText`): "only if you both chose to be seen there and were near each other
  in the last several minutes" (true before and after 0384).
- Settings helper: "pass near each other" (no number).
All 11 languages; the 10 non-English are machine-authored and need native review. The business website bundle
(`docs/business/`) still has the old card text until its next export (already required before 0348, owner approval).
