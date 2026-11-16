import type { CalEvent, Member, Repeat } from './types';
import { PALETTE, store, uid } from './store';
import { $, avatar, bellIcon, cls, h, initials, inkFor } from './dom';
import { LOCALE, REPEAT_LABEL, addDays, addMonths, dayLabel, endOf, eventsOn, fromKey, startOfMonth, toKey } from './dates';
import { initSaver } from './saver';
import { countLabel, initNotifications, notify, permission, remainingToday, requestPermission } from './notify';
import { setWakeLock, wakeLockSupported } from './wakelock';

/* ------------------------------ state ------------------------------ */

let viewMonth = startOfMonth(new Date());
let selected = toKey(new Date());
let todayKey = selected;
const hiddenMembers = new Set<string>(); // tapped-off in the filter bar

const S = () => store.get();
const memberById = (id: string) => S().members.find((m) => m.id === id);
const membersOf = (e: CalEvent) => e.memberIds.map(memberById).filter((m): m is Member => !!m);
const NEUTRAL = '#8a909c';
const colorOf = (e: CalEvent) => membersOf(e)[0]?.color ?? NEUTRAL;

const visibleOn = (key: string) =>
  eventsOn(S().events, key).filter((e) => !e.memberIds.length || e.memberIds.some((id) => !hiddenMembers.has(id)));

/* ------------------------------ clock ------------------------------ */

function tick() {
  const now = new Date();
  $('#clock-time').textContent = now.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  $('#clock-date').textContent = now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const k = toKey(now);
  if (k !== todayKey) {
    // Midnight rolled over: follow "today" if that's what was on screen
    if (selected === todayKey) {
      selected = k;
      viewMonth = startOfMonth(now);
    }
    todayKey = k;
    render();
  } else {
    renderAgendaStatus();
  }
}

/* ------------------------------ render ----------------------------- */

function render() {
  renderFilter();
  renderGrid();
  renderAgenda();
  saver.refresh();
}

function renderFilter() {
  const wrap = $('#member-filter');
  wrap.replaceChildren(
    ...S().members.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: cls('chip', hiddenMembers.has(m.id) && 'off'),
          'aria-pressed': String(!hiddenMembers.has(m.id)),
          title: hiddenMembers.has(m.id) ? `Show ${m.name}` : `Hide ${m.name}`,
          onclick: () => {
            hiddenMembers.has(m.id) ? hiddenMembers.delete(m.id) : hiddenMembers.add(m.id);
            render();
          },
        },
        avatar(m, 34),
        h('span', {}, m.name || 'Unnamed'),
      ),
    ),
  );
}

function renderGrid() {
  $('#month-title').textContent = viewMonth.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  const grid = $('#grid');
  const offset = (viewMonth.getDay() + 6) % 7; // Monday first
  let d = addDays(viewMonth, -offset);
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 42; i++) {
    const key = toKey(d);
    const evs = visibleOn(key);
    cells.push(
      h(
        'div',
        {
          role: 'button',
          tabindex: '0',
          'aria-label': `${dayLabel(key)}, ${evs.length} events`,
          class: cls('cell', d.getMonth() !== viewMonth.getMonth() && 'other', key === todayKey && 'today', key === selected && 'selected'),
          onclick: () => onCellTap(key),
          onkeydown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onCellTap(key),
        },
        h('span', { class: 'num' }, String(d.getDate())),
        h(
          'div',
          { class: 'pills' },
          ...evs.map((e) =>
            h('div', { class: cls('pill', e.allDay && 'allday'), style: `--c:${colorOf(e)}` }, e.allDay ? '' : `${e.start} `, e.title),
          ),
        ),
        h('span', { class: 'more', hidden: true }),
      ),
    );
    d = addDays(d, 1);
  }
  grid.replaceChildren(...cells);
  fitPills();
}

