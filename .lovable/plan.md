

# Version Bump: v2.4.19 to v2.5.1

## Current State

| Field | Current Value |
|-------|--------------|
| APP_VERSION | 2.4.19 |
| BUILD_DATE | 02-12-2026 |
| BUILD_TIMESTAMP | 02-12-2026 at 12:00 AM CST |

The version and build metadata are **manually maintained** in `vite.config.ts`. There is no automated version bump in the build pipeline.

## What Needs to Change

Update `vite.config.ts` with:

| Field | New Value |
|-------|-----------|
| APP_VERSION | 2.5.1 |
| BUILD_DATE | 02-17-2026 |
| BUILD_TIMESTAMP | 02-17-2026 at 12:00 AM CST |

Per the project's rollover versioning scheme (patch resets to 1 when it exceeds 9), `2.4.19` rolls over to `2.5.1`.

## Why v2.5.1

The MINOR version bump (4 to 5) is appropriate because the recent changes represent a behavioral architecture change (dual-layer event interception with `onPointerDownCapture`), not just a patch-level fix. The rollover scheme also mandates it since PATCH exceeded 9.

## Changelog Context

Add a version comment in `vite.config.ts` alongside the existing one:

```
// v2.4.5 - Fixed equipment data loss: replaced object reference equality with ID-based matching
// v2.5.1 - Dual-layer lock protection (onPointerDownCapture), Minimal Brutalist dialog styling
```

## Files Modified

- `vite.config.ts` -- Update APP_VERSION, BUILD_DATE, BUILD_TIMESTAMP, and add changelog comment

## What Does NOT Change

- Version calculator logic (`src/lib/version-calculator.ts`)
- VersionBadge or VersionInfoModal components
- Backend, edge functions, RLS policies
- No secrets or API keys affected

