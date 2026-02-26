

## Update Version Number to v2.9.2

### How Versioning Works
The app uses a "manual bump + build increment" model. The `version.json` file stores the base version, and the build plugin (`vite-auto-version.ts`) adds +1 patch in memory for the displayed version. So to display **v2.9.2**, the file needs to contain **2.9.1**.

### Current State
- `version.json` currently contains `"2.9.0"`, which means the app displays **v2.9.1**

### Change
| File | Change |
|------|--------|
| `version.json` | Update `"version": "2.9.0"` to `"version": "2.9.1"` |

This single change will cause all devices to display **v2.9.2** after the next build.