/** Show as many whole event pills as fit in each day cell, then "+N more" */
function fitPills() {
  for (const box of document.querySelectorAll<HTMLElement>('#grid .pills')) {
    const pills = [...box.querySelectorAll<HTMLElement>('.pill')];
    const more = box.parentElement!.querySelector<HTMLElement>('.more')!;
    pills.forEach((p) => (p.hidden = false));
    more.hidden = true;
    const limit = box.clientHeight;
    let shown = pills.length;
    for (let i = 0; i < pills.length; i++) {
      const bottom = pills[i].offsetTop + pills[i].offsetHeight; // .pills is position:relative
      if (bottom > limit) {
        shown = i;
        break;
      }
    }
    if (shown < pills.length) {
      pills.slice(shown).forEach((p) => (p.hidden = true));
      more.textContent = `+${pills.length - shown}`;
      more.hidden = false;
    }
  }
}
window.addEventListener('resize', () => requestAnimationFrame(fitPills));

function onCellTap(key: string) {
  if (key === selected) return openEvent(undefined, key); // second tap = add
  selected = key;
  const d = fromKey(key);
  if (d.getMonth() !== viewMonth.getMonth() || d.getFullYear() !== viewMonth.getFullYear()) viewMonth = startOfMonth(d);
  render();
}

function renderAgenda() {
  $('#agenda-title').textContent = dayLabel(selected);
  const list = $('#agenda-list');
  const evs = visibleOn(selected);
  if (!evs.length) {
    list.replaceChildren(
      h(
        'li',
        { class: 'empty' },
        h('p', {}, 'Nothing planned.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => openEvent(undefined, selected) }, '+ Add something'),
      ),
    );
    return;
  }
  const now = new Date();
  list.replaceChildren(
    ...evs.map((e) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: cls('item', selected === todayKey && endOf(e, selected) <= now && 'past'),
            style: `--c:${colorOf(e)}`,
            'data-id': e.id,
            onclick: () => openEvent(e),
          },
          h('div', { class: 'when' }, e.allDay ? 'All day' : (e.start ?? ''), !e.allDay && e.end ? h('small', {}, e.end) : null),
          h(
            'div',
            { class: 'what' },
            h('div', { class: 'title' }, e.title),
            e.notes ? h('div', { class: 'notes' }, e.notes) : null,
            e.repeat !== 'none' ? h('div', { class: 'tag' }, `↻ ${REPEAT_LABEL[e.repeat]}`) : null,
            e.reminder != null ? h('div', { class: 'tag' }, '🔔 Reminder') : null,
          ),
          h('div', { class: 'who' }, ...membersOf(e).map((m) => avatar(m, 34))),
        ),
      ),
    ),
  );
}

/** Fade finished items without rebuilding the list every tick */
function renderAgendaStatus() {
  if (selected !== todayKey) return;
  const now = new Date();
  for (const btn of document.querySelectorAll<HTMLElement>('#agenda-list .item')) {
    const e = S().events.find((x) => x.id === btn.dataset.id);
    if (e) btn.classList.toggle('past', endOf(e, selected) <= now);
  }
}

/* --------------------------- event dialog -------------------------- */

const evDialog = $<HTMLDialogElement>('#event-dialog');
const evForm = $<HTMLFormElement>('#event-form');
const field = <T extends HTMLElement = HTMLInputElement>(name: string) => evForm.elements.namedItem(name) as unknown as T;
let editing: CalEvent | null = null;
let picked = new Set<string>();

function renderPicker() {
  $('#event-members').replaceChildren(
    ...S().members.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: cls('chip', picked.has(m.id) && 'on'),
          style: `--c:${m.color}`,
          'aria-pressed': String(picked.has(m.id)),
          onclick: () => {
            picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id);
            renderPicker();
          },
        },
        avatar(m, 30),
        h('span', {}, m.name || 'Unnamed'),
      ),
    ),
  );
}

function syncAllDay() {
  const allDay = field('allDay').checked;
  field('start').disabled = allDay;
  field('end').disabled = allDay;
  $('#event-times').classList.toggle('disabled', allDay);
}

