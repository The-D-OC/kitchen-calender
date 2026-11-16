// Messages a phone can send to the kitchen tablet.
// Shared by the phone page, the tablet and the Cloudflare Worker (which validates them).

export interface InboxBase {
  /** Who sent it, e.g. "Sam" */
  sender?: string;
  sentAt: number;
}

export interface InboxEvent extends InboxBase {
  type: 'event';
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  allDay: boolean;
  start?: string; // HH:MM
  end?: string;
  memberIds: string[];
  location?: string;
  notes?: string;
  reminder: number | null;
}

export interface InboxListItem extends InboxBase {
  type: 'item';
  list: 'shopping' | 'todo';
  text: string;
  memberId?: string;
}

export interface InboxNote extends InboxBase {
  type: 'note';
  text: string;
  memberId?: string;
  color?: string;
}

export type InboxMessage = InboxEvent | InboxListItem | InboxNote;

/** What the tablet shares with paired phones so they can show the family */
export interface HouseholdProfile {
  members: { id: string; name: string; color: string }[];
  updatedAt: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const COLOUR = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optStr = (v: unknown, max: number) => str(v, max) || undefined;

/** Turn untrusted JSON into a clean message, or null if it isn't one */
export function cleanMessage(raw: unknown): InboxMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const base = { sender: optStr(r.sender, 30), sentAt: Date.now() };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 64)) : []);

  if (r.type === 'event') {
    const title = str(r.title, 80);
    const date = str(r.date, 10);
    if (!title || !DATE.test(date)) return null;
    const allDay = r.allDay === true || !TIME.test(str(r.start, 5));
    const start = allDay ? undefined : str(r.start, 5);
    const end = !allDay && TIME.test(str(r.end, 5)) && str(r.end, 5) > (start ?? '') ? str(r.end, 5) : undefined;
    const endDate = allDay && DATE.test(str(r.endDate, 10)) && str(r.endDate, 10) > date ? str(r.endDate, 10) : undefined;
    const reminder = typeof r.reminder === 'number' && r.reminder >= 0 && r.reminder <= 10_080 ? Math.round(r.reminder) : null;
    return {
      ...base,
      type: 'event',
      title,
      date,
      endDate,
      allDay,
      start,
      end,
      memberIds: ids(r.memberIds),
      location: optStr(r.location, 80),
      notes: optStr(r.notes, 500),
      reminder,
    };
  }
  if (r.type === 'item') {
    const text = str(r.text, 80);
    if (!text || (r.list !== 'shopping' && r.list !== 'todo')) return null;
    return { ...base, type: 'item', list: r.list, text, memberId: optStr(r.memberId, 64) };
  }
  if (r.type === 'note') {
    const text = str(r.text, 200);
    if (!text) return null;
    const color = COLOUR.test(str(r.color, 7)) ? str(r.color, 7) : undefined;
    return { ...base, type: 'note', text, memberId: optStr(r.memberId, 64), color };
  }
  return null;
}

export function cleanProfile(raw: unknown): HouseholdProfile | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as HouseholdProfile).members)) return null;
  const members = (raw as HouseholdProfile).members
    .slice(0, 20)
    .map((m) => ({ id: str(m?.id, 64), name: str(m?.name, 24), color: COLOUR.test(str(m?.color, 7)) ? str(m?.color, 7) : '#8a909c' }))
    .filter((m) => m.id);
  return { members, updatedAt: Date.now() };
}

/** Household keys are random, URL-safe and long enough not to be guessable */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
