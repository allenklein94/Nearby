# Item 39 - "A friend is nearby": design for review (2026-10-11)

Status: **DESIGN ONLY, NOT BUILT.** The owner approved the direction (mutual opt-in, accepted friends only, yes/no + fresh
only, Home social line with no push) and asked that the precision, surface, update behaviour, data flow, permissions,
retention and tests be written down and reviewed **before any code**. Nothing below exists yet. The decisions still open
are listed in section 9.

This would be the first Nearby feature that tells one person anything about where another person is. The core principle
(owner): **mutual, revocable consent, never passive tracking.**

## 1. What exists today (and is NOT reused)

| Existing | What it is | Why item 39 does not use it |
|---|---|---|
| `notification_areas` (`20261128_notification_area.sql`) | ~0.7 mi rounded area, read only by push targeting | Its own header: "NOT presence: never shown to another person." Reusing it would quietly change that promise. |
| `presence_reports` + `report-presence` edge fn + `services/proximity.js` | Crossed-paths (dating) area buckets, foreground AND background task | Dating discovery consent is not friend-sharing consent (owner: "permission to use location for discovery is not permission to share it with friends"). It also runs in the background, which item 39 must not. |
| `services/userLocation.js` | The one place the app gets a fix (foreground permission, cached) | **Reused** as the only source of the fix (standing rule: location only through it). It gains no new permission. |
| `friendships` (`status = 'accepted'`) | Platonic friend connections | **Reused** as the only eligibility relation. `matches` is never read. |
| `viewer_blocked_either_way` / `is_blocked` | Server-side two-way block check | **Reused** inside the read (standing rule). |
| `getHomeInsight` (`services/homeDashboard.js:772`) | Home's single social line + CTA | **Reused** as the only surface (a new `friend_nearby` kind). |
| `CreateGathering` `suggestedInviteeIds` | Create opens with friends preselected in Who | **Reused** for "Invite {Name}". |

## 2. Consent (owner-approved)

- One setting, **off by default**: "Let friends know when I'm nearby" (Settings, Privacy section), with one plain sentence
  under it: what friends see ("that you're nearby, never where"), who (accepted friends who also turned this on), and that it
  only works while you're using Nearby.
- Never turned on by onboarding, a friend request, dating preferences, gathering attendance, a location-permission grant,
  or any other flow. Only this toggle sets it. A guard test enforces that only the Settings toggle calls the enabling RPC.
- **Mutual:** you see a friend only if you BOTH have it on. Someone who has it off sees no one, so nobody can watch
  without being visible.
- **Turning it off is immediate:** one RPC deletes your consent row AND your stored fix in the same transaction. From that
  moment you are invisible and see no one.
- Shown state: while it's on, the Settings row says "On" and the setting is one tap away. (Open question 9.4: a quiet
  reminder on Home that you're sharing.)

## 3. Eligibility (owner-approved), decided server-side on every read

Viewer V sees friend F as nearby only if ALL of these hold at read time:

1. `friendships` row between V and F with `status = 'accepted'` (pending, declined, removed: never). Dating matches are never
   read; a match who is not also an accepted friend is never eligible.
2. Neither has blocked the other (`viewer_blocked_either_way`).
3. Both V and F currently have sharing on.
4. Both V's and F's stored fixes are **fresh: under 30 minutes old**. V's own fix must be fresh, so a stale or absent
   viewer can't probe.
5. The distance between the two fixes is **under ~1 mile** (initial parameter).

Unfriending, blocking or turning sharing off takes effect on the next read, because nothing is cached server-side. There is
no stored "F is nearby" fact.

## 4. Precision and what leaves the server

- The read RPC `get_nearby_friends()` returns ONLY `[{ friend_id, display_name, avatar_url }]` for friends who pass section 3.
  It returns no coordinates, distance, direction, area, timestamp, "last seen", or freshness.