function openEvent(ev?: CalEvent, date?: string) {
  editing = ev ?? null;
  $('#event-dialog-title').textContent = ev ? 'Edit event' : 'New event';
  $('#event-delete').hidden = !ev;

  let start = ev?.start ?? '09:00';
  let end = ev?.end ?? '10:00';
  if (!ev && date === todayKey) {
    // default new events for today to the next whole hour
    const n = new Date();
    const hr = Math.min(n.getHours() + 1, 23);
    start = `${String(hr).padStart(2, '0')}:00`;
    end = `${String(Math.min(hr + 1, 23)).padStart(2, '0')}:${hr + 1 > 23 ? '59' : '00'}`;
  }

  field('title').value = ev?.title ?? '';
  field('date').value = ev?.date ?? date ?? selected;
  field('allDay').checked = ev?.allDay ?? false;
  field('start').value = start;
  field('end').value = ev ? (ev.end ?? '') : end;
  field<HTMLSelectElement>('repeat').value = ev?.repeat ?? 'none';
  field<HTMLSelectElement>('reminder').value = ev?.reminder != null ? String(ev.reminder) : '';
  field<HTMLTextAreaElement>('notes').value = ev?.notes ?? '';
  picked = new Set(ev?.memberIds ?? (S().members.length === 1 ? [S().members[0].id] : []));
  renderPicker();
  syncAllDay();
  evDialog.showModal();
  if (!ev) setTimeout(() => field('title').focus(), 50);
}

function saveEvent() {
  const title = field('title').value.trim();
  if (!title) return;
  const allDay = field('allDay').checked;
  const start = allDay ? undefined : field('start').value || undefined;
  let end = allDay ? undefined : field('end').value || undefined;
  if (start && end && end <= start) end = undefined;
  const reminderRaw = field<HTMLSelectElement>('reminder').value;

  const data: CalEvent = {
    id: editing?.id ?? uid(),
    title,
    date: field('date').value || selected,
    allDay: allDay || !start,
    start,
    end,
    memberIds: S().members.filter((m) => picked.has(m.id)).map((m) => m.id),
    repeat: field<HTMLSelectElement>('repeat').value as Repeat,
    reminder: reminderRaw === '' ? null : Number(reminderRaw),
    notes: field<HTMLTextAreaElement>('notes').value.trim() || undefined,
  };

  store.update((s) => {
    const i = s.events.findIndex((e) => e.id === data.id);
    if (i >= 0) s.events[i] = data;
    else s.events.push(data);
  });

  if (!editing) {
    selected = data.date;
    viewMonth = startOfMonth(fromKey(data.date));
    render();
  }
  if (data.reminder != null && S().settings.notifications === false && permission() !== 'unsupported') {
    toast([bellIcon(22), 'Reminders will show here. Turn on notifications in Settings to get them when the screen is off too.'], 6000);
  }
}

evForm.addEventListener('submit', (e) => {
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === 'save') saveEvent();
});
field('allDay').addEventListener('change', syncAllDay);
$('#event-delete').addEventListener('click', async () => {
  if (!editing) return;
  const msg = editing.repeat !== 'none' ? `Delete "${editing.title}" and all its repeats?` : `Delete "${editing.title}"?`;
  if (!(await ask(msg, 'Delete'))) return;
  const id = editing.id;
  store.update((s) => {
    s.events = s.events.filter((e) => e.id !== id);
  });
  evDialog.close();
});

/* -------------------------- members dialog ------------------------- */

const membersDialog = $<HTMLDialogElement>('#members-dialog');

