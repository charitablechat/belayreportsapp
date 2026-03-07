

## Bump Version to 3.1.1

Current version in `version.json` is `2.9.6`. Following the rollover scheme:
- `2.9.6` → `2.9.7` (patch +1)

But since the user said "bump", I'll increment once: **2.9.7** (the build plugin adds +1 at build time, so it will display as **v2.9.8**).

Actually, reviewing the scheme: the base gets +1 at build time. So updating `version.json` from `2.9.6` to `2.9.7` means the displayed version will be `v2.9.8`.

### Change

**File: `version.json`**
```json
{
  "version": "2.9.7"
}
```

### Already Rendering

The `VersionBadge` component is already used in:
- **Mobile/Desktop**: `UserProfileDropdown.tsx` (compact mode, in the dropdown menu)
- **Profile page**: `Profile.tsx` (full mode, at the bottom)

No additional rendering changes needed — the version is already visible on both mobile and desktop.

