import type { CalEvent, Feed, Member, Repeat } from './types';
import { PALETTE, store, uid } from './store';
import { $, avatar, bellIcon, cls, h, initials, inkFor } from './dom';
import {
  LOCALE,
  REPEAT_LABEL,
  addDays,
  addMonths,
  clashes,
  dayLabel,
  endOf,
  eventsOn,
  fromKey,
  startOf,
  startOfMonth,
  startOfWeek,
  toKey,
  untilLabel,
} from './dates';
import { initSaver } from './saver';
import { countLabel, initNotifications, notify, permission, remainingToday, requestPermission } from './notify';
import { setWakeLock, wakeLockSupported } from './wakelock';
import { ask, toast } from './ui';
import { initTimers } from './timers';
import { initBells } from './bells';
import { initNotes, renderLists, renderNotes } from './widgets';
import { cachedWeather, describeWeather, fetchWeather, searchPlaces, type Forecast } from './weather';
import { addPhotos, clearPhotos, photoCount } from './photos';
import { importIcsFile, initFeeds, normaliseUrl, syncFeed } from './feeds';
import { householdKey, initHousehold } from './household';
import { backupStatusText, initBackup } from './backup';
import { applyTheme, initTheme, themeStatus } from './theme';
import { countdownChip, countdownLabel, initCountdowns, openCountdowns, upcoming } from './countdowns';
import { binIcon, binLabel, binNoticeEl, binsOn, initBins, nextCollection, openBins } from './bins';

/* ------------------------------ state ------------------------------ */

let viewMonth = startOfMonth(new Date());
let selected = toKey(new Date());
let todayKey = selected;
type Screen = 'today' | 'calendar' | 'lists' | 'notes';
let screen: Screen = 'today';
const hiddenMembers = new Set<string>(); // tapped-off in the filter bar

const S = () => store.get();
const memberById = (id: string) => S().members.find((m) => m.id === id);
const membersOf = (e: CalEvent) => e.memberIds.map(memberById).filter((m): m is Member => !!m);
const feedOf = (e: CalEvent) => (e.feedId ? S().feeds.find((f) => f.id === e.feedId) : undefined);
const NEUTRAL = '#8a909c';
const colorOf = (e: CalEvent) => membersOf(e)[0]?.color ?? feedOf(e)?.color ?? NEUTRAL;

const visibleOn = (key: string) =>
  eventsOn(S().events, key).filter((e) => !e.memberIds.length || e.memberIds.some((id) => !hiddenMembers.has(id)));

/* ------------------------------ header ----------------------------- */

function tick() {
  const now = new Date();
  $('#clock-time').textContent = now.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  $('#clock-date').textContent = now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
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
    renderNextUp();
    if (screen === 'today') renderToday();
    if (screen === 'calendar') {
      renderAgendaStatus();
      renderSideTop();
    }
  }
}

/** "Next: 17:30 Swimming · in 2 h" under the clock */
function renderNextUp() {
  const now = new Date();
  const next = visibleOn(todayKey).find((e) => !e.allDay && e.start && startOf(e, todayKey) > now);
  const el = $('#next-up');
  if (!next) {
    el.replaceChildren();
    return;
  }
  el.replaceChildren(
    h('span', { class: 'dot', style: `--c:${colorOf(next)}` }),
    h('b', {}, `${next.start} ${next.title}`),
    ` · ${untilLabel(startOf(next, todayKey).getTime() - now.getTime())}`,
  );
}

function renderFilter() {
  const wrap = $('#member-filter');
  let pressTimer = 0;
  let longPressed = false;
  wrap.replaceChildren(
    ...S().members.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: cls('chip', hiddenMembers.has(m.id) && 'off'),
          'aria-pressed': String(!hiddenMembers.has(m.id)),
          title: 'Tap to show/hide · hold to see only their day',
          onpointerdown: () => {
            longPressed = false;
            pressTimer = window.setTimeout(() => {
              longPressed = true;
              hiddenMembers.clear();
              S().members.forEach((x) => x.id !== m.id && hiddenMembers.add(x.id));
              toast([avatar(m, 28), ` Showing ${m.name}'s day only`], 2500);
              render();
            }, 550);
          },
          onpointerup: () => clearTimeout(pressTimer),
          onpointerleave: () => clearTimeout(pressTimer),
          oncontextmenu: (e: Event) => e.preventDefault(),
          onclick: () => {
            if (longPressed) return;
            hiddenMembers.has(m.id) ? hiddenMembers.delete(m.id) : hiddenMembers.add(m.id);
            render();
          },
        },
        avatar(m, 34),
        h('span', {}, m.name || 'Unnamed'),
      ),
    ),
    ...(hiddenMembers.size > 0
      ? [
          h(
            'button',
            {
              type: 'button',
              class: 'btn small ghost',
              onclick: () => {
                hiddenMembers.clear();
                render();
              },
            },
            'Show all',
          ),
        ]
      : []),
  );
}

