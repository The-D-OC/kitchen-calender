import { qrSvg } from './qr';
import type { CalEvent } from './types';
import type { HouseholdProfile, InboxMessage } from './inbox-types';
import { NOTE_COLOURS, store, uid } from './store';
import { $, h } from './dom';
import { LOCALE, fromKey } from './dates';
import { play } from './sound';
import { ask, toast } from './ui';

/* ------------------------------------------------------------------ *
 * Phones → tablet. The tablet makes a long random "household key" and
 * shows it as a QR code. Phones that scan it can drop events, list
 * items and notes into the household inbox on Cloudflare; the tablet
 * collects them every 30 seconds.
 * ------------------------------------------------------------------ */

const KEY_STORE = 'family-calendar:household-key';
const SEEN_STORE = 'family-calendar:inbox-seen';
const POLL_MS = 30_000;

export function householdKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

export function setHouseholdKey(key: string) {
  localStorage.setItem(KEY_STORE, key);
  lastProfile = '';
}

/** Make sure there is a household key (used for phones and the cloud backup) */
export function ensureHouseholdKey(): string {
  let key = householdKey();
  if (!key) {
    key = newKey();
    localStorage.setItem(KEY_STORE, key);
  }
  return key;
}

export const KEY_RE = /^[A-Za-z0-9_-]{32,64}$/;

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const phoneLink = (key: string) => `${location.origin}/add/#k=${key}`;

async function api(path: string, init: RequestInit = {}) {
  const key = householdKey();
  if (!key) throw new Error('not paired');
  const res = await fetch(`/api/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-household-key': key, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `Error ${res.status}`);
  return res.json();
}

/* ---------- publish family names/colours so phones can show them ---------- */

let lastProfile = '';
/** Called when 'New code' replaces the key (the backup moves to the new key) */
export const onKeyChange: (() => void)[] = [];
async function publishProfile(force = false) {
  if (!householdKey()) return;
  const profile: Omit<HouseholdProfile, 'updatedAt'> = { members: store.get().members.map(({ id, name, color }) => ({ id, name, color })) };
  const body = JSON.stringify(profile);
  if (!force && body === lastProfile) return;
  try {
    await api('profile', { method: 'PUT', body });
    lastProfile = body;
  } catch {
    /* offline or not deployed — try again on the next change/poll */
  }
}

/* ---------- collect messages ---------- */

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_STORE) || '[]'));
  } catch {
    return new Set();
  }
}
function remember(keys: string[]) {
  const all = [...seen(), ...keys].slice(-300);
  localStorage.setItem(SEEN_STORE, JSON.stringify(all));
}

function describe(m: InboxMessage): string {
  const who = m.sender ? `${m.sender}` : 'A phone';
  if (m.type === 'event') {
    const when = fromKey(m.date).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${who} added “${m.title}” · ${when}${m.allDay ? '' : ` ${m.start}`}`;
  }
  if (m.type === 'item') return `${who} added “${m.text}” to ${m.list === 'shopping' ? 'shopping' : 'to-do'}`;
  return `${who} left a note`;
}

let polling = false;
export async function checkInbox(): Promise<number> {
  if (polling || !householdKey()) return 0;
  polling = true;
  try {
    const { messages } = (await api('inbox')) as { messages: { key: string; msg: InboxMessage }[] };
    if (!messages.length) return 0;
    const already = seen();
    const fresh = messages.filter((m) => !already.has(m.key));
    const memberIds = new Set(store.get().members.map((m) => m.id));
    const known = (id?: string) => (id && memberIds.has(id) ? id : undefined);

    if (fresh.length) {
      store.update((s) => {
        for (const { msg: m } of fresh) {
          if (m.type === 'event') {
            const ev: CalEvent = {
              id: uid(),
              title: m.title,
              date: m.date,
              endDate: m.endDate,
              allDay: m.allDay,
              start: m.start,
              end: m.end,
              memberIds: m.memberIds.filter((id) => memberIds.has(id)),
              repeat: 'none',
              reminder: m.reminder,
              location: m.location,
              notes: m.notes,
            };
            s.events.push(ev);
          } else if (m.type === 'item') {
            s.items.push({ id: uid(), list: m.list, text: m.text, done: false, memberId: known(m.memberId), createdAt: Date.now() });
          } else {
            s.notes.push({ id: uid(), text: m.text, memberId: known(m.memberId), color: m.color ?? NOTE_COLOURS[0], createdAt: Date.now() });
          }
        }
      });
      remember(fresh.map((m) => m.key));
      play('gentle');
      const lines = fresh.slice(0, 4).map((m) => h('div', { class: 'toast-line', style: '--c:var(--accent)' }, describe(m.msg)));
      toast([h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, `📱 ${fresh.length === 1 ? 'Sent from a phone' : `${fresh.length} things sent from phones`}`), ...lines)], 10_000);
    }
    // Only now tell the server it can forget them (saved first, so nothing is lost)
    await api('inbox/ack', { method: 'POST', body: JSON.stringify({ keys: messages.map((m) => m.key) }) });
    return fresh.length;
  } catch {
    return 0;
  } finally {
    polling = false;
  }
}

/* ---------- pairing dialog ---------- */

function renderPairing() {
  const key = ensureHouseholdKey();
  publishProfile(true);
  const link = phoneLink(key);
  $('#pair-qr').replaceChildren(qrSvg(link));
  $('#pair-link').textContent = link.replace(/#k=.*/, '#k=…');
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) || location.protocol !== 'https:';
  $('#pair-warning').hidden = !local;
}

export function initHousehold() {
  $('#btn-phones').addEventListener('click', () => {
    renderPairing();
    $<HTMLDialogElement>('#pair-dialog').showModal();
  });
  $('#pair-copy').addEventListener('click', async () => {
    const key = householdKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(phoneLink(key));
      toast(['Link copied — send it to the family (privately!)'], 3500);
    } catch {
      toast(['Could not copy — scan the QR code instead.'], 3500);
    }
  });
  $('#pair-reset').addEventListener('click', async () => {
    if (!(await ask('Make a new code? Phones already paired will stop working until they scan the new QR code.', 'New code'))) return;
    setHouseholdKey(newKey());
    renderPairing();
    onKeyChange.forEach((f) => f());
  });

  store.subscribe(() => publishProfile());
  publishProfile(true);
  setTimeout(checkInbox, 2000);
  setInterval(() => document.visibilityState === 'visible' && checkInbox(), POLL_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkInbox());
  window.addEventListener('online', () => checkInbox());
}