function nextColour(): string {
  const used = new Set(S().members.map((m) => m.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function renderMembers(focusId?: string) {
  const list = $('#members-list');
  list.replaceChildren(
    ...S().members.map((m) => {
      const av = avatar(m, 52);
      const name = h('input', {
        class: 'input',
        value: m.name,
        placeholder: 'Name',
        'aria-label': 'Name',
        maxlength: '24',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          av.textContent = initials(v);
          av.title = v;
          store.update((s) => {
            const x = s.members.find((y) => y.id === m.id);
            if (x) x.name = v;
          });
        },
      });
      const setColour = (c: string) => {
        store.update((s) => {
          const x = s.members.find((y) => y.id === m.id);
          if (x) x.color = c;
        });
        renderMembers();
      };
      const custom = h('input', {
        type: 'color',
        value: m.color,
        'aria-label': 'Custom colour',
        onchange: (e: Event) => setColour((e.target as HTMLInputElement).value),
      });
      const row = h(
        'div',
        { class: 'member-row' },
        av,
        name,
        h(
          'button',
          {
            type: 'button',
            class: 'btn icon ghost',
            'aria-label': `Remove ${m.name}`,
            onclick: async () => {
              if (!(await ask(`Remove ${m.name || 'this person'}? Their events stay on the calendar, just unassigned.`, 'Remove'))) return;
              store.update((s) => {
                s.members = s.members.filter((x) => x.id !== m.id);
                s.events.forEach((e) => (e.memberIds = e.memberIds.filter((id) => id !== m.id)));
              });
              hiddenMembers.delete(m.id);
              renderMembers();
            },
          },
          '✕',
        ),
        h(
          'div',
          { class: 'swatches' },
          ...PALETTE.map((c) =>
            h('button', {
              type: 'button',
              class: cls('swatch', c.toLowerCase() === m.color.toLowerCase() && 'on'),
              style: `--c:${c}`,
              'aria-label': `Colour ${c}`,
              onclick: () => setColour(c),
            }),
          ),
          h('label', { class: cls('swatch custom', !PALETTE.includes(m.color) && 'on'), title: 'Pick any colour' }, custom),
        ),
      );
      if (m.id === focusId) setTimeout(() => name.focus(), 30);
      return row;
    }),
  );
  if (!S().members.length) list.append(h('p', { class: 'muted' }, 'No one yet — add the first person below.'));
}

$('#btn-members').addEventListener('click', () => {
  renderMembers();
  membersDialog.showModal();
});
$('#member-add').addEventListener('click', () => {
  const m: Member = { id: uid(), name: '', color: nextColour() };
  store.update((s) => s.members.push(m));
  renderMembers(m.id);
  const list = $('#members-list');
  list.scrollTop = list.scrollHeight;
});

/* ------------------------- settings dialog ------------------------- */

const settingsDialog = $<HTMLDialogElement>('#settings-dialog');
const idleSel = $<HTMLSelectElement>('#set-idle');
const awakeChk = $<HTMLInputElement>('#set-awake');
const summarySel = $<HTMLSelectElement>('#set-summary');
const nightA = $<HTMLSelectElement>('#set-night-start');
const nightB = $<HTMLSelectElement>('#set-night-end');

const hourOpts = () => Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${String(i).padStart(2, '0')}:00`));
summarySel.append(h('option', { value: '-1' }, 'Off'), ...hourOpts());
nightA.append(...hourOpts());
nightB.append(...hourOpts());

function renderNotifyStatus() {
  const p = permission();
  const s = S().settings;
  const status = $('#notify-status');
  const btn = $<HTMLButtonElement>('#set-notify');
  if (p === 'unsupported') {
    status.textContent = isSecureContext
      ? "This browser doesn't support notifications. On iPad, add the page to the Home Screen first."
      : 'Notifications need the site to be served over HTTPS (or localhost).';
    btn.disabled = true;
  } else if (p === 'denied') {
    status.textContent = 'Notifications are blocked for this site — allow them in the browser’s site settings.';
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.textContent = s.notifications && p === 'granted' ? 'Turn notifications off' : 'Turn notifications on';
    status.textContent =
      s.notifications && p === 'granted'
        ? 'On: you’ll get an alert when the screen turns off if something is still on today, plus reminders and a morning summary.'
        : 'Off.';
  }
  $<HTMLButtonElement>('#set-test').disabled = !(s.notifications && p === 'granted');
  $('#wake-status').textContent = wakeLockSupported() ? '' : 'Not supported in this browser — use the tablet’s own “screen timeout” setting instead.';
}

$('#btn-settings').addEventListener('click', () => {
  const s = S().settings;
  idleSel.value = String(s.idleMinutes);
  awakeChk.checked = s.keepAwake;
  summarySel.value = String(s.summaryHour);
  nightA.value = String(s.nightStart);
  nightB.value = String(s.nightEnd);
  renderNotifyStatus();
  settingsDialog.showModal();
});

idleSel.addEventListener('change', () => {
  store.update((s) => (s.settings.idleMinutes = Number(idleSel.value)));
  saver.rearm();
});
awakeChk.addEventListener('change', () => {
  store.update((s) => (s.settings.keepAwake = awakeChk.checked));
  setWakeLock(awakeChk.checked);
});
summarySel.addEventListener('change', () => store.update((s) => (s.settings.summaryHour = Number(summarySel.value))));
nightA.addEventListener('change', () => store.update((s) => (s.settings.nightStart = Number(nightA.value))));
nightB.addEventListener('change', () => store.update((s) => (s.settings.nightEnd = Number(nightB.value))));

$('#set-notify').addEventListener('click', async () => {
  const on = S().settings.notifications && permission() === 'granted';
  if (on) {
    store.update((s) => (s.settings.notifications = false));
  } else {
    const p = await requestPermission();
    store.update((s) => (s.settings.notifications = p === 'granted'));
  }
  renderNotifyStatus();
});
$('#set-test').addEventListener('click', async () => {
  const evs = remainingToday(S());
  const ok = await notify(
    evs.length ? `${countLabel(evs.length)} today` : 'Family Calendar',
    evs.length ? evs.map((e) => `${e.allDay ? 'All day' : e.start} · ${e.title}`).join('\n') : 'Notifications are working 👍',
    'test',
  );
  if (!ok) toast(['Could not show a notification — check the browser’s site settings.'], 5000);
});
$('#set-saver-now').addEventListener('click', () => {
  settingsDialog.close();
  setTimeout(() => saver.show(), 200);
});

// Backup
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `family-calendar-${toKey(new Date())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
});
const importFile = $<HTMLInputElement>('#import-file');
$('#import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!file) return;
  try {
    const next = store.parseBackup(await file.text());
    if (!(await ask(`Replace everything with this backup (${next.members.length} people, ${next.events.length} events)?`, 'Replace'))) return;
    store.replace(next);
    hiddenMembers.clear();
    toast(['Backup restored.'], 3000);
  } catch (err) {
    toast([(err as Error).message], 6000);
  }
});

