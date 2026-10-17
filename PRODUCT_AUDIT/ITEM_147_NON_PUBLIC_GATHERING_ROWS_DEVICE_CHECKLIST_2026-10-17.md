# Item 147: non-public gathering rows - device checklist (2026-10-17)

Migration 20270322 is LIVE. The database now returns a gathering row only to someone who may see it (journey
`gatheringRowPrivacy`, 28/28 under the real roles). Nothing in the app's screens changed; these checks confirm that every
legitimate screen still shows what it did, on a real phone, signed in. Record device, OS, account role and result per line.

Needs: a host account with one gathering of each kind (Everyone, Link-only, Friends, Community, Invite-only), a friend of that
host, a community member, an invited account, and one stranger account. For check 9, a business owner account that partners on
one of the host's gatherings.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Host: Plans -> Hosting, open each own gathering | All five open, cover photo, Q&A, Who's going, edit works | |
| 2 | Host: create a new Invite-only gathering, then edit its title | Publish succeeds (formation card shows), edit saves | |
| 3 | Stranger: Discover list + map near the host | Only the Everyone gathering; never Friends/Community/Invite-only | |
| 4 | Stranger: open the Link-only and Invite-only links (docs/invite.html -> app) | Link-only opens; Invite-only shows the link preview but the app says it isn't available (no title/details leak in-app) | |
| 5 | Friend of the host: Discover + Home "friends are making plans" | Everyone + Friends gatherings appear; Join works on Friends | |
| 6 | Community member: the community's page -> its gathering | Visible, Join works | |
| 7 | Invited account: Activity invite -> open -> accept -> Join | Opens before and after accepting | |
| 8 | Pending / waitlisted on a non-public gathering: Plans | The gathering still shows with its state | |
| 9 | Business owner (partner): Business Dashboard -> gatherings, partnership request inbox | Partnered gathering listed with its attendee breakdown; a pending partnership request shows the gathering's title | |
| 10 | Matches / chat started at a gathering | "Met through {title}" still shows for people who were both there | |
| 11 | Cover photo on a Friends-only gathering, viewed by the friend and by the host | Loads for both | |
| 12 | Signed out (fresh install, before sign-in) | Nothing about gatherings is shown; the invite web page preview still works | |

Not covered here (needs its own scope): `get_public_gathering_invite_preview` gives a signed-out visitor the title, time,
host name and attendee count of ANY gathering whose id they hold (that is what a shared link shows, by design, unchanged).
