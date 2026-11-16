import type { State } from './types';

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

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const defaults = (): State => ({
  version: 1,
  members: [{ id: uid(), name: 'Family', color: '#2e86ab' }],
  events: [],
  settings: {
    idleMinutes: 5,
    keepAwake: true,
    notifications: false,
    nightStart: 22,
    nightEnd: 6,
    summaryHour: 7,
  },
});

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw) as Partial<State>;
    const d = defaults();
    return {
      version: 1,
      members: Array.isArray(saved.members) ? saved.members : d.members,
      events: Array.isArray(saved.events) ? saved.events : [],
      settings: { ...d.settings, ...(saved.settings ?? {}) },
    };
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
    const data = JSON.parse(text) as Partial<State>;
    if (!Array.isArray(data.members) || !Array.isArray(data.events)) {
      throw new Error('That file does not look like a calendar backup.');
    }
    return {
      version: 1,
      members: data.members,
      events: data.events,
      settings: { ...defaults().settings, ...(data.settings ?? {}) },
    };
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
