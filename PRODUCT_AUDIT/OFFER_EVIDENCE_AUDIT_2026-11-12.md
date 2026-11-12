# Offer traceability + deletion evidence (owner idea 39, 2026-11-12)

Environment: local from-scratch replay of `post-tier1/business-note-screening` (all 539 migrations), isolated network.
Production NOT queried (production is on 0347; everything below is staged).

## Already covered (before 20270416)
- **The chain exists in stored data.** Offer row: business, request, created, sent (`responded_at`), viewed, accepted,
  completed (= business-confirmed visit), cancelled. Screening result (0372, staged): business, submitter, request
  (`target_id`), exact text snapshot, risk level, time, single use. Status transitions: `business_lifecycle_events`.
- **A business can't be deleted through the app.** RLS on, no DELETE policy, no function deletes `brand_partners`. Deleting the
  owner's / manager's ACCOUNT leaves the business, its offers and its screening results (`submitted_by` set null, 0405;
  0403: "the business outlives its owner's account"). So a fraudulent business cannot erase its trail by deleting itself.
- **Screening results are never purged** (no job deletes them; they go only with the business row, which only the server can
  delete).
- **Reports outlive deletion** (0355: reporter / reported set null, text copy kept, 12 months after resolve, held reports never
  purged, 0395). An offer report carries the offer's text + the business NAME (0372), not the business id.
- **Legal holds** (0395/0402/0403) keep reports, removals, cases and an account's moderation records; never offers themselves.
- **Unresolved records on deletion** (0406) keep report / case ids for a deleted account; not offers.
- Confirmed redemptions and money-backed payments outlive the customer's deletion (0405).

## The gap (real)
An offer row is deleted with its REQUEST (`business_request_offers.request_id` ON DELETE CASCADE, request -> requester profile
CASCADE). So a customer deleting their account (or a server-side delete of the business) removes every offer to them, its
lifecycle times and its link to the business, including an offer they reported. With the manager's account also gone, a report
about that offer could no longer be tied to which business sent it. `business_lifecycle_events` cascades the same way.

## Fixed in 20270416 (staged)
See the migration header. Kept only while a report (unresolved, or resolved + held), an open case about a manager, or an active
hold on a manager's account covers the offer; business side only; retention = whatever kept it (no new period); never blocks a
deletion. Admin "Offer history" = one collapsed section on the existing business review card (no new screen).

## Still not covered (accepted / documented)
- A case or hold on the manager is found through the CURRENT managers + the managers named by covering reports; a manager whose
  link was cleared before the deletion and who is named by no report is not found.
- `business_lifecycle_events` (every status change) is not copied: the kept row has the offer's own times only.
- An offer covered only by a legal hold on a REPORT or CASE that isn't about it (e.g. a hold on an unrelated case) is not kept:
  a hold keeps what it is about (0402).
- No evidence is kept for an uncovered offer: an investigation that starts AFTER the customer deleted their account finds the
  screening result (text, business, request id) and the report if one exists, but not the offer row.
- Raw SQL with service-role / owner access can still delete anything (recorded database-access assumption).
