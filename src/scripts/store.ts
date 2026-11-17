import type { Settings, State } from './types';

const KEY = 'family-calendar:v1';

export const PALETTE = [
  '#e4572e', // tomato
  '#f3a712', // saffron
  '#29a36a', // green
  '#2e86ab', // blue
  '#7d5ba6', // purple
  '#d64291', // pink
  '#1fb5ac', // teal
  '#8aa832', // lime
  '#c2703d', // copper
  '#5c6bc0', // indigo
];

export const NOTE_COLOURS = ['#ffe27a', '#ffb3a7', '#b8e6b0', '#a9d6f5', '#d9c2f0', '#ffd0e6'];

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const defaultSettings = (): Settings => ({
  idleMinutes: 5,
  keepAwake: true,
  notifications: false,
  nightStart: 22,
  nightEnd: 6,
  summaryHour: 7,
  view: 'month',
  weather: null,
  photosInSaver: true,
  photoSeconds: 60,
  voice: true,
  countdownUnit: 'sleeps',
  theme: 'auto',
  binRemindWhen: 'before',
  binRemindTime: '19:00',
});

const defaults = (): State => ({
  version: 2,
  members: [{ id: uid(), name: 'Family', color: '#2e86ab' }],
  events: [],
  notes: [],
  items: [],
  bells: [],
  timers: [],
  feeds: [],
  countdowns: [],
  bins: [],
  settings: defaultSettings(),
});

/** Accepts v1 or v2 data and fills in anything missing */
function normalise(saved: Partial<State> & Record<string, unknown>): State {
  const d = defaults();
  const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  return {
    version: 2,
    members: arr(saved.members, d.members),
    events: arr(saved.events, []),
    notes: arr(saved.notes, []),
    items: arr(saved.items, []),
    bells: arr(saved.bells, []),
    timers: arr(saved.timers, []),
    feeds: arr(saved.feeds, []),
    countdowns: arr(saved.countdowns, []),
    bins: arr(saved.bins, []),
    settings: { ...d.settings, ...((saved.settings as Partial<Settings>) ?? {}) },
  };
}

/** True when this browser had no saved calendar at start-up (new or wiped tablet) */
export let freshInstall = false;
try {
  freshInstall = !localStorage.getItem(KEY);
} catch {
  freshInstall = false;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalise(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

type Listener = (s: State) => void;
let state = load();
const listeners = new Set<Listener>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — nothing sensible to do */
  }
}
const emit = () => listeners.forEach((l) => l(state));

export const store = {
  get: (): State => state,
  update(fn: (s: State) => void) {
    fn(state);
    save();
    emit();
  },
  replace(next: State) {
    state = next;
    save();
    emit();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Validate an imported backup and turn it into a State */
  parseBackup(text: string): State {
    const data = JSON.parse(text);
    if (!Array.isArray(data.members) || !Array.isArray(data.events)) {
      throw new Error('That file does not look like a calendar backup.');
    }
    return normalise(data);
  },
};

// Keep several open tabs in sync
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load();
    emit();
  }
});

// Ask the browser not to evict our data under storage pressure
navigator.storage?.persist?.().catch(() => {});