/* ------------------------------ weather ---------------------------- */

let forecast: Forecast | null = null;

function renderWeatherChip() {
  const chip = $('#weather');
  const place = S().settings.weather;
  if (!place) {
    chip.replaceChildren(h('span', { class: 'w-icon' }, '🌤️'), h('span', { class: 'w-add' }, 'Add weather'));
    return;
  }
  forecast = cachedWeather(place) ?? forecast;
  if (!forecast) {
    chip.replaceChildren(h('span', { class: 'w-icon' }, '…'));
    return;
  }
  const today = forecast.days[0];
  chip.replaceChildren(
    h('span', { class: 'w-icon' }, describeWeather(forecast.code).icon),
    h('span', { class: 'w-temp' }, `${forecast.temp}°`),
    ...(today ? [h('span', { class: 'w-range' }, `${today.max}° / ${today.min}°`)] : []),
  );
}

async function refreshWeather(force = false) {
  const place = S().settings.weather;
  if (!place) return renderWeatherChip();
  try {
    forecast = await fetchWeather(place, force);
    applyTheme();
  } catch {
    /* keep showing the cached forecast */
  }
  renderWeatherChip();
  saver.refresh();
}

function openWeather() {
  const place = S().settings.weather;
  if (!place) return openSettings('settings-weather');
  const dlg = $<HTMLDialogElement>('#weather-dialog');
  $('#weather-place').textContent = place.name;
  const f = forecast;
  $('#weather-days').replaceChildren(
    ...(f?.days ?? []).map((d, i) => {
      const w = describeWeather(d.code);
      return h(
        'div',
        { class: 'wday' },
        h('div', { class: 'wday-name' }, i === 0 ? 'Today' : fromKey(d.date).toLocaleDateString(LOCALE, { weekday: 'short' })),
        h('div', { class: 'wday-icon' }, w.icon),
        h('div', { class: 'wday-temp' }, h('b', {}, `${d.max}°`), ` ${d.min}°`),
        h('div', { class: 'wday-rain' }, d.rain ? `💧 ${d.rain}%` : ''),
      );
    }),
  );
  $('#weather-now').textContent = f ? `${describeWeather(f.code).label}, ${f.temp}° now` : 'No forecast yet';
  dlg.showModal();
}

/* ------------------------------ render ----------------------------- */

function render() {
  renderFilter();
  renderNextUp();
  renderScreen();
  saver.refresh();
}

/** Show one screen (Today / calendar / lists / notes) and draw it */
function renderScreen() {
  const view = S().settings.view;
  const navKey = screen === 'calendar' ? view : screen;
  const s = S();
  const counts: Record<string, number> = { lists: s.items.filter((i) => !i.done).length, notes: s.notes.length };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#screen-nav button')) {
    const k = b.dataset.screen!;
    b.classList.toggle('on', k === navKey);
    b.setAttribute('aria-current', k === navKey ? 'page' : 'false');
    b.replaceChildren(b.dataset.label ?? (b.dataset.label = b.textContent ?? ''), ...(counts[k] ? [h('span', { class: 'badge' }, String(counts[k]))] : []));
  }
  for (const id of ['today', 'calendar', 'lists', 'notes'] as Screen[]) $(`#screen-${id}`).hidden = id !== screen;
  if (screen === 'today') renderToday();
  else if (screen === 'calendar') {
    renderCalendar();
    renderSide();
  } else if (screen === 'lists') renderLists($('#lists-body'));
  else renderNotes($('#notes-body'));
}

export function goTo(next: Screen | 'week' | 'month') {
  if (next === 'week' || next === 'month') {
    screen = 'calendar';
    if (S().settings.view !== next) {
      store.update((st) => (st.settings.view = next)); // re-renders
      return;
    }
  } else screen = next;
  render();
}

/* ------------------------------ Today home ------------------------------ */

// darker shade of a person's colour for text (lighter in the dark theme, via --shade-to)
const shade = (c: string) => `color-mix(in srgb, ${c} 72%, var(--shade-to))`;

function todayRow(e: CalEvent, now: Date, nextId?: string) {
  const past = endOf(e, todayKey) <= now;
  const until = !past && !e.allDay && e.start ? startOf(e, todayKey).getTime() - now.getTime() : 0;
  const sub = past
    ? 'Done'
    : [e.id === nextId && until > 0 ? untilLabel(until) : '', e.location, e.notes?.split('\n')[0]].filter(Boolean).join(' · ');
  return h(
    'li',
    {},
    h(
      'button',
      { type: 'button', class: cls('trow', past && 'past', e.allDay && 'allday'), style: `--c:${colorOf(e)};--deep:${shade(colorOf(e))}`, onclick: () => openEvent(e) },
      h('span', { class: 'ttime' }, e.allDay ? 'All day' : (e.start ?? '')),
      h('span', { class: 'tbody' }, h('span', { class: 'ttitle' }, e.title), sub ? h('span', { class: 'tsub' }, sub) : null),
      h('span', { class: 'who' }, ...membersOf(e).map((m) => avatar(m, 36))),
    ),
  );
}

