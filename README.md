# Family Calendar

An always-on kitchen calendar for a wall or counter tablet. Built with **Astro + TypeScript**, no backend. Everything is saved on the tablet itself.

## Features

Inspired by the Amazon Echo Show family hub and Google Nest Hub, built for a touch tablet in the kitchen.

**Calendar**
- **Month and week views.** Events are colour-coded by family member, and you swipe left or right to move between months or weeks.
- **Family members.** Each person gets a coloured avatar showing their initials. Tap someone's avatar in the top bar to hide or show their events. Hold it to see only their day.
- **Events.**
  - Events can be timed, all-day, or span several days (holidays, trips).
  - They can have a location and notes, and repeat daily, weekly, fortnightly, monthly or yearly.
  - Reminders can go off at the start, 10, 30 or 60 minutes before, or 1 day before.
- **Clash warnings.** If you double-book the same person, you're warned before saving.
- **"Next up" under the clock.** For example, *17:30 Swimming · in 2 h*.
- **Linked calendars.** Google, iCloud and Outlook calendars can be added by their secret iCal link (see below). They refresh every 30 minutes, and events show as read-only. You can also import an `.ics` file once.

**Send from your phone**
- **Pair each phone once.** On the tablet, go to ⚙ Settings → Phones → *Add a phone*, then scan the QR code with the phone's camera. That opens the **Send to the kitchen** page, which you can add to your home screen.
- **What phones can send.** Events (with who, time, location, reminder and notes), shopping items, to-dos and sticky notes.
- **The tablet collects them** within 30 seconds, plays a soft chime and shows "📱 Sam added Dentist · Thu 19 Nov".
- **Android sharing.** Share text or a link from any app to *To Kitchen* and it fills in a new event.
- **New code.** *New code* on the tablet unpairs every phone at once, for example if a phone is lost.

**Family hub**
- **Sticky notes.** Leave a note for everyone or for one person. Pick its colour, and it appears on the screen saver.
- **Shopping and to-do lists.** Tick items off and clear ticked items. To-dos can be assigned to a person. Type `milk, bread, eggs` to add several items at once.
- **Kitchen timers.** You can run several at once. They count down in the top bar and the screen saver, and survive a page reload. When one finishes it plays an alarm, says "Pasta is done" out loud and shows a full-screen alert with a **+1 min** button.
- **Family Bell.** Scheduled household chimes ("Dinner is ready", "Shoes on for school") on chosen days. Each plays a chime, says the message aloud and shows it full screen. Common bells are offered as suggestions.
- **Weather.** Current conditions, today's high and low, and a 7-day forecast from Open-Meteo, which is free and needs no key.

**Always-on display**
- **Screen saver and photo frame.** A big clock, weather, a pulsing **"N things on today"** banner, today's events, running timers and sticky notes. They're shown over a slideshow of your family photos, which are stored on the tablet. It dims at night and drifts slowly to protect the screen.
- **Screen-off notification.** When the screen turns off or the tablet locks, you get a system notification listing what's still on today, if anything is. There's also a morning summary, and notifications for reminders, timers and bells.
- **Keep the screen on.** This uses the Screen Wake Lock API.
- **Backup.** Export to and import from a JSON file.
- **Installable.** You can add it to the home screen. It then opens full-screen in landscape like an app.

## Run it

```bash
npm install
npm run dev        # http://localhost:4321 (also on your LAN)
npm run build      # outputs a static site to dist/
npm run preview
```

The build makes `dist/index.html` with all CSS and JS inlined, plus the icons, manifest and `sw.js`. You can host `dist/` anywhere static: Netlify, Vercel, GitHub Pages, Cloudflare Pages, or a Raspberry Pi with Caddy.

## Deploy to Cloudflare (no secrets needed)

Cloudflare builds and deploys the site itself every time you push to `main`, using **Workers Builds**. Nothing needs to be stored in GitHub.

One-time setup:

1. **Start a new Worker.** In the Cloudflare dashboard, go to **Workers & Pages → Create application → Import a repository**.
2. **Choose the repo.** Pick your GitHub account, then this repo. If asked, allow Cloudflare's GitHub app access to **only this repository**.
3. **Check the settings:**
   - Project name: `kitchen-calender`. This must match `name` in `wrangler.jsonc`.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (the default)
