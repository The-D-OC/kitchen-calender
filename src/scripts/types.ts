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
  allDay: boolean;
  /** HH:MM, 24h */
  start?: string;
  end?: string;
  /** Empty = whole family */
  memberIds: string[];
  repeat: Repeat;
  /** Minutes before start, or null for no reminder */
  reminder: number | null;
  notes?: string;
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
}

export interface State {
  version: 1;
  members: Member[];
  events: CalEvent[];
  settings: Settings;
}