function renderToday() {
  const now = new Date();
  const evs = visibleOn(todayKey);
  const left = evs.filter((e) => endOf(e, todayKey) > now);
  const next = left.find((e) => !e.allDay && e.start);
  $('#today-meta').textContent = evs.length
    ? `${evs.length} ${evs.length === 1 ? 'thing' : 'things'} · ${left.length ? `${left.length} still to come` : 'all done'}`
    : '';
  $('#today-list').replaceChildren(
    ...(evs.length
      ? evs.map((e) => todayRow(e, now, next?.id))
      : [
          h(
            'li',
            { class: 'empty' },
            h('p', {}, 'Nothing on today.'),
            h('button', { type: 'button', class: 'btn', onclick: () => openEvent(undefined, todayKey) }, '+ Add something'),
          ),
        ]),
  );

  const tk = toKey(addDays(now, 1));
  $('#tomorrow-date').textContent = fromKey(tk).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric' });
  const tev = visibleOn(tk);
  $('#tomorrow-list').replaceChildren(
    ...(tev.length
      ? tev.slice(0, 5).map((e) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', class: 'trow compact', style: `--c:${colorOf(e)}`, onclick: () => openEvent(e) },
              h('span', { class: 'tbar' }),
              h('span', { class: 'ttime' }, e.allDay ? 'All day' : (e.start ?? '')),
              h('span', { class: 'ttitle' }, e.title),
            ),
          ),
        )
      : [h('li', { class: 'muted-row' }, 'Nothing planned yet.')]),
    ...(tev.length > 5 ? [h('li', { class: 'muted-row' }, `+${tev.length - 5} more`)] : []),
  );

  // Notes on the fridge
  const notes = [...S().notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
  const fridge = $('#today-notes');
  fridge.onclick = () => goTo('notes');
  fridge.replaceChildren(
    h('span', { class: 'tile-label' }, 'Notes on the fridge'),
    ...(notes.length
      ? notes.map((n) => {
          const m = n.memberId ? memberById(n.memberId) : undefined;
          return h('span', { class: 'fridge-note' }, n.text, m ? h('i', {}, ` — for ${m.name}`) : null);
        })
      : [h('span', { class: 'fridge-note muted' }, 'Leave a note for the family…')]),
  );

  renderTodayAside();
}

function renderTodayAside() {
  const s = S();
  const tiles: HTMLElement[] = [];

  // Bins: the reminder when it's due, otherwise when the next one is
  const notice = binNoticeEl(true);
  if (notice) tiles.push(notice);
  else if (s.bins.length) {
    const next = s.bins
      .map((b) => ({ b, k: nextCollection(b, toKey(addDays(new Date(), 1))) }))
      .sort((x, y) => x.k.localeCompare(y.k));
    const k = next[0].k;
    const due = next.filter((n) => n.k === k).map((n) => n.b);
    tiles.push(
      h(
        'button',
        { type: 'button', class: 'tile bin-tile', onclick: openBins },
        h('span', { class: 'bin-icons' }, ...due.map((b) => binIcon(b.color, 30))),
        h('span', {}, h('b', {}, `Next bins: ${fromKey(k).toLocaleDateString(LOCALE, { weekday: 'long' })}`), h('small', {}, due.map((b) => b.name).join(' + '))),
      ),
    );
  }

  // Countdowns
  const cds = upcoming().slice(0, 3);
  tiles.push(
    h(
      'button',
      { type: 'button', class: 'tile cd-tile', onclick: openCountdowns },
      h('span', { class: 'tile-label' }, 'Countdowns'),
      ...(cds.length
        ? cds.map((c) => h('span', { class: 'cd-line' }, h('span', { class: 'cd-emoji' }, c.emoji), h('b', {}, countdownLabel(c)), h('span', {}, c.title)))
        : [h('span', { class: 'muted' }, 'Add one — Christmas, holidays, birthdays')]),
    ),
  );

  // Shopping + to-do
  const shop = s.items.filter((i) => i.list === 'shopping' && !i.done);
  const todo = s.items.filter((i) => i.list === 'todo' && !i.done);
  tiles.push(
    h(
      'button',
      { type: 'button', class: 'tile list-tile', onclick: () => goTo('lists') },
      h('span', { class: 'tile-label' }, `Shopping${shop.length ? ` · ${shop.length}` : ''}`),
      h('span', { class: 'list-preview' }, shop.length ? shop.slice(0, 8).map((i) => i.text).join(' · ') : 'Nothing on the list'),
      ...(todo.length ? [h('span', { class: 'tile-label', style: 'margin-top:10px' }, `To-do · ${todo.length}`), h('span', { class: 'list-preview' }, todo.slice(0, 4).map((i) => i.text).join(' · '))] : []),
    ),
  );
  $('#today-aside').replaceChildren(...tiles);
}