4. **Deploy.** Select **Save and Deploy**. The site goes live at `https://kitchen-calender.<your-subdomain>.workers.dev`.

After that, every push to `main` deploys automatically. The GitHub Action in `.github/workflows/build.yml` only checks that the code builds.

To deploy from your own computer instead, run `npx wrangler login`, then `npm run deploy`.

## How phone → tablet works

Phones and the tablet never talk to each other directly. A phone drops its message into a small private **mailbox on your Cloudflare account**. Technically, that's one Durable Object per household, which is included in the free plan and is created automatically when you deploy.

- **The pairing key is a long random secret** made by the tablet and carried in the QR code. Cloudflare only ever stores a SHA-256 hash of it, so one household can never see another's messages.
- **Messages are checked and size-limited by the Worker.** At most 200 can wait in the mailbox, and they're deleted once the tablet has saved them.
- **The tablet shares only family names and colours** with the mailbox, so phones can show the "Who" buttons. Nothing else leaves the tablet.

This needs the deployed `https://` site. A phone can't reach `localhost` on the tablet.

## Linking Google / iCloud / Outlook calendars

Browsers aren't allowed to read calendar feeds from Google and the others directly. The small Cloudflare Worker in `worker/index.ts` fetches the feed for you at `/api/ics`. It only ever returns real calendar data, so it can't be misused to fetch other things. This means linked calendars work on the Cloudflare deployment, or locally with `npm run cf:dev`, but not with plain `npm run dev`.

Where to find the secret iCal link:

- **Google Calendar (on a computer).** Go to Settings → pick the calendar → *Integrate calendar* → **Secret address in iCal format**.
- **iCloud.** In the Calendar app, share the calendar as a **Public Calendar** and copy the `webcal://` link.
- **Outlook.com.** Go to Settings → Calendar → Shared calendars → **Publish a calendar** → ICS link.

In the tablet's ⚙ Settings → Linked calendars, paste the link, give it a name, and choose whose calendar it is. It then appears in that person's colour.

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

- **Data lives in this browser's storage on this tablet.** It doesn't sync to phones, although linked calendars pull events in from Google, iCloud or Outlook. Use Export now and then to keep a backup. Syncing would need a small backend (for example Supabase or a JSON file on a server).
- **Timing while the screen is off.** Browsers throttle or pause pages while the screen is off. The "screen turned off" notification fires reliably at the moment the screen goes off. Reminders that fall due while the screen is *off* may be delayed until it wakes. With "Keep the screen on" enabled, the page stays active and reminders fire on time.
- The week starts on Monday and times are 24-hour (en-GB). Change `LOCALE` in `src/scripts/dates.ts` and the `offset` calculation in `renderGrid` if you want otherwise.

## Project layout

```
src/
  pages/index.astro      markup + dialogs
  styles/global.css      all styling
  scripts/
    app.ts               UI: month/week views, day panel, event/member/settings dialogs
    store.ts             state + localStorage persistence (migrates older saves)
    dates.ts             date keys, repeat rules, clash detection
    widgets.ts           sticky notes + shopping/to-do lists
    timers.ts            kitchen timers
    bells.ts             Family Bell scheduler + editor
    weather.ts           Open-Meteo forecast + place search
    photos.ts            screen-saver photos (IndexedDB)
    ics.ts, feeds.ts     .ics parser + linked calendar sync
    saver.ts             screen saver / photo frame
    notify.ts            system notifications (screen-off, reminders, morning summary)
    sound.ts             synthesised chimes + text-to-speech
    ui.ts                toast, confirm and full-screen alert
    wakelock.ts          Screen Wake Lock handling
    dom.ts, types.ts     helpers + types
    household.ts         phone pairing (QR) + collecting phone messages
    phone.ts             the phone "Send to the kitchen" page
    inbox-types.ts       message types + validation shared with the Worker
  pages/add.astro        phone page (/add/)
worker/index.ts          Cloudflare Worker: serves dist/, /api/ics calendar fetcher, phone inbox
public/                  manifest, service worker, icons, _headers
```
