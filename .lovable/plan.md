

## Complete Universal Prompt — All March 23-24 Edits

I'll compile a comprehensive prompt covering every change made across both days. Here's what I've identified from the conversation and codebase:

### All Features to Include

1. **Add "Trainer" Role** — New role enum value, UI dropdown update, backfill existing users to `inspector`
2. **Password Reset Email on Admin User Creation** — `resetPasswordForEmail` after creating a user
3. **ACCT# Field on Profile Page** — New field in profile for certification number
4. **ACCT# Auto-Population** — New inspections auto-fill ACCT# from the inspector's profile
5. **Tab Key Navigation in Rich Text Editors** — TipTap extension intercepting Tab/Shift-Tab to move between fields
6. **LazyRichTextEditor Tab Order** — `tabIndex={0}` and `onFocus` on placeholder divs
7. **Auto-Focus First Input on New Row** — `newItemId` state + `useEffect` + `requestAnimationFrame` pattern
8. **`data-row-id` on DraggableTableRow/MobileCard** — DOM attribute for row targeting
9. **Mobile Text Wrapping on Report Headers** — Responsive font sizes and padding (`text-xl md:text-2xl`, `px-2 md:px-0`)

### Output

A single copy-paste-ready prompt block covering all 9 features, written generically enough to apply to other projects with similar form/table/editor structures.

### What I'll Produce

No code changes — just a refined, comprehensive text block in the plan markdown or as a response the user can copy.

