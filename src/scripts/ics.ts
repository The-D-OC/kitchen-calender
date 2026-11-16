import type { CalEvent, Feed, Repeat } from './types';
import { addDays, fromKey, toKey } from './dates';

/* ------------------------------------------------------------------ *
 * Minimal iCalendar (.ics) reader — enough for Google, iCloud and
 * Outlook "secret address" feeds: single, all-day, multi-day and
 * common repeating events (daily/weekly/monthly/yearly, BYDAY,
 * INTERVAL, UNTIL, COUNT, EXDATE, edited single occurrences).
 * ------------------------------------------------------------------ */

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseLine(line: string): Prop | null {
  // NAME;PARAM=VAL;PARAM="V:AL":VALUE  — the first ':' outside quotes splits
  let inQuote = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      split = i;
      break;
    }
  }
  if (split < 0) return null;
  const [name, ...rawParams] = line.slice(0, split).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(split + 1) };
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock time in an IANA zone → the same instant as a local Date */
function zonedToLocal(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return new Date(guess - (asUtc - guess));
  } catch {
    return new Date(y, mo - 1, d, h, mi); // unknown zone name: assume it's ours
  }
}

interface When {
  key: string;
  time?: string;
  allDay: boolean;
}

function parseWhen(p: Prop): When | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  if (!hh || p.params.VALUE === 'DATE') return { key: `${y}-${mo}-${d}`, allDay: true };
  let dt: Date;
  if (z) dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
  else if (p.params.TZID) dt = zonedToLocal(+y, +mo, +d, +hh, +mi, p.params.TZID);
  else dt = new Date(+y, +mo - 1, +d, +hh, +mi);
  return { key: toKey(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`, allDay: false };
}

function applyRRule(ev: CalEvent, rule: string) {
  const r = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = (r.FREQ ?? '').toUpperCase();
  const map: Record<string, Repeat> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  if (!map[freq]) return;
  ev.repeat = map[freq];
  const n = Math.max(1, parseInt(r.INTERVAL ?? '1', 10) || 1);
  if (n > 1) ev.interval = n;

  if (r.BYDAY) {
    const days = r.BYDAY.split(',').map((d) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim())).filter((x) => !!x);
    if (freq === 'WEEKLY' || (freq === 'DAILY' && days.length)) {
      ev.repeat = 'weekly';
      ev.byDay = days.map((d) => DAY_CODES[d[2]]);
    } else if (freq === 'MONTHLY' && days[0]?.[1]) {
      ev.byMonthWeek = { n: parseInt(days[0][1], 10), day: DAY_CODES[days[0][2]] };
    }
  }
  if (r.BYSETPOS && ev.repeat === 'monthly' && r.BYDAY && !ev.byMonthWeek) {
    const d = /(SU|MO|TU|WE|TH|FR|SA)/.exec(r.BYDAY);
    if (d) ev.byMonthWeek = { n: parseInt(r.BYSETPOS, 10), day: DAY_CODES[d[1]] };
  }

  if (r.UNTIL) {
    const u = parseWhen({ name: 'UNTIL', params: {}, value: r.UNTIL });
    if (u) ev.until = u.key;
  } else if (r.COUNT) {
    const count = Math.max(1, parseInt(r.COUNT, 10) || 1);
    const start = fromKey(ev.date);
    let end: Date;
    if (ev.repeat === 'daily') end = addDays(start, (count - 1) * n);
    else if (ev.repeat === 'weekly') end = addDays(start, Math.ceil(count / (ev.byDay?.length || 1)) * 7 * n - 1);
    else if (ev.repeat === 'monthly') end = new Date(start.getFullYear(), start.getMonth() + (count - 1) * n + 1, 0);
    else end = new Date(start.getFullYear() + (count - 1) * n, 11, 31);
    ev.until = toKey(end);
  }
}

export interface ParseWindow {
  from: string;
  to: string;
}

export function parseICS(text: string, feed: Pick<Feed, 'id' | 'memberIds'>, win: ParseWindow): CalEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const masters = new Map<string, CalEvent>();
  const singles: CalEvent[] = [];
  const overrides: { uid: string; key: string }[] = [];

  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = [];
    else if (line === 'END:VEVENT') {
      if (cur) handle(cur);
      cur = null;
    } else if (cur) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }

  function handle(props: Prop[]) {
    const get = (n: string) => props.find((p) => p.name === n);
    if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') return;
    const dtstart = get('DTSTART');
    const start = dtstart && parseWhen(dtstart);
    if (!start) return;
    const uid = get('UID')?.value ?? Math.random().toString(36).slice(2);
    const recId = get('RECURRENCE-ID');
    const recWhen = recId && parseWhen(recId);

    const ev: CalEvent = {
      id: `${feed.id}:${uid}${recWhen ? `:${recWhen.key}` : ''}`,
      feedId: feed.id,
      title: unescape(get('SUMMARY')?.value ?? '(No title)'),
      date: start.key,
      allDay: start.allDay,
      start: start.time,
      memberIds: [...feed.memberIds],
      repeat: 'none',
      reminder: null,
    };
    const loc = get('LOCATION')?.value;
    if (loc) ev.location = unescape(loc);
    const desc = get('DESCRIPTION')?.value;
    if (desc) ev.notes = unescape(desc).slice(0, 500);

    const dtend = get('DTEND');
    const end = dtend && parseWhen(dtend);
    if (end) {
      if (start.allDay) {
        const last = toKey(addDays(fromKey(end.key), -1)); // DTEND is exclusive
        if (last > start.key) ev.endDate = last;
      } else if (end.key === start.key && end.time && end.time > (start.time ?? '')) {
        ev.end = end.time;
      }
    }

    if (recWhen) {
      overrides.push({ uid, key: recWhen.key });
      singles.push(ev);
      return;
    }
    const rrule = get('RRULE');
    if (rrule) {
      applyRRule(ev, rrule.value);
      const ex = props
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseWhen({ ...p, value: v })?.key))
        .filter((k): k is string => !!k);
      if (ex.length) ev.exdates = ex;
      masters.set(uid, ev);
    } else {
      singles.push(ev);
    }
  }

  for (const o of overrides) {
    const m = masters.get(o.uid);
    if (m) (m.exdates ??= []).push(o.key);
  }

  const inWindow = (e: CalEvent) =>
    e.repeat === 'none' ? (e.endDate ?? e.date) >= win.from && e.date <= win.to : e.date <= win.to && (!e.until || e.until >= win.from);

  return [...masters.values(), ...singles].filter(inWindow);
}
