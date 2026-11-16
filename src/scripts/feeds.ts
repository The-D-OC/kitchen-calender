import type { CalEvent, Feed, State } from './types';
import { addDays, toKey } from './dates';
import { parseICS } from './ics';
import { store } from './store';

// Linked calendars (Google / iCloud / Outlook "secret iCal address").
// Calendar servers don't allow browsers to read them directly (CORS), so the
// request goes through the tiny Cloudflare Worker in /worker (route /api/ics).

const SYNC_EVERY = 30 * 60_000;

const windowNow = () => ({ from: toKey(addDays(new Date(), -60)), to: toKey(addDays(new Date(), 400)) });

export function normaliseUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

async function download(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/ics?url=${encodeURIComponent(normaliseUrl(url))}`, { cache: 'no-store' });
  } catch {
    throw new Error('Offline — will try again later.');
  }
  const text = await res.text();
  if (res.status === 404 && !text.includes('BEGIN:VCALENDAR')) {
    throw new Error('Calendar linking works once the site is deployed to Cloudflare (or run "npm run cf:dev").');
  }
  if (!res.ok) throw new Error(text.slice(0, 200) || `Error ${res.status}`);
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar. Use the "secret address in iCal format".');
  return text;
}

/** Replace a feed's events with freshly parsed ones */
export function applyFeedEvents(feedId: string, events: CalEvent[], patch: Partial<Feed>) {
  store.update((s) => {
    s.events = s.events.filter((e) => e.feedId !== feedId).concat(events);
    const f = s.feeds.find((x) => x.id === feedId);
    if (f) Object.assign(f, patch);
  });
}

export async function syncFeed(feed: Feed): Promise<number> {
  try {
    const text = await download(feed.url);
    const events = parseICS(text, feed, windowNow());
    applyFeedEvents(feed.id, events, { lastSync: Date.now(), error: undefined });
    return events.length;
  } catch (err) {
    store.update((s) => {
      const f = s.feeds.find((x) => x.id === feed.id);
      if (f) f.error = (err as Error).message;
    });
    throw err;
  }
}

/** Import a downloaded .ics file once (events become normal, editable events) */
export function importIcsFile(text: string, memberIds: string[]): CalEvent[] {
  const parsed = parseICS(text, { id: 'import', memberIds }, { from: toKey(addDays(new Date(), -365)), to: toKey(addDays(new Date(), 800)) });
  return parsed.map((e) => ({ ...e, id: `${e.id}:${Math.random().toString(36).slice(2, 8)}`, feedId: undefined }));
}

export function initFeeds(getState: () => State) {
  const syncAll = () => {
    for (const f of getState().feeds) syncFeed(f).catch(() => {});
  };
  setTimeout(syncAll, 1500);
  setInterval(syncAll, SYNC_EVERY);
  window.addEventListener('online', syncAll);
}
