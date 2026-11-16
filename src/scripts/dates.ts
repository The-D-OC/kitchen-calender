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
/** Monday of the week containing d */
export const startOfWeek = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));

export const daysBetween = (a: string, b: string) =>
  Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);

/** Does the event (or one of its repeats) cover this day? */
export function occursOn(e: CalEvent, key: string): boolean {
  if (key < e.date) return false;
  if (e.exdates?.includes(key)) return false;
  const span = e.endDate && e.endDate > e.date ? daysBetween(e.date, e.endDate) : 0;

  if (e.repeat === 'none') return key <= (e.endDate && e.endDate > e.date ? e.endDate : e.date);
  if (e.until && key > addKey(e.until, span)) return false;

  // For repeats of multi-day events, check whether any start in the last `span` days hits
  for (let back = 0; back <= span; back++) {
    const start = back ? toKey(addDays(fromKey(key), -back)) : key;
    if (start < e.date) break;
    if (e.until && start > e.until) continue;
    if (startsOn(e, start)) return true;
  }
  return false;
}

const addKey = (k: string, n: number) => toKey(addDays(fromKey(k), n));

function startsOn(e: CalEvent, key: string): boolean {
  const n = Math.max(1, e.interval ?? 1);
  const a = fromKey(e.date);
  const b = fromKey(key);
  const diff = daysBetween(e.date, key);
  switch (e.repeat) {
    case 'none':
      return key === e.date;
    case 'daily':
      return diff % n === 0;
    case 'weekly':
    case 'fortnightly': {
      const every = e.repeat === 'fortnightly' ? 2 : n;
      if (e.byDay?.length) {
        const weeks = Math.round((startOfWeek(b).getTime() - startOfWeek(a).getTime()) / (7 * 86_400_000));
        return e.byDay.includes(b.getDay()) && weeks % every === 0;
      }
      return diff % (7 * every) === 0;
    }
    case 'monthly': {
      const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      if (months % n !== 0) return false;
      if (e.byMonthWeek) {
        const { n: nth, day } = e.byMonthWeek;
        if (b.getDay() !== day) return false;
        if (nth > 0) return Math.ceil(b.getDate() / 7) === nth;
        return addDays(b, 7).getMonth() !== b.getMonth(); // last one in the month
      }
      return a.getDate() === b.getDate();
    }
    case 'yearly':
      return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && (b.getFullYear() - a.getFullYear()) % n === 0;
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

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Timed events on the same day that overlap `e` and share a family member */
export function clashes(e: CalEvent, events: CalEvent[]): CalEvent[] {
  if (e.allDay || !e.start) return [];
  const s = toMin(e.start);
  const f = e.end ? toMin(e.end) : s + 60;
  return eventsOn(events, e.date).filter((o) => {
    if (o.id === e.id || o.allDay || !o.start) return false;
    const os = toMin(o.start);
    const of = o.end ? toMin(o.end) : os + 60;
    const overlap = s < of && os < f;
    const shared = !e.memberIds.length || !o.memberIds.length || e.memberIds.some((id) => o.memberIds.includes(id));
    return overlap && shared;
  });
}

export function dayLabel(key: string, now = new Date()): string {
  const today = toKey(now);
  const full = fromKey(key).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  if (key === today) return `Today · ${full}`;
  if (key === toKey(addDays(now, 1))) return `Tomorrow · ${full}`;
  if (key === toKey(addDays(now, -1))) return `Yesterday · ${full}`;
  return full;
}

/** "in 25 min", "in 2 h 10 min" */
export function untilLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  yearly: 'Every year',
};

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
