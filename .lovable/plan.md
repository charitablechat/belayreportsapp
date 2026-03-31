

## Update Aminos Chatbot Bot ID

**What changed**: The previous bot (ID `7179`) was returning 403 Forbidden. The user wants to switch to bot ID `7652`.

### Steps

1. **Edit `index.html`** — Replace the existing Aminos script tag, changing `data-bot-id="7179"` to `data-bot-id="7652"`.

That's the only change needed. After deployment, we should verify the new bot loads on the published site since the preview sandbox blocks third-party widget scripts.

