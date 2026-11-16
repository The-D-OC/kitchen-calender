import type { CalEvent, Repeat } from './types';

export const LOCALE = 'en-GB';
const pad = (n: number) => String(n).padStart(2, '0');

export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const daysBetween = (a: string, b: string) =>
  Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);

export function occursOn(e: CalEvent, key: string): boolean {
  if (e.date === key) return true;
  if (e.repeat === 'none' || key < e.date) return false;
  const a = fromKey(e.date);
  const b = fromKey(key);
  switch (e.repeat) {
    case 'daily':
      return true;
    case 'weekly':
      return daysBetween(e.date, key) % 7 === 0;
    case 'fortnightly':
      return daysBetween(e.date, key) % 14 === 0;
    case 'monthly':
      return a.getDate() === b.getDate();
    case 'yearly':
      return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
  }
}

export function sortEvents(list: CalEvent[]): CalEvent[] {
  return [...list].sort((x, y) => {
    if (x.allDay !== y.allDay) return x.allDay ? -1 : 1;
    return (x.start ?? '').localeCompare(y.start ?? '') || x.title.localeCompare(y.title);
  });
}

export const eventsOn = (events: CalEvent[], key: string) =>
  sortEvents(events.filter((e) => occursOn(e, key)));

/** Date object for when an occurrence starts. All-day events count from `allDayHour`. */
export function startOf(e: CalEvent, key: string, allDayHour = 8): Date {
  const d = fromKey(key);
  if (e.allDay || !e.start) d.setHours(allDayHour, 0, 0, 0);
  else {
    const [h, m] = e.start.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/** When an occurrence is over. Timed events without an end last an hour. */
export function endOf(e: CalEvent, key: string): Date {
  const d = fromKey(key);
  if (e.allDay || !e.start) {
    d.setHours(23, 59, 59, 999);
    return d;
  }
  const [h, m] = (e.end || e.start).split(':').map(Number);
  d.setHours(h, m, 0, 0);
  if (!e.end) d.setMinutes(d.getMinutes() + 60);
  return d;
}

export const fmtTime = (t?: string) => t ?? '';

export function dayLabel(key: string, now = new Date()): string {
  const today = toKey(now);
  const full = fromKey(key).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  if (key === today) return `Today · ${full}`;
  if (key === toKey(addDays(now, 1))) return `Tomorrow · ${full}`;
  if (key === toKey(addDays(now, -1))) return `Yesterday · ${full}`;
  return full;
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  yearly: 'Every year',
};
