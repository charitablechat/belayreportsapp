

## Fix: "Tightened bolts and connectors as needed" Missing from Report

### Root Cause

The code in `generate-inspection-html/index.ts` is correct — `prependDefaultBolt()` properly handles NULL/empty comments and is called for every system and zipline row. However, the deployed edge function likely does not reflect the latest code containing this helper.

### Solution

**Redeploy the edge function** — no code changes needed. The `prependDefaultBolt` function already:
- Returns `<p>Tightened bolts and connectors as needed</p>` for NULL/empty/dash comments
- Prepends the text to existing comments if not already present
- Skips if already present

It's applied at all 4 call sites (systems x2, ziplines x2 for page 1 and page 2 layouts).

### Verification

After redeployment, re-generate the HTML report for the current inspection (`3980644b-...`). All rows — including Mohawk Walk, High Crawl, Vertical Playpen, Swinging Ladders, Low Wild Woozie, and Inverted Catwalk (which have NULL comments in the database) — should display the default bullet.

