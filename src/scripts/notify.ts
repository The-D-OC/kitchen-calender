import type { CalEvent, State } from './types';
import { addDays, endOf, eventsOn, startOf, toKey } from './dates';

/* ------------------------------------------------------------------ *
 * System notifications
 *  - when the screen turns off (page becomes hidden) and something is
 *    still on today
 *  - a morning "here's today" summary
 *  - per-event reminders
 * ------------------------------------------------------------------ */

const FIRED_KEY = 'family-calendar:fired';
const SCREEN_OFF_GAP_MS = 2 * 60 * 60 * 1000; // at most one screen-off alert every 2 hours

export function readFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}');
  } catch {
    return {};
  }
}
export function markFired(id: string) {
  const f = readFired();
  f[id] = Date.now();
  const cutoff = Date.now() - 3 * 86_400_000;
  for (const k of Object.keys(f)) if (f[k] < cutoff) delete f[k];
  localStorage.setItem(FIRED_KEY, JSON.stringify(f));
}

export const notificationsSupported = () => 'Notification' in window;
export const permission = (): NotificationPermission | 'unsupported' =>
  notificationsSupported() ? Notification.permission : 'unsupported';

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

let swReg: ServiceWorkerRegistration | undefined;
async function registerSW() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
  } catch {
    /* fall back to new Notification() */
  }
}

export async function notify(title: string, body: string, tag: string): Promise<boolean> {
  if (permission() !== 'granted') return false;
  const opts = { body, tag, icon: 'icon-192.png', badge: 'icon-192.png', renotify: true, requireInteraction: false };
  try {
    if (swReg) {
      await swReg.showNotification(title, opts as NotificationOptions);
    } else {
      new Notification(title, opts as NotificationOptions);
    }
    return true;
  } catch {
    return false;
  }
}

/** Events today that haven't finished yet */
export function remainingToday(s: State, now = new Date()): CalEvent[] {
  const key = toKey(now);
  return eventsOn(s.events, key).filter((e) => endOf(e, key) > now);
}

export function describe(evs: CalEvent[], s: State): string {
  const names = (e: CalEvent) =>
    e.memberIds
      .map((id) => s.members.find((m) => m.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  return evs
    .map((e) => {
      const who = names(e);
      return `${e.allDay ? 'All day' : e.start} · ${e.title}${who ? ` (${who})` : ''}`;
    })
    .join('\n');
}

export const countLabel = (n: number) => (n === 1 ? '1 thing on' : `${n} things on`);

export function initNotifications(getState: () => State, onReminder: (title: string, body: string) => void) {
  registerSW();

  const check = () => {
    const s = getState();
    const now = new Date();
    const allDayHour = s.settings.summaryHour >= 0 ? s.settings.summaryHour : 8;
    const fired = readFired();

    // Event reminders (today + tomorrow, so "1 day before" works)
    for (const offset of [0, 1]) {
      const key = toKey(addDays(now, offset));
      for (const e of eventsOn(s.events, key)) {
        if (e.reminder == null) continue;
        const at = startOf(e, key, allDayHour).getTime() - e.reminder * 60_000;
        const id = `${e.id}|${key}|reminder`;
        // Only fire inside a 15-minute window so old reminders don't burst out on start-up
        if (now.getTime() >= at && now.getTime() - at < 15 * 60_000 && !(id in fired)) {
          markFired(id);
          const when = e.allDay ? (offset ? 'Tomorrow (all day)' : 'Today (all day)') : `${offset ? 'Tomorrow' : 'Today'} at ${e.start}`;
          const title = `🔔 ${e.title}`;
          onReminder(title, when);
          if (s.settings.notifications) notify(title, `${when}${e.notes ? `\n${e.notes}` : ''}`, id);
        }
      }
    }

    // Morning summary
    if (s.settings.notifications && s.settings.summaryHour >= 0 && now.getHours() >= s.settings.summaryHour) {
      const id = `summary|${toKey(now)}`;
      if (!(id in fired)) {
        markFired(id);
        const evs = remainingToday(s, now);
        if (evs.length) notify(`Good morning — ${countLabel(evs.length)} today`, describe(evs, s), 'summary');
      }
    }
  };

  check();
  setInterval(check, 20_000);

  // Screen switched off / tablet locked / app backgrounded
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const s = getState();
    if (!s.settings.notifications) return;
    const evs = remainingToday(s);
    if (!evs.length) return;
    const id = `screen-off|${toKey(new Date())}`;
    const last = readFired()[id] ?? 0;
    if (Date.now() - last < SCREEN_OFF_GAP_MS) return;
    markFired(id);
    notify(`${countLabel(evs.length)} today`, describe(evs, s), 'screen-off');
  });
}
