## Plan

1. **Move the scroll fixture into the visible table area**
   - Keep `WideTableScroller` as the reusable control, but make its custom scrollbar fixture `sticky` at the bottom of the scroller region so it stays visible while the Zipline table is on screen instead of appearing only after the row/table content.
   - Add bottom padding to the scrollable content so the fixture does not cover the bottom border or controls.

2. **Make the fixture unmistakable**
   - Increase the custom track/thumb height and contrast using existing semantic tokens.
   - Replace the subtle text hint with an always-visible labeled fixture row: left/right nudge buttons, a full-width track, and a “Scroll for more columns” label when overflow exists.
   - Keep it hidden/disabled when the full Zipline table fits without horizontal overflow.

3. **Ensure it syncs with table scrolling**
   - Preserve the existing two-way sync: dragging the thumb scrolls the table, native swipe/wheel/trackpad scrolling moves the thumb, and nudge buttons move the table.
   - Re-measure on resize and content changes so the fixture appears/disappears automatically as the viewport changes.

4. **Apply only to the Zipline desktop grid**
   - Keep the current mobile card layout unchanged.
   - Keep other inspection tables unchanged unless they later need the same fixture.

5. **Validate behavior**
   - Check the report route at the current viewport size and a narrower tablet-like width.
   - Confirm the fixture is visible without needing to scroll to the bottom of the row, the thumb moves when the table scrolls, right-edge controls remain reachable, and the fixture hides when the viewport is wide enough.