/* ------------------------- confirm dialog -------------------------- */
// In-page replacement for window.confirm (blocked in kiosk browsers and sandboxed frames)
const confirmDialog = $<HTMLDialogElement>('#confirm-dialog');
function ask(message: string, okLabel = 'OK'): Promise<boolean> {
  $('#confirm-text').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true }));
}

/* ------------------------------- misc ------------------------------ */

// generic close buttons
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-close]');
  t?.closest('dialog')?.close();
});
// tap the dim backdrop to close a dialog
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
}

$('#prev').addEventListener('click', () => {
  viewMonth = addMonths(viewMonth, -1);
  render();
});
$('#next').addEventListener('click', () => {
  viewMonth = addMonths(viewMonth, 1);
  render();
});
$('#today-btn').addEventListener('click', () => {
  selected = todayKey;
  viewMonth = startOfMonth(new Date());
  render();
});
$('#add-event').addEventListener('click', () => openEvent(undefined, selected));

// swipe left/right on the month to change month
{
  let x0 = 0;
  let y0 = 0;
  const grid = $('#grid');
  grid.addEventListener('touchstart', (e) => ((x0 = e.touches[0].clientX), (y0 = e.touches[0].clientY)), { passive: true });
  grid.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        viewMonth = addMonths(viewMonth, dx < 0 ? 1 : -1);
        render();
      }
    },
    { passive: true },
  );
}

let toastTimer = 0;
function toast(content: (Node | string)[], ms = 4000) {
  const el = $('#toast');
  el.replaceChildren(...content);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}
$('#toast').addEventListener('click', () => $('#toast').classList.remove('on'));

// When the screen comes back on, show what's on today in-app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  tick();
  render();
  const evs = remainingToday(S());
  if (evs.length) {
    toast(
      [
        h(
          'div',
          { class: 'toast-body' },
          h('div', { class: 'toast-title' }, bellIcon(22), `${countLabel(evs.length)} today`),
          ...evs.slice(0, 4).map((e) =>
            h('div', { class: 'toast-line', style: `--c:${colorOf(e)}` }, h('b', {}, e.allDay ? 'All day' : (e.start ?? '')), ' ', e.title),
          ),
        ),
      ],
      8000,
    );
  }
});

/* ------------------------------- boot ------------------------------ */

const saver = initSaver({ getState: S, colorOf });
initNotifications(S, (title, body) => toast([h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, title), body)], 15000));
setWakeLock(S().settings.keepAwake);

store.subscribe(() => render());
tick();
render();
setInterval(tick, 10_000);

// expose a little for debugging from the console
Object.assign(window, { familyCalendar: { store, inkFor } });
