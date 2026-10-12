# Item 53 — "N plans this month" + streak push retired — device checklist (2026-10-12)

Built and live (migrations 20270300, 20270301). Tests, the `plansThisMonth` journey and `scripts/live-verify/streak-nudge-retired.sql`
(7/7) pass. NOT device-verified. For each check, record the device, OS, appearance mode and result.

Setup: an account that has attended a gathering this month and checked in (or answered "How was it?"), plus a second gathering that
ends during the session.

1. Home, near the bottom (where "This week: ..." used to be): "N plans this month" with "View your activity →". Tapping it opens
   Your Activity.
2. An account with nothing that happened this month shows no line at all (never "0 plans").
3. Joining, RSVPing, marking Interested or hosting alone does not raise the figure. A gathering still in progress does not count
   either, even after you check in.
4. When a gathering ends and you answer "How was it?" (or a business confirms your visit), go back to Home: the figure rolls up once
   (the old number lifts away, the new one rises in, under 0.3 s). Go to another tab and back, or restart the app: nothing plays.
5. First launch on a fresh install with plans already this month: the figure is just there; nothing plays.
6. Reduce Motion on: the new figure appears at once.
7. No haptic, no confetti, no streak or "keep it up" wording anywhere on Home.
8. Light and dark: the line is readable and wraps cleanly at narrow width and in the longest language (de / tl).
9. The day after the month changes: last month's plans are gone, and the line disappears until something happens this month.
10. Your Activity still shows the weeks-in-a-row card exactly as before. That is intended: the streak display is kept until the
    Momentum decision.
11. Over at least one Wednesday 15:00 UTC run: no "🔥 Keep your streak going" push arrives, even for an account active 2+ weeks
    in a row with nothing this week.
12. Native review of `ui.home.plansThisMonth` / `plansThisMonthA11y` in 10 languages (machine-authored).
