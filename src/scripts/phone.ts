import type { HouseholdProfile, InboxMessage } from './inbox-types';
import { $, avatar, cls, h } from './dom';
import { LOCALE, addDays, fromKey, toKey } from './dates';

/* "Send to the kitchen" — the page family members use on their phones. */

type Kind = 'event' | 'shopping' | 'todo' | 'note';
type Member = HouseholdProfile['members'][number];
/** Omit that works on each member of a union */
type Outgoing = InboxMessage extends unknown ? (InboxMessage extends infer T ? (T extends InboxMessage ? Omit<T, 'sentAt'> : never) : never) : never;

const KEY_STORE = 'family-calendar:phone-key';
const WHO_STORE = 'family-calendar:phone-who';
const PROFILE_STORE = 'family-calendar:phone-profile';
const HISTORY_STORE = 'family-calendar:phone-history';
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const NOTE_COLOURS = ['#ffe27a', '#ffb3a7', '#b8e6b0', '#a9d6f5', '#d9c2f0', '#ffd0e6'];

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/* ---------- pairing key: from the QR link (#k=…) or remembered ---------- */

const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromHash && KEY_PATTERN.test(fromHash)) ls.set(KEY_STORE, fromHash);
const key = ls.get(KEY_STORE);
// Opening the pairing link while this page is already open only changes the #hash — pick it up
window.addEventListener('hashchange', () => {
  const k = new URLSearchParams(location.hash.slice(1)).get('k');
  if (k && KEY_PATTERN.test(k) && k !== ls.get(KEY_STORE)) {
    ls.set(KEY_STORE, k);
    location.reload();
  }
});

let members: Member[] = [];
try {
  members = (JSON.parse(ls.get(PROFILE_STORE) || 'null') as HouseholdProfile | null)?.members ?? [];
} catch {
  members = [];
}
let me: { id?: string; name: string } | null = null;
try {
  me = JSON.parse(ls.get(WHO_STORE) || 'null');
} catch {
  me = null;
}

let kind: Kind = 'event';

/* ---------- small helpers ---------- */

function show(el: HTMLElement, on: boolean) {
  el.hidden = !on;
}

async function send(msg: Outgoing): Promise<void> {
  const res = await fetch('/api/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-household-key': key ?? '' },
    body: JSON.stringify({ ...msg, sender: me?.name }),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `Error ${res.status}`);
}

function pickChips(container: HTMLElement, selected: Set<string>, single = false, allowEveryone = false) {
  const render = () =>
    container.replaceChildren(
      ...(allowEveryone
        ? [
            h(
              'button',
              { type: 'button', class: cls('chip', !selected.size && 'on'), style: '--c:#9ba1ad', onclick: () => (selected.clear(), render()) },
              h('span', {}, 'Everyone'),
            ),
          ]
        : []),
      ...members.map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: cls('chip', selected.has(m.id) && 'on'),
            style: `--c:${m.color}`,
            onclick: () => {
              if (selected.has(m.id)) selected.delete(m.id);
              else {
                if (single) selected.clear();
                selected.add(m.id);
              }
              render();
            },
          },
          avatar(m, 28),
          h('span', {}, m.name || '—'),
        ),
      ),
    );
  render();
  return render;
}

let toastTimer = 0;
function status(text: string, error = false) {
  const el = $('#sent');
  el.className = cls('sent', error && 'error');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), error ? 9000 : 5000);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function remember(text: string) {
  let list: { text: string; at: number }[] = [];
  try {
    list = JSON.parse(ls.get(HISTORY_STORE) || '[]');
  } catch {
    list = [];
  }
  list.unshift({ text, at: Date.now() });
  ls.set(HISTORY_STORE, JSON.stringify(list.slice(0, 8)));
  renderHistory();
}

