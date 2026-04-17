

The user is asking whether there are remaining gaps in iOS/macOS/Safari support that could degrade the app. This is a research/audit question, not an implementation request — but if gaps are found, I should propose fixes.

Let me catalog known Safari/Apple constraints and check the codebase against each.

## Known Safari/iOS gaps to audit

1. **Push notifications on iOS** — only work in installed PWAs on iOS 16.4+. Need to check `usePushNotifications` / `PushNotificationManager` for iOS gating.
2. **Web Share API / file downloads** — iOS Safari blocks programmatic downloads; should use `navigator.share` or open in new tab. Check `save-to-device.ts`, `backup-export.ts`.
3. **HEIC photo uploads** — iPhones produce HEIC by default. Check `heic-converter.ts` is wired into `PhotoCapture`.
4. **Camera capture** — `<input capture>` behaves differently on iOS. Check `PhotoCapture` / `camera-capture-dialog`.
5. **Viewport / safe-area insets** — iPhone notches, home indicator. Check `SafeAreaWrapper` and `index.html` viewport meta (`viewport-fit=cover`).
6. **iOS keyboard avoidance** — keyboard covers inputs. Check `useKeyboardAvoidance`.
7. **100vh bug on iOS Safari** — address bar resizes. Check for `dvh`/`svh` usage.
8. **Pull-to-refresh** — iOS Safari has native PTR that interferes. Check `usePullToRefresh` and `overscroll-behavior`.
9. **Audio/voice input** — `webkitSpeechRecognition` not supported in Safari. Check `useSpeechToText`.
10. **IndexedDB 7-day eviction** — partially addressed via `requestPersistentStorage()` and the Add-to-Home-Screen prompt I just added. Verify `requestPersistentStorage` is actually called at startup.
11. **`apple-touch-icon` and iOS PWA splash screens** — check `index.html` and `manifest.json`.
12. **Service Worker registration on iOS** — must be HTTPS, must be same-origin. Already handled.
13. **Background fetch / periodic sync** — unsupported on Safari. Already mitigated with foreground triggers.
14. **OAuth redirect on iOS PWA** — opens in Safari instead of PWA shell, breaks session. Check auth flow.
15. **File System Access API** — unsupported in Safari. Check backup/restore download paths.
16. **CSS `:has()`, container queries, etc.** — iOS Safari version compatibility.
17. **Date input UX** — iOS renders native picker differently. Usually fine, just confirm.
18. **Long-press context menu hijack** — iOS shows image preview/save sheet on long-press, can interfere with photo gallery interactions.

## Plan

Audit the codebase against each of these gaps, then present findings as:
- ✅ Already handled
- ⚠️ Partially handled — needs reinforcement
- ❌ Gap — needs work

For each gap found, propose a targeted fix. Group fixes into a single follow-up implementation plan the user can approve.

Files to read:
- `src/hooks/usePushNotifications.tsx`, `src/components/pwa/PushNotificationManager.tsx`
- `src/lib/save-to-device.ts`, `src/lib/backup-export.ts`
- `src/lib/heic-converter.ts`, `src/components/PhotoCapture.tsx`
- `src/components/SafeAreaWrapper.tsx`, `index.html`, `public/manifest.json`
- `src/hooks/useKeyboardAvoidance.tsx`, `src/hooks/usePullToRefresh.tsx`, `src/hooks/useSpeechToText.tsx`
- `src/main.tsx` (check `requestPersistentStorage` call)
- `src/components/Auth.tsx` (OAuth redirect)
- `src/index.css` (check for `100vh` vs `100dvh`)

I'll present the audit results and a prioritized fix plan in a single response after the user approves this plan.

## Proposed deliverable structure

After approval:
1. Run the audit (read ~12 files in parallel).
2. Produce a categorized report: handled / partial / gap.
3. For each gap, provide a one-line fix description and which file(s) to touch.
4. User picks which fixes to apply (or "all").

