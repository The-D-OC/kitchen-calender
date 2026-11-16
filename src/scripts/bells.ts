import type { Bell } from './types';
import { store, uid } from './store';
import { $, avatar, cls, h } from './dom';
import { play, speak } from './sound';
import { ask, showAlert } from './ui';
import { markFired, notify, readFired } from './notify';
import { WEEKDAY_SHORT, toKey } from './dates';

/* Family Bell: scheduled household chimes ("Dinner's ready!", "Shoes on for school"). */

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const SUGGESTIONS: Omit<Bell, 'id'>[] = [
  { label: 'Shoes and coats on for school', time: '08:15', days: WEEKDAYS, enabled: true, sound: 'bell', speak: true, memberIds: [] },
  { label: 'Homework time', time: '16:30', days: WEEKDAYS, enabled: true, sound: 'gentle', speak: true, memberIds: [] },
  { label: 'Dinner is ready', time: '17:30', days: EVERY_DAY, enabled: true, sound: 'chime', speak: true, memberIds: [] },
  { label: 'Bath and pyjamas', time: '19:00', days: EVERY_DAY, enabled: true, sound: 'gentle', speak: true, memberIds: [] },
];

export function daysLabel(days: number[]): string {
  const set = [...days].sort().join();
  if (set === EVERY_DAY.join()) return 'Every day';
  if (set === WEEKDAYS.join()) return 'Weekdays';
  if (set === '0,6') return 'Weekends';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(', ');
}

export function ringBell(b: Bell) {
  const s = store.get();
  play(b.sound);
  if (s.settings.voice && b.speak) setTimeout(() => speak(b.label), 2300);
  const who = b.memberIds.map((id) => s.members.find((m) => m.id === id)?.name).filter(Boolean).join(', ');
  if (s.settings.notifications) notify(`🔔 ${b.label}`, who || 'Family Bell', `bell-${b.id}`);
  const first = s.members.find((m) => b.memberIds.includes(m.id));
  showAlert({ title: b.label, subtitle: [b.time, who].filter(Boolean).join(' · '), color: first?.color, actions: [{ label: 'Done', primary: true }] });
}

function check() {
  const now = new Date();
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fired = readFired();
  for (const b of store.get().bells) {
    if (!b.enabled || b.time !== hhmm || !b.days.includes(now.getDay())) continue;
    const id = `bell|${b.id}|${toKey(now)}`;
    if (id in fired) continue;
    markFired(id);
    ringBell(b);
  }
}

/* ---------- manager + editor dialogs ---------- */

let editing: Bell | null = null;

function renderList() {
  const s = store.get();
  const list = $('#bells-list');
  list.replaceChildren(
    ...s.bells
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((b) =>
        h(
          'div',
          { class: cls('bell-row', !b.enabled && 'off') },
          h(
            'button',
            { type: 'button', class: 'bell-main', onclick: () => openEditor(b) },
            h('span', { class: 'bell-time' }, b.time),
            h('span', { class: 'bell-text' }, h('b', {}, b.label), h('small', {}, daysLabel(b.days))),
            h('span', { class: 'who' }, ...b.memberIds.map((id) => s.members.find((m) => m.id === id)).filter((m) => !!m).map((m) => avatar(m, 28))),
          ),
          h(
            'label',
            { class: 'switch', title: b.enabled ? 'On' : 'Off' },
            h('input', {
              type: 'checkbox',
              checked: b.enabled,
              onchange: (e: Event) =>
                store.update((st) => {
                  const x = st.bells.find((y) => y.id === b.id);
                  if (x) x.enabled = (e.target as HTMLInputElement).checked;
                }),
            }),
            h('span', {}),
          ),
        ),
      ),
  );
  if (!s.bells.length) list.append(h('p', { class: 'muted' }, 'No bells yet. Add one, or start from a suggestion:'));

  $('#bell-suggestions').replaceChildren(
    ...SUGGESTIONS.filter((sg) => !s.bells.some((b) => b.label === sg.label)).map((sg) =>
      h(
        'button',
        { type: 'button', class: 'btn small', onclick: () => store.update((st) => st.bells.push({ ...sg, id: uid() })) },
        `+ ${sg.time} ${sg.label}`,
      ),
    ),
  );
}

function openEditor(b?: Bell) {
  editing = b ?? null;
  const dlg = $<HTMLDialogElement>('#bell-dialog');
  const draft: Bell = b ? structuredClone(b) : { id: uid(), label: '', time: '17:30', days: [...EVERY_DAY], enabled: true, sound: 'chime', speak: true, memberIds: [] };
  $('#bell-dialog-title').textContent = b ? 'Edit bell' : 'New bell';
  $<HTMLInputElement>('#bell-label').value = draft.label;
  $<HTMLInputElement>('#bell-time').value = draft.time;
  $<HTMLSelectElement>('#bell-sound').value = draft.sound;
  $<HTMLInputElement>('#bell-speak').checked = draft.speak;
  $('#bell-delete').hidden = !b;

  const renderDays = () =>
    $('#bell-days').replaceChildren(
      ...[1, 2, 3, 4, 5, 6, 0].map((d) =>
        h(
          'button',
          {
            type: 'button',
            class: cls('day-toggle', draft.days.includes(d) && 'on'),
            onclick: () => {
              draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d];
              renderDays();
            },
          },
          WEEKDAY_SHORT[d],
        ),
      ),
    );
  const renderWho = () =>
    $('#bell-members').replaceChildren(
      ...store.get().members.map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: cls('chip', draft.memberIds.includes(m.id) && 'on'),
            style: `--c:${m.color}`,
            onclick: () => {
              draft.memberIds = draft.memberIds.includes(m.id) ? draft.memberIds.filter((x) => x !== m.id) : [...draft.memberIds, m.id];
              renderWho();
            },
          },
          avatar(m, 28),
          h('span', {}, m.name),
        ),
      ),
    );
  renderDays();
  renderWho();

  $('#bell-save').onclick = () => {
    draft.label = $<HTMLInputElement>('#bell-label').value.trim() || 'Family bell';
    draft.time = $<HTMLInputElement>('#bell-time').value || '17:30';
    draft.sound = $<HTMLSelectElement>('#bell-sound').value as Bell['sound'];
    draft.speak = $<HTMLInputElement>('#bell-speak').checked;
    if (!draft.days.length) draft.days = [...EVERY_DAY];
    store.update((s) => {
      const i = s.bells.findIndex((x) => x.id === draft.id);
      if (i >= 0) s.bells[i] = draft;
      else s.bells.push(draft);
    });
    dlg.close();
  };
  $('#bell-test').onclick = () => {
    play($<HTMLSelectElement>('#bell-sound').value as Bell['sound']);
    const text = $<HTMLInputElement>('#bell-label').value.trim();
    if ($<HTMLInputElement>('#bell-speak').checked && text) setTimeout(() => speak(text), 2300);
  };
  $('#bell-delete').onclick = async () => {
    if (!editing || !(await ask(`Delete the “${editing.label}” bell?`, 'Delete'))) return;
    const id = editing.id;
    store.update((s) => {
      s.bells = s.bells.filter((x) => x.id !== id);
    });
    dlg.close();
  };
  dlg.showModal();
}

export function initBells() {
  $('#btn-bells').addEventListener('click', () => {
    renderList();
    $<HTMLDialogElement>('#bells-dialog').showModal();
  });
  $('#bell-add').addEventListener('click', () => openEditor());
  store.subscribe(() => {
    if ($<HTMLDialogElement>('#bells-dialog').open) renderList();
  });
  check();
  setInterval(check, 10_000);
}