function renderHistory() {
  let list: { text: string; at: number }[] = [];
  try {
    list = JSON.parse(ls.get(HISTORY_STORE) || '[]');
  } catch {
    list = [];
  }
  $('#history').replaceChildren(
    ...list.map((i) =>
      h('li', {}, h('span', {}, i.text), h('small', {}, new Date(i.at).toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' }))),
    ),
  );
}

async function withButton(form: HTMLFormElement, fn: () => Promise<void>) {
  const btn = form.querySelector<HTMLButtonElement>('.send')!;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await fn();
  } catch (err) {
    status(navigator.onLine ? `Couldn’t send: ${(err as Error).message}` : 'You’re offline — try again when you have signal.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- who am I ---------- */

function renderWho() {
  const btn = $('#who-btn');
  btn.hidden = false;
  const m = members.find((x) => x.id === me?.id);
  btn.replaceChildren(...(m ? [avatar(m, 24)] : []), `Sending as ${me?.name ?? '…'} · change`);
}

function askWho() {
  const dlg = $<HTMLDialogElement>('#who-dialog');
  const sel = new Set<string>(me?.id ? [me.id] : []);
  pickChips($('#who-list'), sel, true);
  $<HTMLInputElement>('#who-other').value = me && !me.id ? me.name : '';
  $('#who-save').onclick = () => {
    const other = $<HTMLInputElement>('#who-other').value.trim();
    const m = members.find((x) => sel.has(x.id));
    me = other ? { name: other } : m ? { id: m.id, name: m.name } : me;
    if (!me) return;
    ls.set(WHO_STORE, JSON.stringify(me));
    renderWho();
    dlg.close();
  };
  dlg.showModal();
}

/* ---------- forms ---------- */

const eventForm = $<HTMLFormElement>('#form-event');
const listForm = $<HTMLFormElement>('#form-list');
const noteForm = $<HTMLFormElement>('#form-note');
const ef = <T extends HTMLElement = HTMLInputElement>(n: string) => eventForm.elements.namedItem(n) as unknown as T;

const eventWho = new Set<string>();
const todoWho = new Set<string>();
const noteWho = new Set<string>();
let renderPickers: (() => void)[] = [];

function setKind(k: Kind) {
  kind = k;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#kind-seg button')) b.classList.toggle('on', b.dataset.kind === k);
  show(eventForm, k === 'event');
  show(listForm, k === 'shopping' || k === 'todo');
  show(noteForm, k === 'note');
  $('#list-label').textContent = k === 'shopping' ? 'Add to shopping' : 'Add to the to-do list';
  listForm.querySelector('textarea')!.placeholder = k === 'shopping' ? 'milk, bread, eggs' : 'empty the dishwasher, feed the cat';
  show($('#todo-who'), k === 'todo');
}

function renderQuickDates() {
  const today = new Date();
  const current = ef('date').value;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  $('#quick-dates').replaceChildren(
    ...days.map((d, i) => {
      const k = toKey(d);
      return h(
        'button',
        {
          type: 'button',
          class: cls(current === k && 'on'),
          onclick: () => {
            ef('date').value = k;
            renderQuickDates();
          },
        },
        i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric' }),
      );
    }),
  );
}

function syncAllDay() {
  const allDay = ef('allDay').checked;
  show($('#p-times'), !allDay);
  show($('#p-enddate'), allDay);
}

function resetEvent() {
  eventForm.reset();
  ef('date').value = toKey(new Date());
  ef('start').value = '09:00';
  eventWho.clear();
  if (me?.id) eventWho.add(me.id);
  renderPickers.forEach((r) => r());
  syncAllDay();
  renderQuickDates();
}

eventForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = ef('title').value.trim();
  if (!title) {
    ef('title').focus();
    return status('Add a name for the event first.', true);
  }
  const date = ef('date').value || toKey(new Date());
  const allDay = ef('allDay').checked || !ef('start').value;
  const reminderRaw = ef<HTMLSelectElement>('reminder').value;
  withButton(eventForm, async () => {
    await send({
      type: 'event',
      title,
      date,
      endDate: allDay ? ef('endDate').value || undefined : undefined,
      allDay,
      start: allDay ? undefined : ef('start').value,
      end: allDay ? undefined : ef('end').value || undefined,
      memberIds: [...eventWho],
      location: ef('location').value.trim() || undefined,
      notes: ef<HTMLTextAreaElement>('notes').value.trim() || undefined,
      reminder: reminderRaw === '' ? null : Number(reminderRaw),
    });
    const when = fromKey(date).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
    status(`✓ Sent “${title}” (${when}${allDay ? '' : ` ${ef('start').value}`}). It’ll pop up on the kitchen screen in a moment.`);
    remember(`📅 ${title} · ${when}`);
    resetEvent();
  });
});
ef('allDay').addEventListener('change', syncAllDay);
ef('date').addEventListener('change', renderQuickDates);
ef('start').addEventListener('change', () => {
  // suggest an end time an hour later
  const [hh, mm] = ef('start').value.split(':').map(Number);
  if (!Number.isNaN(hh) && !ef('end').value && hh < 23) ef('end').value = `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
});

listForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const ta = listForm.querySelector('textarea')!;
  const parts = ta.value
    .split(/,|\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (!parts.length) {
    ta.focus();
    return;
  }
  const list = kind === 'todo' ? 'todo' : 'shopping';
  withButton(listForm, async () => {
    for (const text of parts) await send({ type: 'item', list, text, memberId: list === 'todo' ? [...todoWho][0] : undefined });
    status(`✓ Added ${parts.length === 1 ? `“${parts[0]}”` : `${parts.length} things`} to the ${list === 'shopping' ? 'shopping list' : 'to-do list'}.`);
    remember(`${list === 'shopping' ? '🛒' : '✅'} ${parts.join(', ')}`);
    ta.value = '';
  });
});

noteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const ta = noteForm.querySelector('textarea')!;
  const text = ta.value.trim();
  if (!text) {
    ta.focus();
    return;
  }
  withButton(noteForm, async () => {
    const forId = [...noteWho][0];
    await send({ type: 'note', text, memberId: forId, color: NOTE_COLOURS[Math.floor(Math.random() * NOTE_COLOURS.length)] });
    status('✓ Note stuck on the kitchen screen.');
    remember(`📝 ${text.slice(0, 40)}`);
    ta.value = '';
  });
});

for (const b of document.querySelectorAll<HTMLButtonElement>('#kind-seg button')) b.addEventListener('click', () => setKind(b.dataset.kind as Kind));
$('#who-btn').addEventListener('click', askWho);
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => e.target === d && d.close());

/* ---------- shared from another app (Android share sheet) ---------- */

function applyShare() {
  const q = new URLSearchParams(location.search);
  const title = q.get('title') ?? '';
  const text = q.get('text') ?? '';
  const url = q.get('url') ?? '';
  if (!title && !text && !url) return;
  const first = (title || text.split('\n')[0] || url).trim().slice(0, 80);
  ef('title').value = first;
  const rest = [text && text !== first ? text : '', url].filter(Boolean).join('\n').slice(0, 500);
  if (rest) {
    ef<HTMLTextAreaElement>('notes').value = rest;
    eventForm.querySelector('details')!.open = true;
  }
  history.replaceState(null, '', location.pathname + location.hash);
}

/* ---------- start ---------- */

async function loadProfile() {
  try {
    const res = await fetch('/api/profile', { headers: { 'x-household-key': key ?? '' }, cache: 'no-store' });
    if (!res.ok) return;
    const p = (await res.json()) as HouseholdProfile;
    if (!p.members?.length) return;
    members = p.members;
    ls.set(PROFILE_STORE, JSON.stringify(p));
    renderPickers.forEach((r) => r());
    if (me?.id) {
      const m = members.find((x) => x.id === me!.id);
      if (m && m.name !== me.name) {
        me = { id: m.id, name: m.name };
        ls.set(WHO_STORE, JSON.stringify(me));
      }
    }
    if (!me) askWho();
    else renderWho();
  } catch {
    /* offline: use the cached family */
  }
}

if (!key) {
  show($('#unpaired'), true);
} else {
  show($('#paired'), true);
  renderPickers = [
    pickChips($('#p-members'), eventWho),
    pickChips($('#p-todo-members'), todoWho, true),
    pickChips($('#p-note-members'), noteWho, true, true),
  ];
  setKind('event');
  resetEvent();
  applyShare();
  renderHistory();
  if (me) renderWho();
  loadProfile();
}
