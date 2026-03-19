

## Add Aminos AI Chatbot to Dashboard

### Approach
Inject the third-party chatbot script (`chat_plugin.js`) dynamically when the Dashboard mounts, and clean it up on unmount. This keeps the chatbot scoped to the dashboard only.

### Changes

**`src/pages/Dashboard.tsx`** — Add a `useEffect` that:
1. Creates a `<script>` element with `src="https://platform.aminos.ai/w/chat_plugin.js"` and `data-bot-id="7179"`
2. Appends it to `document.body`
3. Removes the script and any injected chatbot DOM elements on cleanup

```typescript
useEffect(() => {
  const script = document.createElement('script');
  script.src = 'https://platform.aminos.ai/w/chat_plugin.js';
  script.setAttribute('data-bot-id', '7179');
  script.async = true;
  document.body.appendChild(script);

  return () => {
    document.body.removeChild(script);
    // Clean up any widget elements the script injected
    document.querySelectorAll('[id*="aminos"], [class*="aminos"]').forEach(el => el.remove());
  };
}, []);
```

No other files need changes. The chatbot widget will appear as a floating element on the dashboard page only.

