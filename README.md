# Family Calendar

An always-on kitchen calendar for a wall or counter tablet. Built with **Astro + TypeScript**, no backend. Everything is saved on the tablet itself.

## Features

- **Month view and day agenda.** The layout is made for touch: big tap targets, and you swipe left or right to change month.
- **Family members.** Add as many people as you like. Each gets a coloured avatar showing their initials. Pick from 10 preset colours or choose any colour you want.
- **Member filter.** Tap someone's avatar in the top bar to hide or show their events.
- **Events.** Each event can be all-day or timed. You can assign it to one or more people (or leave it for the whole family), and add notes.
  - Events can repeat daily, weekly, fortnightly, monthly or yearly (good for birthdays).
  - Reminders can go off at the start, 10, 30 or 60 minutes before, or 1 day before.
- **Screen saver.** After a few idle minutes the calendar is replaced by a big clock and a pulsing **"N things on today"** banner listing today's events. It also previews tomorrow, dims at night and drifts slowly to avoid screen burn-in. Tap anywhere to go back to the calendar.
- **Screen-off notification.** When the screen turns off or the tablet locks, you get a system notification listing what's still on today, if anything is. There's also a morning summary and per-event reminders.
- **When the screen comes back on**, an in-app banner shows what's on today.
- **Keep the screen on.** This uses the Screen Wake Lock API so the display never goes to sleep, and the screen saver handles idle time instead.
- **Backup.** Export to and import from a JSON file (in Settings).
- **Installable.** You can add it to the home screen. It then opens full-screen in landscape like an app.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321 (also on your LAN)
npm run build      # outputs a static site to dist/
npm run preview
```

The build makes `dist/index.html` with all CSS and JS inlined, plus the icons, manifest and `sw.js`. You can host `dist/` anywhere static: Netlify, Vercel, GitHub Pages, Cloudflare Pages, or a Raspberry Pi with Caddy.

## Deploy to Cloudflare (GitHub Actions)

Every push to `main` builds the site and deploys it to Cloudflare Workers using `.github/workflows/deploy.yml`. You can also deploy on demand: go to the **Actions** tab, pick **Deploy to Cloudflare**, then **Run workflow**.

One-time setup:

1. **Create an API token.** In the Cloudflare dashboard, go to **My Profile → API Tokens → Create Token** and use the **Edit Cloudflare Workers** template.
2. **Find your Account ID.** It's on the right of any Workers & Pages page in the Cloudflare dashboard.
3. **Add both as secrets.** In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. **Deploy.** Push to `main` or run the workflow. The site goes live at `https://kitchen-calendar.<your-subdomain>.workers.dev`, which is HTTPS, so notifications and keep-screen-on work.

To deploy from your own computer instead, run `npx wrangler login`, then `npm run deploy`. The Worker's name and settings live in `wrangler.jsonc`.

## Important: use HTTPS

Notifications, the service worker and the screen wake lock **only work in a secure context**. That means `https://…` or `http://localhost`. Opening it as `http://192.168.x.x` from the tablet will show the calendar fine, but those features will be off.

The easiest options:

- Deploy `dist/` to a free static host (you get HTTPS automatically), or
- run it at home behind Caddy or Tailscale (`tailscale serve`) for a local HTTPS URL.

## Setting up the tablet

**Android (best option)**
1. Open the site in Chrome, then use ⋮ → *Add to Home screen* / *Install app*.
2. Open it from the home-screen icon. In ⚙ Settings, tap **Turn notifications on** and allow them.
3. Optional: use a kiosk app such as *Fully Kiosk Browser* for true always-on mode with motion wake. Or set the system screen timeout to "never" and let the screen saver handle idle time.

**iPad**
1. In Safari, tap Share → *Add to Home Screen*. iOS only allows web notifications for home-screen web apps (iOS 16.4+).
2. Open it from the icon and enable notifications in ⚙ Settings.
3. Set Settings → Display → Auto-Lock to *Never*. Optionally use *Guided Access* to lock the iPad to the calendar.

## Notes and limits

- **Data lives in this browser's storage on this tablet.** It doesn't sync to phones. Use Export now and then to keep a backup. Syncing would need a small backend (for example Supabase or a JSON file on a server).
- **Timing while the screen is off.** Browsers throttle or pause pages while the screen is off. The "screen turned off" notification fires reliably at the moment the screen goes off. Reminders that fall due while the screen is *off* may be delayed until it wakes. With "Keep the screen on" enabled, the page stays active and reminders fire on time.
- The week starts on Monday and times are 24-hour (en-GB). Change `LOCALE` in `src/scripts/dates.ts` and the `offset` calculation in `renderGrid` if you want otherwise.

## Project layout

```
src/
  pages/index.astro      markup + dialogs
  styles/global.css      all styling
  scripts/
    app.ts               UI: month grid, agenda, event/member/settings dialogs
    store.ts             state + localStorage persistence
    dates.ts             date keys, repeat rules, sorting
    saver.ts             idle screen saver with today's banner
    notify.ts            system notifications (screen-off, reminders, morning summary)
    wakelock.ts          Screen Wake Lock handling
    dom.ts, types.ts     helpers + types
public/                  manifest, service worker, icons
```
