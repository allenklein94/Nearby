# Lifecycle action enforcement audit (owner, 2026-10-24, after idea "391")

Read-only. Scope: the LIFECYCLE actions the matrix flagged as never asked through `canDo`, and its 5 "missing" mappings.
Method: the LIVE production definitions (`pg_get_functiondef`), RLS policies, column grants and triggers, read on 2026-10-24,
plus the client gating. Nothing was executed against data; every finding below is CONFIRMED BY CODE READING, not by a run.
No behaviour, database or screen was changed.

Matrix correction: 3 of the 13 flags were false positives. GatheringDetail asks `canDo` through a local wrapper
(`const can = (action) => canDo('gathering', …, action)`): `can('edit')` (Edit + Cancel), `can('dismiss')`, `can('interested')`.
The generator now recognises such wrappers; 10 such flags remain.

## The 13 actions

| Action | Server (live) | Client | Verdict |
|---|---|---|---|
| gathering.cancel | `cancel_gathering`: host only, row lock, refuses once `scheduled_at` passed; cancels bookings (paid = refused, told to contact the business), open requests, pending/offered replies, plan | `can('edit')` | Enforced |
| gathering.edit | NONE: direct `UPDATE gatherings`, RLS = host only, no state check | `can('edit')`; Edit refuses a past time | See D1, R1 |
| gathering.dismiss | `dismiss_recommended_gathering` (personal hide) | `can('dismiss')` | Enforced (private, no one else affected) |
| gathering.interested | `set_gathering_interested`: own, past, blocks, invite-only, women-only | `can('interested')` | Enforced |
| gathering.invite | `invite_friend_to_gathering` + `_gathering_invitee_state`: friends, blocks both ways, going, women-only, host block, duplicate (race-safe), host switch; trigger `own_gathering_invite_needs_visibility` | `canInvite && not past` | Enforced except time (R2) |
| gathering.leave / withdraw | `leave_gathering`: must be part of it, refuses once started, frees the slot + waitlist promotion | screen | Enforced |
| gathering.manage_attendees | `approve_gathering_interest` (host, pending only, not started, women-only, blocks, capacity -> waitlist) + `host_remove_gathering_attendee` (host, not started, promotion) | host view | Enforced |
| group_participant.decline | `respond_to_group_plan`: plan pending + not expired, invited only, once, blocks | `canDo` on screen | Enforced |
| invite.decline | `respond_to_social_invite`: invitee only, pending only; started gathering = expired | screen | Enforced |
| offer.cancel | `cancel_business_reservation`: accepted only, business or requester only, paid = refused | screen | Enforced |
| offer.decline | `decline_business_offer`: managing business only, pending/offered only (the customer has no decline: idea "194") | business card | Enforced |
| request.cancel | `cancel_business_request`: open only; requester / plan host / add-on manager | screen | Enforced |

Direct-write bypass checked: `gathering_interest`, `social_invites`, `business_request_offers`, `business_requests`,
`group_plan_participants` have RLS on and no UPDATE/DELETE policy, so their state changes only through the functions above.
Exceptions: `gathering_interest` allows a direct INSERT of a `pending` row (see D2); `gatherings` allows a host's direct UPDATE (R1).

## Confirmed defects (proposed fixes need owner approval; none built)

- **D1 (booking, reachable from the app): rescheduling a gathering leaves its booked business at the old time, unaware.**
  EditGathering lets the host change the time of an upcoming gathering. The only AFTER UPDATE trigger, `notify_gathering_updated`,
  tells approved attendees and Interested people; nothing touches the gathering's business request (`date`, `plan_time`) or its
  accepted offer (`proposed_time`), and no business push is sent. Result: the business expects the party at the old time, and the
  host's booked card still shows it. Edit gives no warning when a booking exists. Smallest fix to consider: when a booking exists,
  Edit says the booking stays at its time and to contact the business (copy only), or the server refuses a time change while an
  accepted offer exists (host cancels the reservation first). Not decided here.
- **D2 (attendance, server only): joining has no time check.** `join_gathering` checks own, invite-only, women-only, blocks and
  capacity but never `scheduled_at`; a direct `pending` INSERT into `gathering_interest` has no time check either. The app hides Join
  once a gathering starts (`canDo`), so only a stale screen or a direct call reaches it: an approved row on a past gathering, a
  "{Name} joined" push to the host, and that person sees the gathering as attended (How was it?). Smallest fix: the same
  `scheduled_at < now()` refusal `leave_gathering` already uses.
- **D3 (offer acceptance, server only): accept ignores the request's deadline.** `accept_business_offer` checks request `status =
  'open'`, offer `offered`, `valid_until`, revision and capacity, but not `business_requests.expires_at`. Until the expiry sweep stores
  the request as expired, the server books an offer the app already shows as "Request closed" (`isOfferOpen`). Harm is small (the
  business's offer is unchanged and its time must still be ahead, `_offer_chosen_time`), but CLAUDE.md's "the customer's accept
  applies the same checks" is not true at the deadline. Smallest fix: one `expires_at <= now()` refusal; `confirm_group_plan_offer`
  should be checked the same way.

## Meaningful risks (host-only, need a direct API call; not reachable from the app)

- **R1: a host can change locked gathering fields directly.** `authenticated` has column UPDATE on most of `gatherings`, and the policy
  only requires `host_id = auth.uid()`. A host can therefore bypass `set_gathering_capacity` (capacity below the people going, or raised
  without promoting the waitlist), turn `women_only` off after women joined (safety), change `visibility` / `is_public` or the precise
  point after people joined (item 73/idea "234" say these stay fixed), or move a past gathering's time. The app never sends these fields
  from Edit. Smallest fix to consider: a BEFORE UPDATE trigger refusing changes to `women_only`, `visibility`, `is_public`, `capacity`
  (outside `set_gathering_capacity`), the precise point after creation, and any edit once `scheduled_at` has passed.
- **R2: an invitation can be sent to a gathering that already started** (no time check in `invite_friend_to_gathering`); the push goes
  out, and the invite reads as expired when opened. The app hides Invite on past gatherings.

## The 5 missing mappings

1. Push sent per state: server-side (`_dispatch_domain_event`, triggers, RPCs). Routing is covered by `pushNavigationContract.test.js`
   + journeys `notificationEvents` / `notificationAction`; real delivery on a phone is untested.
2. Transition target states: every function above sets its target state explicitly (cancelled / declined / withdrawn / accepted /
   left / waitlisted …); confirmed for these functions only, not for every RPC.
3-5. Request, group plan and group participant buttons are screen-local, but every action they offer is enforced by the functions above.

## Gaps the existing tests cannot verify

- D1-D3 and R1-R2: I found no journey covering a reschedule with a booking, a join/invite after the start, an accept after the request
  deadline before the sweep, or a host's direct UPDATE of locked fields.
- Everything on screens (labels, hidden buttons, stale screens) stays NOT DEVICE-VERIFIED until the phone session.

Kept as observations (owner): the 2 ambiguous labels, the 2 display-only offer states, the 3 retired push destinations.
