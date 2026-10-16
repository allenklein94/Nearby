# Item 123: "📸 N memories" on a completed gathering's card, device checklist (2026-10-16)

Owner ask: once people choose to add photos, the completed gathering's card reads
"Beach Volleyball / ✓ Completed / 📸 4 memories"; tapping it opens the memories. Optional.

Built: Plans -> Past only (the one place item 122 shows a gathering as Completed; item 122 keeps memories off Home).
`memoryCountFor` in `utils/gatheringCompletion.js` (completed per item 122's rule AND >= 1 visible memory, else no line),
`getGatheringMemoryCounts` in `services/stories.js` (the same RLS-checked `stories` read as the photos, so a viewer who
was not there counts 0), `PlanCard` `extraLine` (one static line), the card's one tap opens GatheringDetail with
`openMemories` -> `GatheringMemories` `openOnLoad` opens the viewer once the server returns at least one memory.
Journey `gatheringMemory` 9/9 live (step 8: host 2, attendee 2, outsider 0). 1 new string `ui.gatheringMemories.count`
(plural forms, 11 languages machine-authored) needs native review. No migration.

Not built, and why: the ask's "photos could animate into the gathering". Item 122's memories are static (no motion), and
items 58/99 allow motion only for a real event seen as it happens; a count on a list card isn't one. The line is plain
text. Owner (2026-10-16): keep it static; animation DECLINED (LOCKED).

Record for each run: device, OS, appearance (light/dark), account roles used, result, notes.

| # | Check | Result |
|---|-------|--------|
| 1 | Host and approved attendee: Plans -> Past, a completed gathering with 4 memories shows "📸 4 memories" under the subtitle; 1 memory reads "📸 1 memory". | |
| 2 | No memories, or not over yet ("Confirmed"): no line; tapping opens the detail as before. | |
| 3 | Tap the card with the line: the gathering opens and the memories viewer opens by itself once photos load; Close leaves you on the detail. | |
| 4 | Back from the detail returns to Plans -> Past at the same scroll. | |
| 5 | Another person adds or removes a memory: the count follows after Plans reloads (pull to refresh / refocus). Never a stale or invented number. | |
| 6 | A viewer who was not there (friend / Dating match) never sees the line or the photos. | |
| 7 | Upcoming and Home: no memory line anywhere. | |
| 8 | The line never animates; long titles and the badge don't collide with it; light and dark. | |
| 9 | Screen reader: the card reads "..., 📸 4 memories" as part of its one button. | |
| 10 | Offline / failed count read: no line (never "0"). | |
