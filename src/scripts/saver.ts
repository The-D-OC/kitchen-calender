import type { CalEvent, State } from './types';
import { $, avatar, bellIcon, cls, h } from './dom';
import { LOCALE, addDays, endOf, eventsOn, toKey } from './dates';
import { countLabel } from './notify';
import { describeWeather, type Forecast } from './weather';
import { listPhotos } from './photos';
import { fmtLeft } from './timers';

/* ------------------------------------------------------------------ *
 * Screen saver / ambient mode: after N idle minutes the calendar is
 * replaced with a big clock, a "things on today" banner, weather,
 * family notes and running timers — over a slideshow of family photos
 * if any have been added. Drifts to avoid burn-in and dims at night.
 * ------------------------------------------------------------------ */

interface Deps {
  getState: () => State;
  colorOf: (e: CalEvent) => string;
  getForecast: () => Forecast | null;
}

export function initSaver({ getState, colorOf, getForecast }: Deps) {
  const el = $('#screensaver');
  const bgA = h('div', { class: 'saver-bg' });
  const bgB = h('div', { class: 'saver-bg' });
  const content = h('div', { class: 'saver-content' });
  el.replaceChildren(bgA, bgB, h('div', { class: 'saver-scrim' }), content);

  let idleTimer = 0;
  let paintTimer = 0;
  let photoTimer = 0;
  let active = false;
  let photos: string[] = [];
  let photoIdx = -1;
  let front = bgA;

  const dialogOpen = () => !!document.querySelector('dialog[open]');

  async function reloadPhotos() {
    photos.forEach((u) => URL.revokeObjectURL(u));
    const list = await listPhotos();
    photos = list.map((p) => URL.createObjectURL(p.blob));
    // shuffle so it isn't always the same order
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }
    photoIdx = -1;
  }

  function arm() {
    clearTimeout(idleTimer);
    const mins = getState().settings.idleMinutes;
    if (mins > 0) idleTimer = window.setTimeout(show, mins * 60_000);
  }

  function nextPhoto() {
    const s = getState().settings;
    const usePhotos = s.photosInSaver && photos.length > 0 && !isNight(new Date().getHours());
    el.classList.toggle('has-photo', usePhotos);
    if (!usePhotos) return;
    photoIdx = (photoIdx + 1) % photos.length;
    const back = front === bgA ? bgB : bgA;
    back.style.backgroundImage = `url("${photos[photoIdx]}")`;
    back.classList.add('on');
    front.classList.remove('on');
    front = back;
  }

  function show() {
    if (dialogOpen()) return arm(); // don't hide a half-filled form
    active = true;
    paint();
    nextPhoto();
    el.classList.add('on');
    paintTimer = window.setInterval(paint, 1000);
    photoTimer = window.setInterval(nextPhoto, Math.max(10, getState().settings.photoSeconds) * 1000);
  }

  function hide() {
    active = false;
    el.classList.remove('on');
    clearInterval(paintTimer);
    clearInterval(photoTimer);
    arm();
  }

  function isNight(hour: number) {
    const { nightStart: a, nightEnd: b } = getState().settings;
    if (a === b) return false;
    return a < b ? hour >= a && hour < b : hour >= a || hour < b;
  }

  let lastDrift = 0;
  let drift = 'translate(0,0)';
  let lastMinute = '';

  function paint() {
    const s = getState();
    const now = new Date();
    const key = toKey(now);
    const minute = `${now.getHours()}:${now.getMinutes()}`;

    // Timers change every second; everything else only needs a minute-by-minute repaint
    const timersEl = h(
      'div',
      { class: 'saver-timers' },
      ...s.timers.map((t) => {
        const left = t.endsAt - Date.now();
        return h('div', { class: cls('saver-timer', left <= 0 && 'done') }, '⏱ ', h('b', {}, left <= 0 ? 'Done' : fmtLeft(left)), ` ${t.label}`);
      }),
    );
    const existing = content.querySelector('.saver-timers');
    if (minute === lastMinute && existing) {
      existing.replaceWith(timersEl);
      return;
    }
    lastMinute = minute;

    const today = eventsOn(s.events, key);
    const upcoming = today.filter((e) => endOf(e, key) > now);
    const tomorrow = eventsOn(s.events, toKey(addDays(now, 1)));
    el.classList.toggle('night', isNight(now.getHours()));

    const banner = upcoming.length
      ? h('div', { class: 'banner' }, bellIcon(), `${countLabel(upcoming.length)} today`)
      : h('div', { class: 'banner quiet' }, today.length ? 'All done for today' : 'Nothing on today');

    const shown = today.slice(0, s.notes.length || s.timers.length ? 4 : 5);
    const list = h(
      'ul',
      { class: 'saver-list' },
      ...shown.map((e) =>
        h(
          'li',
          { class: cls(endOf(e, key) <= now && 'past'), style: `--c:${colorOf(e)}` },
          h('span', { class: 't' }, e.allDay ? 'All day' : (e.start ?? '')),
          h('span', { class: 'x' }, e.title),
          h(
            'span',
            { class: 'who' },
            ...e.memberIds
              .map((id) => s.members.find((m) => m.id === id))
              .filter((m) => !!m)
              .map((m) => avatar(m, 34)),
          ),
        ),
      ),
      today.length > shown.length && h('li', { class: 'more-row' }, `…and ${today.length - shown.length} more`),
    );

    const f = getForecast();
    const weather =
      f &&
      h(
        'div',
        { class: 'saver-weather' },
        h('span', { class: 'w-icon' }, describeWeather(f.code).icon),
        h('b', {}, `${f.temp}°`),
        f.days[0] ? ` ${describeWeather(f.days[0].code).label} · ${f.days[0].max}° / ${f.days[0].min}°` : '',
        f.days[0]?.rain >= 40 ? ` · 💧 ${f.days[0].rain}%` : '',
      );

    const notes = [...s.notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    const notesEl =
      notes.length > 0 &&
      h(
        'div',
        { class: 'saver-notes' },
        ...notes.map((n) => {
          const m = s.members.find((x) => x.id === n.memberId);
          return h('div', { class: 'saver-note', style: `--n:${n.color}` }, m ? avatar(m, 24) : null, h('span', {}, n.text));
        }),
      );

    const next =
      tomorrow.length > 0 &&
      h(
        'div',
        { class: 'saver-next' },
        `Tomorrow: ${countLabel(tomorrow.length)} — first `,
        h('b', {}, tomorrow[0].allDay ? tomorrow[0].title : `${tomorrow[0].start} ${tomorrow[0].title}`),
      );

    // gentle drift every couple of minutes so nothing sits on the same pixels all night
    if (Date.now() - lastDrift > 120_000) {
      lastDrift = Date.now();
      drift = `translate(${Math.round((Math.random() - 0.5) * 40)}px,${Math.round((Math.random() - 0.5) * 30)}px)`;
    }

    content.replaceChildren(
      h(
        'div',
        { class: 'saver-inner', style: `transform:${drift}` },
        h('div', { class: 'saver-time' }, now.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })),
        h('div', { class: 'saver-date' }, now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })),
        weather,
        banner,
        today.length > 0 && list,
        timersEl,
        notesEl,
        next,
        h('div', { class: 'saver-hint' }, 'Tap anywhere to open the calendar'),
      ),
    );
  }

  // Any touch resets the idle countdown
  const poke = () => {
    if (!active) arm();
  };
  window.addEventListener('pointerdown', poke, { capture: true, passive: true });
  window.addEventListener('keydown', poke, { capture: true });
  el.addEventListener('click', hide);

  reloadPhotos();
  arm();

  return {
    show,
    rearm: arm,
    refresh: () => {
      if (active) {
        lastMinute = '';
        paint();
      }
    },
    reloadPhotos,
  };
}
