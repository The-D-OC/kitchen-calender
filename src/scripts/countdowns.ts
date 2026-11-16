import type { Countdown } from './types';
import { store, uid } from './store';
import { $, cls, h } from './dom';
import { LOCALE, addDays, daysBetween, fromKey, toKey } from './dates';
import { ask } from './ui';

/* "🎄 39 sleeps till Christmas" — countdowns for the side panel and screen saver. */

export const COUNTDOWN_EMOJI = ['🎄', '🎂', '✈️', '🏖️', '🎃', '🎆', '🐣', '🎁', '🏫', '⚽', '🎉', '💍', '🦷', '🐶', '🎢', '❤️'];

/** Date of the next occurrence (today counts), or null if a one-off has passed */
export function nextDate(c: Countdown, today = toKey(new Date())): string | null {
  if (!c.yearly) return c.date >= today ? c.date : null;
  const [, m, d] = c.date.split('-');
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const k = `${y}-${m}-${d}`;
    if (k >= today) return k;
  }
  return null;
}

export function daysTo(c: Countdown, today = toKey(new Date())): number | null {
  const n = nextDate(c, today);
  return n ? daysBetween(today, n) : null;
}

export function countdownLabel(c: Countdown): string {
  const n = daysTo(c);
  if (n == null) return 'Done';
  if (n === 0) return 'Today! 🎉';
  if (n === 1) return store.get().settings.countdownUnit === 'sleeps' ? '1 sleep' : 'Tomorrow';
  return `${n} ${store.get().settings.countdownUnit === 'sleeps' ? 'sleeps' : 'days'}`;
}

/** Upcoming countdowns, soonest first */
export function upcoming(): Countdown[] {
  return store
    .get()
    .countdowns.filter((c) => daysTo(c) != null)
    .sort((a, b) => (daysTo(a) ?? 0) - (daysTo(b) ?? 0));
}

export function countdownChip(c: Countdown, onClick?: () => void) {
  const n = daysTo(c);
  return h(
    'button',
    { type: 'button', class: cls('cd-chip', n === 0 && 'today', n != null && n <= 7 && 'soon'), onclick: onClick ?? null, title: c.title },
    h('span', { class: 'cd-emoji' }, c.emoji),
    h('span', { class: 'cd-text' }, h('b', {}, countdownLabel(c)), h('small', {}, c.title)),
  );
}

/* ---------- dialog ---------- */

let draft: Countdown | null = null;

function suggestions(): Omit<Countdown, 'id'>[] {
  const s = store.get();
  const year = new Date().getFullYear();
  const fixed: Omit<Countdown, 'id'>[] = [
    { title: 'Christmas', date: `${year}-12-25`, emoji: '🎄', yearly: true },
    { title: 'New Year', date: `${year}-01-01`, emoji: '🎆', yearly: true },
    { title: 'Halloween', date: `${year}-10-31`, emoji: '🎃', yearly: true },
    { title: 'Bonfire Night', date: `${year}-11-05`, emoji: '🎆', yearly: true },
  ];
  // Birthdays and anniversaries already on the calendar as yearly events
  const yearly = s.events
    .filter((e) => e.repeat === 'yearly' && !e.feedId)
    .map((e) => ({ title: e.title, date: e.date, emoji: /birthday|bday/i.test(e.title) ? '🎂' : /anniversary/i.test(e.title) ? '💍' : '🎉', yearly: true }));
  return [...fixed, ...yearly].filter((sg) => !s.countdowns.some((c) => c.title === sg.title));
}

function renderList() {
  const s = store.get();
  const list = [...s.countdowns].sort((a, b) => (daysTo(a) ?? 99999) - (daysTo(b) ?? 99999));
  $('#cd-list').replaceChildren(
    ...list.map((c) =>
      h(
        'div',
        { class: cls('cd-row', daysTo(c) == null && 'past') },
        countdownChip(c, () => openEditor(c)),
        h('span', { class: 'cd-date' }, nextDate(c) ? fromKey(nextDate(c)!).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Passed'),
      ),
    ),
  );
  if (!list.length) $('#cd-list').append(h('p', { class: 'muted small' }, 'No countdowns yet — add one or pick a suggestion below.'));
  $('#cd-suggestions').replaceChildren(
    ...suggestions().map((sg) =>
      h('button', { type: 'button', class: 'btn small', onclick: () => store.update((st) => st.countdowns.push({ ...sg, id: uid() })) }, `+ ${sg.emoji} ${sg.title}`),
    ),
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>('#cd-unit button')) b.classList.toggle('on', b.dataset.unit === s.settings.countdownUnit);
}

function openEditor(c?: Countdown) {
  draft = c ? { ...c } : { id: uid(), title: '', date: toKey(addDays(new Date(), 14)), emoji: '🎉', yearly: false };
  $('#cd-edit-title').textContent = c ? 'Edit countdown' : 'New countdown';
  $<HTMLInputElement>('#cd-title').value = draft.title;
  $<HTMLInputElement>('#cd-date').value = draft.date;
  $<HTMLInputElement>('#cd-yearly').checked = draft.yearly;
  $('#cd-delete').hidden = !c;
  const renderEmoji = () =>
    $('#cd-emojis').replaceChildren(
      ...COUNTDOWN_EMOJI.map((e) =>
        h(
          'button',
          {
            type: 'button',
            class: cls('emoji-btn', draft!.emoji === e && 'on'),
            onclick: () => {
              draft!.emoji = e;
              renderEmoji();
            },
          },
          e,
        ),
      ),
    );
  renderEmoji();
  $<HTMLDialogElement>('#cd-edit').showModal();
  if (!c) setTimeout(() => $<HTMLInputElement>('#cd-title').focus(), 50);
}

export function openCountdowns() {
  renderList();
  $<HTMLDialogElement>('#cd-dialog').showModal();
}

export function initCountdowns() {
  $('#cd-add').addEventListener('click', () => openEditor());
  $('#cd-save').addEventListener('click', () => {
    if (!draft) return;
    draft.title = $<HTMLInputElement>('#cd-title').value.trim();
    draft.date = $<HTMLInputElement>('#cd-date').value;
    draft.yearly = $<HTMLInputElement>('#cd-yearly').checked;
    if (!draft.title) return $<HTMLInputElement>('#cd-title').focus();
    if (!draft.date) return $<HTMLInputElement>('#cd-date').focus();
    const d = draft;
    store.update((s) => {
      const i = s.countdowns.findIndex((x) => x.id === d.id);
      if (i >= 0) s.countdowns[i] = d;
      else s.countdowns.push(d);
    });
    $<HTMLDialogElement>('#cd-edit').close();
  });
  $('#cd-delete').addEventListener('click', async () => {
    if (!draft || !(await ask(`Remove the “${draft.title}” countdown?`, 'Remove'))) return;
    const id = draft.id;
    store.update((s) => {
      s.countdowns = s.countdowns.filter((x) => x.id !== id);
    });
    $<HTMLDialogElement>('#cd-edit').close();
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#cd-unit button')) {
    b.addEventListener('click', () => store.update((s) => (s.settings.countdownUnit = b.dataset.unit as 'sleeps' | 'days')));
  }
  store.subscribe(() => {
    if ($<HTMLDialogElement>('#cd-dialog').open) renderList();
  });
}
