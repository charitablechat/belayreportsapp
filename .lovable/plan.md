

# Dashboard Reports Section — UX Improvement Suggestions

Here are concrete, high-impact improvements to make the reports section more organized, professional, and glanceable:

---

## 1. Summary Stats Bar (At-a-Glance)
Add a compact stats strip above the tabs showing key metrics at a glance:
```text
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  12      │ │  3       │ │  2       │ │  7       │
│  Total   │ │  Drafts  │ │ Overdue  │ │ Complete │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```
- Numbers update per active tab (Inspections/Training/Daily)
- Overdue count uses the existing `tierOf()` critical+warning logic
- Clicking a stat acts as a quick filter

## 2. Progress Indicator per Report Card
Add a thin progress bar or completion percentage to each card showing how "filled out" the report is (e.g., required fields completed). This gives instant visual feedback on which drafts need attention vs. which are nearly done.

## 3. Relative Time Labels
Replace or supplement the monospaced date with relative labels like "2 days ago", "Last week" — faster to parse at a glance than "Mar 6, 2026". Keep the full date in a tooltip.

## 4. Color-Coded Status Dots (Not Just Badges)
Replace the text badges with small colored dots + concise labels on the card. A left-border color stripe (already partially there for completed) could extend to all statuses:
- Green left border = completed
- Amber left border = warning (3-5 days)
- Red left border = critical (5+ days)
- Gray left border = fresh draft

## 5. "Last Activity" Timestamp
Show "Last edited 2h ago" below the date to indicate recency of work. Uses the existing `updated_at` field. Helps distinguish stale drafts from actively worked-on ones.

## 6. Compact Card Layout Option
Current cards have generous padding. Add a "compact" density toggle (alongside grid/list) that reduces padding and font sizes, fitting more cards on screen — useful for power users with many reports.

## 7. Improved Empty/Zero States per Group
When a collapsible group (e.g., "Completed") is collapsed, show a one-line summary: "8 completed reports — last: Acme Corp, Mar 5" so you get info without expanding.

## 8. Keyboard Navigation
Add arrow-key navigation between cards and Enter to open. Improves accessibility and power-user workflow.

---

## Recommended Priority Order
1. **Summary Stats Bar** — highest impact, lowest effort
2. **Relative Time Labels** — quick win, big readability improvement
3. **Left-Border Color Coding for all states** — extends existing pattern
4. **Last Activity timestamp** — small addition, high utility
5. **Compact density toggle** — medium effort, nice for power users

## Technical Approach
- Stats bar: New `DashboardStatsBar` component, computed from existing `useDashboardFilters` outputs (criticalCount, warningCount, filteredCount)
- Relative time: `formatDistanceToNow` from date-fns (already installed)
- Color borders: Extend `ageStateClasses` in `ReportCard.tsx` to cover all tiers
- Last activity: Read `updated_at` from report object, display with `formatDistanceToNow`
- Compact toggle: Add a `density` state to `DashboardFilterState`, apply conditional padding classes

All changes are frontend-only — no database or backend modifications needed.