function renderCalendar() {
  const view = S().settings.view;
  $('#month-wrap').hidden = view !== 'month';
  $('#week').hidden = view !== 'week';
  if (view === 'month') renderGrid();
  else renderWeek();
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
          onclick: () => onDayTap(key),
          onkeydown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && onDayTap(key),
        },
        h(
          'div',
          { class: 'cell-top' },
          h('span', { class: 'num' }, String(d.getDate())),
          ...binsOn(key).map((b) => binIcon(b.color, 17)),
        ),
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

/** Show as many whole event pills as fit in each day cell, then "+N" */
function fitPills() {
  for (const box of document.querySelectorAll<HTMLElement>('#grid .pills')) {
    const pills = [...box.querySelectorAll<HTMLElement>('.pill')];
    const more = box.parentElement!.querySelector<HTMLElement>('.more')!;
    pills.forEach((p) => (p.hidden = false));
    more.hidden = true;
    const limit = box.clientHeight;
    let shown = pills.length;
    for (let i = 0; i < pills.length; i++) {
      if (pills[i].offsetTop + pills[i].offsetHeight > limit) {
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

function renderWeek() {
  const start = startOfWeek(fromKey(selected));
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  $('#month-title').textContent = `${start.toLocaleDateString(LOCALE, { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })} – ${end.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const now = new Date();
  const cols: HTMLElement[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const key = toKey(d);
    const evs = visibleOn(key);
    cols.push(
      h(
        'div',
        { class: cls('wcol', key === todayKey && 'today', key === selected && 'selected') },
        h(
          'button',
          { type: 'button', class: 'whead', onclick: () => onDayTap(key) },
          h('span', { class: 'wname' }, d.toLocaleDateString(LOCALE, { weekday: 'short' })),
          h('span', { class: 'num' }, String(d.getDate())),
          binsOn(key).length ? h('span', { class: 'wbins' }, ...binsOn(key).map((b) => binIcon(b.color, 18))) : null,
        ),
        h(
          'div',
          { class: 'wbody', onclick: (e: Event) => e.target === e.currentTarget && onDayTap(key) },
          ...evs.map((e) =>
            h(
              'button',
              {
                type: 'button',
                class: cls('wevent', e.allDay && 'allday', key === todayKey && endOf(e, key) <= now && 'past'),
                style: `--c:${colorOf(e)}`,
                onclick: () => openEvent(e),
              },
              h('span', { class: 'wtime' }, e.allDay ? 'All day' : `${e.start}${e.end ? `–${e.end}` : ''}`),
              h('span', { class: 'wtitle' }, e.title),
              e.location ? h('span', { class: 'wloc' }, `📍 ${e.location}`) : null,
              membersOf(e).length ? h('span', { class: 'who' }, ...membersOf(e).map((m) => avatar(m, 24))) : null,
            ),
          ),
        ),
      ),
    );
  }
  $('#week').replaceChildren(...cols);
}

function onDayTap(key: string) {
  if (key === selected) return openEvent(undefined, key); // second tap = add
  selected = key;
  const d = fromKey(key);
  if (d.getMonth() !== viewMonth.getMonth() || d.getFullYear() !== viewMonth.getFullYear()) viewMonth = startOfMonth(d);
  render();
}

/* ------------------------------ sidebar ---------------------------- */

/** Bin notice + countdowns above the side panel tabs */
function renderSideTop() {
  const top = $('#side-top');
  const notice = binNoticeEl();
  const cds = upcoming().slice(0, notice ? 2 : 3);
  top.replaceChildren(
    ...(notice ? [notice] : []),
    ...cds.map((c) => countdownChip(c, openCountdowns)),
    ...(!cds.length ? [h('button', { type: 'button', class: 'cd-chip add', onclick: openCountdowns }, h('span', { class: 'cd-emoji' }, '⏳'), h('span', { class: 'cd-text' }, h('b', {}, 'Countdown'), h('small', {}, 'Add one')))] : []),
  );
}

function renderSide() {
  renderSideTop();
  renderAgenda($('#side-body'));
}

function renderAgenda(root: HTMLElement) {
  const evs = visibleOn(selected);
  const now = new Date();
  const head = h(
    'div',
    { class: 'agenda-head' },
    h('h2', {}, dayLabel(selected)),
    h('button', { type: 'button', class: 'btn primary', onclick: () => openEvent(undefined, selected) }, '+ Add'),
  );
  const bins = binsOn(selected);
  const binsBox =
    bins.length > 0
      ? h(
          'button',
          { type: 'button', class: 'agenda-bins', onclick: openBins },
          ...bins.map((b) => h('span', { class: 'agenda-bin' }, binIcon(b.color, 26), binLabel(b))),
        )
      : null;
  if (!evs.length) {
    root.replaceChildren(
      head,
      ...(binsBox ? [binsBox] : []),
      h(
        'div',
        { class: 'empty' },
        h('p', {}, 'Nothing planned.'),
        h('button', { type: 'button', class: 'btn', onclick: () => openEvent(undefined, selected) }, '+ Add something'),
      ),
    );
    return;
  }
  root.replaceChildren(
    head,
    ...(binsBox ? [binsBox] : []),
    h(
      'ul',
      { id: 'agenda-list' },
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
              e.location ? h('div', { class: 'notes' }, `📍 ${e.location}`) : null,
              e.notes ? h('div', { class: 'notes' }, e.notes) : null,
              e.repeat !== 'none' ? h('div', { class: 'tag' }, `↻ ${REPEAT_LABEL[e.repeat]}`) : null,
              e.reminder != null ? h('div', { class: 'tag' }, '🔔 Reminder') : null,
              e.feedId ? h('div', { class: 'tag' }, `🔗 ${feedOf(e)?.name ?? 'Linked'}`) : null,
            ),
            h('div', { class: 'who' }, ...membersOf(e).map((m) => avatar(m, 34))),
          ),
        ),
      ),
    ),
  );
}

/** Fade finished items without rebuilding the list every tick */
function renderAgendaStatus() {
  if (selected !== todayKey || screen !== 'calendar') return;
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

function renderPicker(readOnly = false) {
  $('#event-members').replaceChildren(
    ...S().members.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: cls('chip', picked.has(m.id) && 'on'),
          style: `--c:${m.color}`,
          disabled: readOnly,
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
  $('#event-times').hidden = allDay;
  $('#event-enddate').hidden = !allDay;
}

function openEvent(ev?: CalEvent, date?: string) {
  editing = ev ?? null;
  const feed = ev ? feedOf(ev) : undefined;
  const readOnly = !!ev?.feedId;
  $('#event-dialog-title').textContent = readOnly ? ev!.title : ev ? 'Edit event' : 'New event';
  $('#event-delete').hidden = !ev || readOnly;
  $('#event-save').hidden = readOnly;
  $('#event-readonly').hidden = !readOnly;
  $('#event-readonly').textContent = readOnly ? `From your linked calendar “${feed?.name ?? 'calendar'}”. Change it in the original calendar app — it syncs here automatically.` : '';
  evForm.classList.toggle('readonly', readOnly);
  for (const el of evForm.querySelectorAll<HTMLInputElement>('input, select, textarea')) el.disabled = readOnly;

  let start = ev?.start ?? '09:00';
  let end = ev?.end ?? '10:00';
  if (!ev && date === todayKey) {
    // default new events for today to the next whole hour
    const hr = Math.min(new Date().getHours() + 1, 22);
    start = `${String(hr).padStart(2, '0')}:00`;
    end = `${String(hr + 1).padStart(2, '0')}:00`;
  }

  field('title').value = ev?.title ?? '';
  field('date').value = ev?.date ?? date ?? selected;
  field('endDate').value = ev?.endDate ?? '';
  field('allDay').checked = ev?.allDay ?? false;
  field('start').value = start;
  field('end').value = ev ? (ev.end ?? '') : end;
  field('location').value = ev?.location ?? '';
  field<HTMLSelectElement>('repeat').value = ev?.repeat ?? 'none';
  field<HTMLSelectElement>('reminder').value = ev?.reminder != null ? String(ev.reminder) : '';
  field<HTMLTextAreaElement>('notes').value = ev?.notes ?? '';
  picked = new Set(ev?.memberIds ?? (S().members.length === 1 ? [S().members[0].id] : []));
  renderPicker(readOnly);
  syncAllDay();
  evDialog.showModal();
  if (!ev) setTimeout(() => field('title').focus(), 50);
}

async function saveEvent() {
  const title = field('title').value.trim();
  if (!title) {
    field('title').focus();
    field('title').reportValidity();
    return;
  }
  const allDay = field('allDay').checked;
  const start = allDay ? undefined : field('start').value || undefined;
  let end = allDay ? undefined : field('end').value || undefined;
  if (start && end && end <= start) end = undefined;
  const date = field('date').value || selected;
  const endDate = allDay && field('endDate').value > date ? field('endDate').value : undefined;
  const reminderRaw = field<HTMLSelectElement>('reminder').value;

  const data: CalEvent = {
    id: editing?.id ?? uid(),
    title,
    date,
    endDate,
    allDay: allDay || !start,
    start,
    end,
    memberIds: S().members.filter((m) => picked.has(m.id)).map((m) => m.id),
    repeat: field<HTMLSelectElement>('repeat').value as Repeat,
    reminder: reminderRaw === '' ? null : Number(reminderRaw),
    location: field('location').value.trim() || undefined,
    notes: field<HTMLTextAreaElement>('notes').value.trim() || undefined,
  };

  // Like Alexa+: warn about double-booking the same person
  const clash = clashes(data, S().events);
  if (clash.length) {
    const c = clash[0];
    const who = membersOf(c).map((m) => m.name).join(', ') || 'the family';
    const ok = await ask(`This clashes with “${c.title}” (${c.start}${c.end ? `–${c.end}` : ''}) for ${who}. Save anyway?`, 'Save anyway', false);
    if (!ok) return;
  }

  store.update((s) => {
    const i = s.events.findIndex((e) => e.id === data.id);
    if (i >= 0) s.events[i] = data;
    else s.events.push(data);
  });
  evDialog.close();

  if (!editing) {
    selected = data.date;
    viewMonth = startOfMonth(fromKey(data.date));
    render();
  }
  if (data.reminder != null && !S().settings.notifications && permission() !== 'unsupported') {
    toast([bellIcon(22), 'Reminders will show here. Turn on notifications in Settings to get them when the screen is off too.'], 6000);
  }
}

$('#event-save').addEventListener('click', saveEvent);
evForm.addEventListener('submit', (e) => {
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value !== 'cancel') {
    e.preventDefault();
    saveEvent();
  }
});
field('allDay').addEventListener('change', syncAllDay);
$('#event-delete').addEventListener('click', async () => {
  if (!editing) return;
  const msg = editing.repeat !== 'none' ? `Delete “${editing.title}” and all its repeats?` : `Delete “${editing.title}”?`;
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
                s.bells.forEach((b) => (b.memberIds = b.memberIds.filter((id) => id !== m.id)));
                s.feeds.forEach((f) => (f.memberIds = f.memberIds.filter((id) => id !== m.id)));
                s.notes.forEach((n) => n.memberId === m.id && (n.memberId = undefined));
                s.items.forEach((i) => i.memberId === m.id && (i.memberId = undefined));
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
          h(
            'label',
            { class: cls('swatch custom', !PALETTE.includes(m.color) && 'on'), title: 'Pick any colour' },
            h('input', { type: 'color', value: m.color, 'aria-label': 'Custom colour', onchange: (e: Event) => setColour((e.target as HTMLInputElement).value) }),
          ),
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
const voiceChk = $<HTMLInputElement>('#set-voice');
const photosChk = $<HTMLInputElement>('#set-photos');
const photoSecs = $<HTMLSelectElement>('#set-photo-secs');
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
        ? 'On: alerts when the screen turns off if something is still on today, plus reminders, timers, bells and a morning summary.'
        : 'Off.';
  }
  $<HTMLButtonElement>('#set-test').disabled = !(s.notifications && p === 'granted');
  $('#wake-status').textContent = wakeLockSupported() ? '' : 'Not supported in this browser — use the tablet’s own “screen timeout” setting instead.';
}

async function renderPhotoStatus() {
  const n = await photoCount();
  $('#photo-status').textContent = n ? `${n} photo${n === 1 ? '' : 's'} on this tablet.` : 'No photos yet — the screen saver shows a plain clock.';
  $<HTMLButtonElement>('#photo-clear').hidden = !n;
}

function renderWeatherSetting() {
  const place = S().settings.weather;
  $('#weather-current').textContent = place ? `Showing weather for ${place.name}.` : 'No location set.';
  $<HTMLButtonElement>('#weather-remove').hidden = !place;
}

function renderFeeds() {
  const s = S();
  const fmt = (t?: number) => (t ? new Date(t).toLocaleString(LOCALE, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'never');
  $('#feeds-list').replaceChildren(
    ...s.feeds.map((f) =>
      h(
        'div',
        { class: 'feed-row' },
        h('span', { class: 'dot big', style: `--c:${f.color}` }),
        h(
          'div',
          { class: 'feed-text' },
          h('b', {}, f.name),
          h('small', { class: cls(f.error && 'error') }, f.error ? `⚠ ${f.error}` : `${s.events.filter((e) => e.feedId === f.id).length} events · synced ${fmt(f.lastSync)}`),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn small',
            onclick: async (e: Event) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.disabled = true;
              b.textContent = 'Syncing…';
              try {
                const n = await syncFeed(f);
                toast([`🔗 ${f.name}: ${n} events`], 3000);
              } catch {
                /* error shown on the row */
              }
              renderFeeds();
            },
          },
          'Sync',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn icon ghost',
            'aria-label': `Remove ${f.name}`,
            onclick: async () => {
              if (!(await ask(`Unlink “${f.name}”? Its events will be removed from this tablet.`, 'Unlink'))) return;
              store.update((st) => {
                st.feeds = st.feeds.filter((x) => x.id !== f.id);
                st.events = st.events.filter((ev) => ev.feedId !== f.id);
              });
              renderFeeds();
            },
          },
          '✕',
        ),
      ),
    ),
  );
  const who = $<HTMLSelectElement>('#feed-who');
  who.replaceChildren(h('option', { value: '' }, 'Whole family'), ...s.members.map((m) => h('option', { value: m.id }, m.name)));
}

function openSettings(scrollTo?: string) {
  const s = S().settings;
  idleSel.value = String(s.idleMinutes);
  awakeChk.checked = s.keepAwake;
  voiceChk.checked = s.voice;
  photosChk.checked = s.photosInSaver;
  photoSecs.value = String(s.photoSeconds);
  summarySel.value = String(s.summaryHour);
  nightA.value = String(s.nightStart);
  nightB.value = String(s.nightEnd);
  $('#bells-count').textContent = S().bells.length ? `${S().bells.filter((b) => b.enabled).length} of ${S().bells.length} on` : 'None yet';
  renderNotifyStatus();
  renderPhotoStatus();
  renderWeatherSetting();
  renderFeeds();
  $('#backup-status').textContent = backupStatusText();
  $<HTMLSelectElement>('#set-theme').value = s.theme;
  $('#theme-status').textContent = themeStatus();
  $('#phones-status').textContent = householdKey() ? 'Phones can send events, shopping, to-dos and notes here.' : 'Not set up yet.';
  settingsDialog.showModal();
  if (scrollTo) setTimeout(() => document.getElementById(scrollTo)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
}

$('#btn-settings').addEventListener('click', () => openSettings());
$('#weather').addEventListener('click', openWeather);
$('#weather-refresh').addEventListener('click', () => refreshWeather(true).then(openWeather));

$('#set-theme').addEventListener('change', () => {
  store.update((st) => (st.settings.theme = $<HTMLSelectElement>('#set-theme').value as 'auto' | 'light' | 'dark'));
  $('#theme-status').textContent = themeStatus();
});

idleSel.addEventListener('change', () => {
  store.update((s) => (s.settings.idleMinutes = Number(idleSel.value)));
  saver.rearm();
});
awakeChk.addEventListener('change', () => {
  store.update((s) => (s.settings.keepAwake = awakeChk.checked));
  setWakeLock(awakeChk.checked);
});
voiceChk.addEventListener('change', () => store.update((s) => (s.settings.voice = voiceChk.checked)));
photosChk.addEventListener('change', () => store.update((s) => (s.settings.photosInSaver = photosChk.checked)));
photoSecs.addEventListener('change', () => store.update((s) => (s.settings.photoSeconds = Number(photoSecs.value))));
summarySel.addEventListener('change', () => store.update((s) => (s.settings.summaryHour = Number(summarySel.value))));
nightA.addEventListener('change', () => store.update((s) => (s.settings.nightStart = Number(nightA.value))));
nightB.addEventListener('change', () => store.update((s) => (s.settings.nightEnd = Number(nightB.value))));

$('#set-notify').addEventListener('click', async () => {
  const on = S().settings.notifications && permission() === 'granted';
  if (on) store.update((s) => (s.settings.notifications = false));
  else {
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

// Photos
const photoInput = $<HTMLInputElement>('#photo-input');
$('#photo-add').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', async () => {
  if (!photoInput.files?.length) return;
  $('#photo-status').textContent = 'Adding photos…';
  const n = await addPhotos(photoInput.files);
  photoInput.value = '';
  toast([`🖼️ Added ${n} photo${n === 1 ? '' : 's'}`], 3000);
  renderPhotoStatus();
  saver.reloadPhotos();
});
$('#photo-clear').addEventListener('click', async () => {
  if (!(await ask('Remove all screen-saver photos from this tablet?', 'Remove all'))) return;
  await clearPhotos();
  renderPhotoStatus();
  saver.reloadPhotos();
});

// Weather location
$('#weather-search').addEventListener('click', async () => {
  const q = $<HTMLInputElement>('#weather-query').value.trim();
  const out = $('#weather-results');
  if (!q) return;
  out.replaceChildren(h('p', { class: 'muted' }, 'Searching…'));
  try {
    const places = await searchPlaces(q);
    out.replaceChildren(
      ...(places.length
        ? places.map((p) =>
            h(
              'button',
              {
                type: 'button',
                class: 'btn small result',
                onclick: () => {
                  store.update((s) => (s.settings.weather = p));
                  out.replaceChildren();
                  renderWeatherSetting();
                  refreshWeather(true);
                },
              },
              p.name,
            ),
          )
        : [h('p', { class: 'muted' }, 'No places found.')]),
    );
  } catch {
    out.replaceChildren(h('p', { class: 'muted' }, 'Could not search right now — check the internet connection.'));
  }
});
$('#weather-query').addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && $('#weather-search').click());
$('#weather-remove').addEventListener('click', () => {
  store.update((s) => (s.settings.weather = null));
  forecast = null;
  renderWeatherSetting();
  renderWeatherChip();
});

// Linked calendars
$('#feed-add').addEventListener('click', async () => {
  const url = normaliseUrl($<HTMLInputElement>('#feed-url').value);
  const name = $<HTMLInputElement>('#feed-name').value.trim() || 'Linked calendar';
  const who = $<HTMLSelectElement>('#feed-who').value;
  if (!/^https:\/\//i.test(url)) {
    toast(['Paste the calendar’s secret iCal link (starts with https:// or webcal://).'], 5000);
    return;
  }
  const member = who ? memberById(who) : undefined;
  const feed: Feed = { id: uid(), name, url, color: member?.color ?? nextColour(), memberIds: who ? [who] : [] };
  store.update((s) => s.feeds.push(feed));
  $<HTMLInputElement>('#feed-url').value = '';
  $<HTMLInputElement>('#feed-name').value = '';
  renderFeeds();
  try {
    const n = await syncFeed(feed);
    toast([`🔗 Linked “${name}” — ${n} events`], 4000);
  } catch (err) {
    toast([`⚠ ${(err as Error).message}`], 7000);
  }
  renderFeeds();
});
const icsInput = $<HTMLInputElement>('#ics-file');
$('#ics-import').addEventListener('click', () => icsInput.click());
icsInput.addEventListener('change', async () => {
  const file = icsInput.files?.[0];
  icsInput.value = '';
  if (!file) return;
  const who = $<HTMLSelectElement>('#feed-who').value;
  const events = importIcsFile(await file.text(), who ? [who] : []);
  if (!events.length) return toast(['No upcoming events found in that file.'], 4000);
  if (!(await ask(`Add ${events.length} events from “${file.name}”?`, 'Add', false))) return;
  store.update((s) => s.events.push(...events));
  toast([`📅 Added ${events.length} events`], 3000);
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

function step(dir: 1 | -1) {
  if (S().settings.view === 'week') {
    selected = toKey(addDays(fromKey(selected), 7 * dir));
    viewMonth = startOfMonth(fromKey(selected));
  } else {
    viewMonth = addMonths(viewMonth, dir);
  }
  render();
}
$('#prev').addEventListener('click', () => step(-1));
$('#next').addEventListener('click', () => step(1));
$('#today-btn').addEventListener('click', () => {
  selected = todayKey;
  viewMonth = startOfMonth(new Date());
  render();
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#screen-nav button')) {
  b.addEventListener('click', () => {
    if (b.dataset.screen === 'week' || b.dataset.screen === 'month') {
      selected = todayKey;
      viewMonth = startOfMonth(new Date());
    }
    goTo(b.dataset.screen as Screen | 'week' | 'month');
  });
}
$('#nav-add').addEventListener('click', () => openEvent(undefined, screen === 'calendar' ? selected : todayKey));

// swipe left/right on the calendar to move month/week
{
  let x0 = 0;
  let y0 = 0;
  const area = $('#cal-area');
  area.addEventListener('touchstart', (e) => ((x0 = e.touches[0].clientX), (y0 = e.touches[0].clientY)), { passive: true });
  area.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

$('#toast').addEventListener('click', () => $('#toast').classList.remove('on'));

// When the screen comes back on, show what's on today in-app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  tick();
  render();
  refreshWeather();
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

const saver = initSaver({
  getState: S,
  colorOf,
  getForecast: () => forecast,
  // like a kiosk: after a while untouched, come back to the Today screen
  onShow: () => {
    if (screen !== 'today' && !document.querySelector('dialog[open]')) goTo('today');
  },
});
initNotifications(S, (title, body) => toast([h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, title), body)], 15000));
setWakeLock(S().settings.keepAwake);
initTimers();
initBells();
initNotes();
initFeeds(S);
initHousehold();
initBackup();
initTheme();
initCountdowns();
initBins();
$('#btn-countdowns').addEventListener('click', openCountdowns);

store.subscribe(() => render());
tick();
render();
renderWeatherChip();
refreshWeather();
setInterval(tick, 10_000);
setInterval(() => refreshWeather(), 30 * 60_000);

// expose a little for debugging from the console
Object.assign(window, { familyCalendar: { store, inkFor } });
