# Item 122: a gathering leaves a memory, device checklist (2026-10-16)

Owner decisions (LOCKED): only the host and approved attendees see a completed gathering's photos (a friendship or Dating
match with the poster never grants access); "{title} · Completed" in Plans -> Past and on the gathering's detail screen,
from item 34's one "over" rule; adding a photo is optional; gathering photos left Discover's "Happening Nearby" (business
moments stay); no feed: no Home row, reminder push, likes, comments, anniversaries, collages or public sharing.

Built: migration `20270315` (LIVE), `utils/gatheringCompletion.js` `gatheringMemoryState`, `components/GatheringMemories.js`,
`services/stories.js` (`getGatheringMemories`, `pickMemoryMedia`, `addGatheringMemory`), GatheringDetail, PlansScreen,
DiscoverHub. Journey `gatheringMemory` (8/8 live). 10 new strings `ui.gatheringMemories.*` need native review.

Record for each run: device, OS, appearance (light/dark), account roles used, result, notes.

Needs: one gathering that is over, its host (phone 1), an approved attendee (phone 2), and a third account that is the
attendee's friend or Dating match but did NOT attend (phone 3, or sign in on phone 2 afterwards).

| # | Check | Result |
|---|-------|--------|
| 1 | Attendee: Plans -> Past shows the gathering with the "Completed" badge only once it is over (start + host's duration); while it is still going it reads "Confirmed". | |
| 2 | Attendee and host: the detail title reads "Beach Volleyball · Completed" (the suffix in secondary colour), wraps cleanly on a long title, readable in light and dark. | |
| 3 | Before it is over (or for a pending / waitlisted / interested / non-attending viewer): no "· Completed", no Memories section. | |
| 4 | Memories section: label, "🔒 Only the people who were there can see these.", "＋ Add a photo"; nothing else when there are no photos (no filler). | |
| 5 | Add a photo opens the photo library (not the camera); cancelling changes nothing; a picked photo appears in the strip after upload; "Adding…" while it uploads; the button never double-adds. | |
| 6 | A video can be added; its thumbnail shows ▶ only; it never plays until tapped in the viewer (native controls). | |
| 7 | Tapping a thumbnail opens the viewer: each memory with the poster's name, oldest first; Close returns to the detail at the same scroll. | |
| 8 | Your own memory shows "Remove"; confirm removes it for everyone (check on the other phone after reopening); others' memories show no Remove. | |
| 9 | Host sees the attendee's photo and vice versa. | |
| 10 | The friend / Dating match who did NOT attend: opens the gathering (if visible to them) and sees no Memories section, no photos; their story rings and Discover show nothing of it. | |
| 11 | Discover -> All: "Happening Nearby" lists business moments only; no gathering photos. | |
| 12 | No push of any kind is sent when a memory is added (friends of the poster get no "posted a new story"). | |
| 13 | Upload failure (airplane mode): a "Try again" alert; nothing half-shown. | |
| 14 | Screen reader: thumbnails read "Photo from {name}" / "Video from {name}"; Remove reads with its photo. | |

Not covered by this checklist: native-speaker review of the 10 strings (11 languages machine-authored).