- **"Not nearby" is indistinguishable:** a friend who is far, has sharing off, has a stale fix, has blocked you, or
  doesn't exist simply isn't in the list. No error, count or reason varies between those cases (owner's side-channel rule).
- **Order never leaks closeness:** the list is ordered by display name, never by distance.
- Stored precision: the fix is stored at 3 decimal places (about 100 m), enough for an honest ~1 mi test without boundary
  artefacts from a coarse grid. It is never returned to any client, including the owner of the fix.

## 5. Location updates (foreground only)

- A fix is sent only **while the app is open in the foreground**, from the existing `userLocation.js` fresh-fix path, and only
  while sharing is on. It is throttled to at most one report per 5 minutes, or sooner if the person moved more than about
  0.25 mi.
- **No background reporting, no background-location permission, no new task.** Close the app and within 30 minutes you're
  no longer nearby to anyone. That is the intended meaning: presence while you're actively using Nearby.
- **Permission:** the toggle asks for foreground location only if it's undetermined, with the purpose stated in the sentence
  under the toggle. If permission is denied or revoked in system settings, the toggle stays as set, nothing is reported, the
  row says "Location is off: friends can't see you're nearby", and you see no one (rule 4: no fresh own fix).
- The write RPC `report_friend_nearby_fix(lat, lng)` refuses (no error detail to the client) when sharing is off.

## 6. Storage and retention

- `friend_nearby_sharing(user_id pk, enabled_at)`: the consent. RLS on, no direct grants; written only through
  `set_friend_nearby_sharing(on boolean)`.
- `friend_nearby_fixes(user_id pk, lat, lng, fixed_at)`: **one row per person, overwritten**, so there is no history or trail.
  RLS on, no grants to anon/authenticated, never in any view, export, analytics event, `behavior_events` or log.
- Retention: a fix is meaningless after 30 minutes. It is deleted when sharing is turned off, ignored by reads once stale,
  and purged by a scheduled job once older than 30 minutes (mechanism confirmed at build, e.g. pg_cron if available). It
  also cascades on account deletion.
- New functions: `revoke ... from public, anon`, grant to `authenticated`, `security definer`, `set search_path`.

## 7. Surface: Home social line only, no push (owner-approved)

- A new kind `friend_nearby` in `getHomeInsight`: the friend's avatar + "{Name} is nearby", with CTA "Invite {Name}". When
  more than one friend is nearby, see 9.2.
- Nowhere else in v1: not Discover, People, profiles, chat, a map, a list screen or Activity. No new screen and no
  registry entry.
- **No push**, no notification type, no mute group, and nearby status never triggers a notification by any route. A guard
  test asserts `get_nearby_friends` / `friend_nearby_fixes` appear in no push trigger or `_send_push` path.
- Re-read on every Home focus. The line is never shown from a cached result older than the focus.
- **Invite {Name}** opens the existing Create flow with `suggestedInviteeIds: [friendId]`. Nothing is created or sent until
  the person completes Create and publishes. The invite itself never mentions "nearby". Before sending, the existing invite
  RPC must reject a non-friend or a blocked pair. **To verify at build:** that the current gathering-invite RPC enforces
  accepted friendship + blocks server-side; if it doesn't, that's fixed in the RPC (shared source), not in this flow.
  Nearby status is not required at send time (inviting a friend never needed it).

## 8. Tests and journey (to be written with the build)

Jest (pure + guards):
- `getHomeInsight` returns `friend_nearby` only from a non-empty `get_nearby_friends` result; never with a distance/time.
- Guards: only the Settings toggle calls `set_friend_nearby_sharing(true)`; no screen reads `friend_nearby_*` tables
  directly; nearby status is in no push path; reporting is not registered in any background task; the location comes only
  through `userLocation.js`.
- Throttle: one report per 5 min unless moved more than 0.25 mi; nothing reported while sharing is off or permission is
  not granted.

Journey `src/journeys/friendNearby.journey.js` (live DB, rolled back), with A and B accepted friends:
1. Both on, fresh fixes 0.5 mi apart -> each sees the other.
2. A turns off -> neither sees the other, and A's fix row is gone.
3. B's fix 31 min old -> not shown; A's own fix stale -> A sees no one.
4. 1.5 mi apart -> not shown.
5. A blocks B (either direction) -> not shown; unblock restores.
6. Unfriend -> not shown. Pending friendship -> never.
7. A dating match with both opted in, not friends -> never.
8. The result rows carry exactly `friend_id, display_name, avatar_url`, identical in shape for every "not nearby" cause
   (an empty list).
9. `report_friend_nearby_fix` while off stores nothing.
10. An anon/unauthenticated call is refused.

Not coverable without a device: the permission prompt, foreground/background behaviour, how the Home line looks. A device
checklist ships with the build.

## 9. Open decisions for the owner (before build)

1. **Spoofing residual.** A mutual friend could send fake coordinates to narrow down where you are by repeated probing
   (~1 mi resolution). Proposed mitigations: the 5-minute report throttle, rejecting a fix that implies impossible travel
   speed since the last one, and a per-viewer read rate limit. It can't be eliminated without trusted device location.
   Accept with these mitigations?
2. **Several friends nearby.** Proposed: first name by alphabetical order + "and 2 other friends are nearby", up to 3
   avatars, with Invite opening Create with all of them preselected. Or show one friend only?
3. **Priority on the line.** `getHomeInsight` shows ONE line (today: friends planning > meet > starting soon). Proposed:
   `friend_nearby` first, since it's the most time-sensitive and only exists while you're both in the app.
4. **A sharing reminder.** While sharing is on, show a quiet "Friends can see you're nearby · Turn off" under the line, or
   keep it in Settings only?
5. **Parameters.** Confirm 30 min freshness, ~1 mi radius, 5 min / 0.25 mi throttle as the starting values.

New strings (toggle, explanation, line, CTA, permission-off note) need all 11 languages and native review, like every item
since 2026-09-28.
