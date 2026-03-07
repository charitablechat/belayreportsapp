

## Default Comment Injection for Ziplines & Equipment

### Approach

Set the default `comments` field to `<p>Tightened bolts and connectors as needed</p>` when creating new items. Since both tables use TipTap rich text editors, the value must be wrapped in a `<p>` tag. The reports (HTML and PDF) already render comments directly from the database, so no report changes are needed.

### Changes

**1. `src/components/inspection/ZiplinesTable.tsx`** — line 53
Change `comments: ""` to `comments: "<p>Tightened bolts and connectors as needed</p>"`

**2. `src/components/inspection/EquipmentTable.tsx`** — line 219
Change `comments: ""` to `comments: "<p>Tightened bolts and connectors as needed</p>"`

### What about existing items?

No existing data is modified. Only newly added rows get the default. Users can edit or append below the default text freely — the TipTap editor preserves content as-is.

### Reports

Both HTML and PDF report generators read `comments` from the database and render them through `formatCommentsAsBullets()` (HTML) or `stripHtml()` (PDF). The default text will appear automatically with no report code changes.

