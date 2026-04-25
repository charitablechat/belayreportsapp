# Add temporary Sentry verification button

Add a one-shot "Break the world" button so we can confirm errors land in Sentry, then remove it.

## Important caveat

Sentry is **production-only** (`enabled: import.meta.env.PROD` in `src/lib/sentry.ts`). The button will throw in the editor preview but **will not send anything to Sentry from dev**. To verify end-to-end you must:

1. Approve this plan
2. **Publish** the project
3. Open the published site (`ropeworks.lovable.app` or `rwreports.com`)
4. Click "Break the world" in the bottom-right corner
5. Check your Sentry dashboard — the event should appear within a few seconds

## Change

Add a fixed-position red button in the bottom-right corner of `src/pages/Dashboard.tsx` that throws `new Error("This is your first error!")` on click. Visible only on `/dashboard`.

## After verification

Tell me once you see the event in Sentry and I'll remove the button in a follow-up message. (Or if you'd prefer, I can add it behind a `?sentry-test=1` query param so it's hidden by default — let me know.)
