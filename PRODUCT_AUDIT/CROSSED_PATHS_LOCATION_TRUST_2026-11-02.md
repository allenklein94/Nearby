# Crossed Paths: limit bypass check, client-supplied location risk, Privacy Policy draft (2026-11-02)

Scope: migration 20270384 (staged, NOT deployed) + the `report-presence` source. Owner asks (2026-11-02): confirm the probe
limits can't be trivially bypassed by resetting a session or switching accounts; assess and document the remaining risk of
client-supplied location squares (no new tracking or fingerprinting system); make the Privacy Policy describe mutual opt-in,
approximate proximity, retention and turning it off. Everything below is from code reading + the local replay
(journey `crossedPathsSafeguards`, `scripts/replay/crossed-paths-concurrency.js`); nothing ran on production.

## 1. Can the limits be bypassed?

The limits (owner approved as initial values 2026-11-02: a new square at most every 30 s, at most 20 new squares per rolling
hour, an eligible square lasts 10 minutes, a crossing refreshes at most once an hour) live in `private.crossed_paths_probe`,
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
  - after the first hit, the same pair refreshes at most once an hour, and a refresh sends no new push. So an attacker
    who keeps claiming the target's suspected square can see the crossing's "N hours ago" stay fresh, i.e. confirm hourly
    that the target is still around there, without a further notice to the target. Recorded, not changed.

**Options if the owner wants the confirmation residual smaller** (NOT built; each is a separate decision, none is tracking
or fingerprinting):
1. Coarser time on the card: show "today" / "this week" instead of "N hours ago", so a refresh confirms nothing new.
2. No refresh at all: a crossing records the first time only, until it expires (48 h); repeat claims learn nothing.
3. Tell the target again when a crossing refreshes after more than a day (makes repeated probing visible).

Recommendation: decide on (1) or (2) before external launch; both are small and server-side or copy-only. Until then, the
residual is: two people who both turned it on, one of whom guesses the other's location, can confirm it roughly hourly,
after the target has been told once who crossed paths with them.

## 3. Privacy Policy (DRAFT, publish with 0384; not published; docs/privacy.html unchanged on this branch)

Replace the "Crossed Paths" paragraph in §2 (it currently starts "For "Crossed Paths" matching: to detect when two users are
near each other...") with:

> For "Crossed Paths": this is off unless you turn it on in Settings ("Show when I cross paths with people"). You and another
> person see that you crossed paths only if you have BOTH turned it on, you are both in Dating or both in Friends, neither of
> you has blocked the other, and you were near each other in the last several minutes. "Near" is approximate: Nearby never
> shows a distance or where it happened. To detect it, the App sends a rounded version of your current location (an area
> of a few dozen meters). We keep only your most recent one, never a history or trail of your movements, and it is deleted
> automatically after one hour; with Crossed Paths on, we also keep the most recent rounded location we used for matching
> for at most 10 minutes, and a count of how often it changed (no location) for about an hour, to prevent misuse. A
> crossed-paths record does not contain either person's actual location: it keeps only an approximate area, a point our
> servers place somewhere inside a fixed grid area several hundred meters across. It expires 48 hours after the last time
> you were near each other and is then deleted automatically (checked every 10 minutes). You can turn Crossed Paths off at
> any time in Settings: your crossed-paths records and the location kept for matching are deleted at once, and no new ones
> are created. Each time you turn it on or off we keep a record of the change and when it happened. Matches, Notices,
> messages and notifications you already received are separate and are not deleted with it.

§3 "With other users": change "visible to other users you've crossed paths with" to "visible to other users you've crossed
paths with (only when you both turned Crossed Paths on)".

§6 retention list: add "The rounded location used for Crossed Paths matching is kept at most 10 minutes; the count of how
often it changed (no location) is deleted after about an hour of inactivity."

Needs: owner approval of the wording, then publish in the same release as 0384 (never before: before 0384 the switch
doesn't exist).

## 4. Wording changed on the branch (no distance anywhere)

- Card: "📍 Within about 35 feet" -> "📍 You crossed paths nearby" (keys renamed `ui.crossedPaths.crossedNearby` /
  `crossedNearbyWhen`; the old "35 feet" understated premium 3 x 3 matches of up to ~30 m).
- Dating mode help + feature description: the distance removed from the parenthesis.
- Crossed Paths info sheet (`discovery.radiusInfoText`): "only if you both chose to be seen there and were near each other
  in the last several minutes" (true before and after 0384).
- Settings helper: "pass near each other" (no number).
All 11 languages; the 10 non-English are machine-authored and need native review. The business website bundle
(`docs/business/`) still has the old card text until its next export (already required before 0348, owner approval).
