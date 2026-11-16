export type Repeat = 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly';

export interface Member {
  id: string;
  name: string;
  color: string;
}

export interface CalEvent {
  id: string;
  title: string;
  /** First (or only) occurrence, YYYY-MM-DD in local time */
  date: string;
  /** Last day of a multi-day all-day event (inclusive), YYYY-MM-DD */
  endDate?: string;
  allDay: boolean;
  /** HH:MM, 24h */
  start?: string;
  end?: string;
  /** Empty = whole family */
  memberIds: string[];
  repeat: Repeat;
  /** Repeat every N periods (from imported calendars). Default 1 */
  interval?: number;
  /** Weekly repeats on these weekdays (0 = Sunday). From imported calendars */
  byDay?: number[];
  /** Monthly on the Nth weekday, e.g. { n: 2, day: 2 } = 2nd Tuesday, n = -1 for last */
  byMonthWeek?: { n: number; day: number };
  /** Last date a repeat can occur, YYYY-MM-DD */
  until?: string;
  /** Skipped occurrences, YYYY-MM-DD */
  exdates?: string[];
  /** Minutes before start, or null for no reminder */
  reminder: number | null;
  notes?: string;
  location?: string;
  /** Set when the event came from a linked calendar (read-only here) */
  feedId?: string;
}

export interface Note {
  id: string;
  text: string;
  /** Who it's for; empty = everyone */
  memberId?: string;
  color: string;
  createdAt: number;
}

export type ListName = 'shopping' | 'todo';
export interface ListItem {
  id: string;
  list: ListName;
  text: string;
  done: boolean;
  memberId?: string;
  createdAt: number;
}

export interface Bell {
  id: string;
  label: string;
  time: string; // HH:MM
  days: number[]; // 0 = Sunday … 6 = Saturday
  enabled: boolean;
  sound: 'chime' | 'bell' | 'gentle';
  speak: boolean;
  memberIds: string[];
}

export interface Timer {
  id: string;
  label: string;
  durationMs: number;
  endsAt: number;
}

export interface Feed {
  id: string;
  name: string;
  url: string;
  color: string;
  memberIds: string[];
  lastSync?: number;
  error?: string;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Settings {
  /** Minutes of no touches before the screen saver appears. 0 = never */
  idleMinutes: number;
  /** Ask the browser to keep the screen on (Screen Wake Lock API) */
  keepAwake: boolean;
  /** System notifications enabled by the user */
  notifications: boolean;
  /** Hours (0-23) between which the screen saver dims right down */
  nightStart: number;
  nightEnd: number;
  /** Hour for the "here's today" summary notification. -1 = off */
  summaryHour: number;
  view: 'month' | 'week';
  weather: Place | null;
  photosInSaver: boolean;
  photoSeconds: number;
  /** Speak bells and timers out loud */
  voice: boolean;
}

export interface State {
  version: 2;
  members: Member[];
  events: CalEvent[];
  notes: Note[];
  items: ListItem[];
  bells: Bell[];
  timers: Timer[];
  feeds: Feed[];
  settings: Settings;
}
