
## Goal
Start over: remove all prior Aminos chatbot installation logic and only include this script tag in the app’s HTML `<head>`:
```html
<script src="https://platform.aminos.ai/w/chat_plugin.js" data-bot-id="7179"></script>
```

## What I found
- The chatbot is currently injected via a `useEffect` in `src/pages/Dashboard.tsx`, using `platform.simplebotinstall.com` and cleanup logic. No other chatbot references exist elsewhere.

## Plan (code changes)
1. **Remove all chatbot code from the Dashboard page**
   - File: `src/pages/Dashboard.tsx`
   - Delete the entire Aminos chatbot `useEffect` block (the section that:
     - checks `script[data-bot-id="7179"]`
     - appends a `<script>` to `document.body`
     - removes the script / `[id*="aminos"], [class*="aminos"]` on cleanup)
   - Leave everything else in `Dashboard.tsx` unchanged.

2. **Add the provided script tag to the global HTML header**
   - File: `index.html`
   - Insert inside `<head>`, near the end (right before `</head>` is fine):
     ```html
     <script src="https://platform.aminos.ai/w/chat_plugin.js" data-bot-id="7179"></script>
     ```
   - No other chatbot-related logic will remain in React components.

## Expected result
- The chatbot script loads for **all users** (and on **all routes**) because it’s in the global HTML `<head>`.
- This is the cleanest “start over” baseline; if the bot still doesn’t appear after this, the next step will be to inspect runtime errors/network blocking (ad blockers/CSP) via console + network logs.
