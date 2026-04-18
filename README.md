# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/93f93be1-56ac-449d-97cf-041ac1649624

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/93f93be1-56ac-449d-97cf-041ac1649624) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/93f93be1-56ac-449d-97cf-041ac1649624) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

---

## PWA Update System & Cross-Platform Notes

This app uses an **autoUpdate** Service Worker (VitePWA) plus a server-side
`/version.json` poll to deliver new versions reliably across all platforms.

### Update flow
1. **Service Worker autoUpdate** — VitePWA checks for a new SW on every page
   load, on tab focus, and on visibility change. New SWs activate
   automatically without user prompts.
2. **/version.json polling** — Every 5 minutes (and on tab foreground), the
   client fetches `/version.json` and compares the deployed version to the
   running version. If newer, a soft "REFRESH" banner appears as a fallback.
3. **iOS Safari mitigation** — `updateViaCache: 'none'` forces revalidation
   of the SW script on every load, defeating Safari's 24h SW cache.
4. **Telemetry** — Each client reports its version to `version_telemetry`,
   visible to admins under Admin Dashboard → Audit Logs tab.

### Known platform limitation: Android WebAPK update lag
When a user installs the PWA on Android via Chrome's "Add to Home Screen"
prompt, Android wraps the app in a **WebAPK** managed by Google Play Services.
- **JS / CSS / HTML updates** flow normally through the Service Worker — no
  delay.
- **Manifest-level changes** (app name, icons, theme color, display mode)
  are refreshed on Play Services' own schedule, typically **1 to 30 days**.
  This is a Google constraint with no workaround.

### Windows PWA users
Users who installed the PWA on Windows during the pre-autoUpdate era may have
a stale Service Worker pinned to their installed shell. The app shows a
one-time toast on Windows recommending uninstall + reinstall to receive the
new update mechanism.
