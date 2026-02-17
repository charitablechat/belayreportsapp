

# Bump Version to v2.5.4

## What Happened

The version in `vite.config.ts` stopped being incremented during recent edits. It has remained at `2.5.1` across three code changes:

1. **v2.5.2** -- PWA cache-busting fix + Retro-Tech version badge styling
2. **v2.5.3** -- Image loading optimization (CLS fix, Brutalist skeletons)
3. **v2.5.4** -- Photo flash fix (deferred object URL revocation)

## Fix

Update `vite.config.ts` to reflect the current version `2.5.4` with today's date and a changelog comment summarizing the three changes.

### File: `vite.config.ts`

```
// v2.5.1 - Dual-layer lock protection (onPointerDownCapture), Minimal Brutalist dialog styling
// v2.5.2 - PWA cache-busting (skipWaiting/clientsClaim), Retro-Tech version badge
// v2.5.3 - Image CLS fix (decoding=async, Brutalist skeletons), silent photo refresh
// v2.5.4 - Photo flash fix: deferred object URL revocation, loaded state reset on src change
   const APP_VERSION = "2.5.4";
   const BUILD_DATE = "02-17-2026";
   const BUILD_TIMESTAMP = "02-17-2026 at 12:00 AM CST";
```

## Going Forward

Every code edit must increment the version by one patch number following the rollover scheme before committing. This will be maintained in all future responses.

