import type { CalEvent, State } from './types';
import { $, avatar, bellIcon, cls, h } from './dom';
import { LOCALE, addDays, endOf, eventsOn, toKey } from './dates';
import { countLabel } from './notify';

/* ------------------------------------------------------------------ *
 * Screen saver: after N idle minutes the calendar is replaced with a
 * big clock and a "things on today" banner, readable from across the
 * kitchen. It drifts slightly to avoid burn-in and dims at night.
 * ------------------------------------------------------------------ */

interface Deps {
  getState: () => State;
  colorOf: (e: CalEvent) => string;
}

export function initSaver({ getState, colorOf }: Deps) {
  const el = $('#screensaver');
  let idleTimer = 0;
  let paintTimer = 0;
  let active = false;

  const dialogOpen = () => !!document.querySelector('dialog[open]');

  function arm() {
    clearTimeout(idleTimer);
    const mins = getState().settings.idleMinutes;
    if (mins > 0) idleTimer = window.setTimeout(show, mins * 60_000);
  }

  function show() {
    if (dialogOpen()) return arm(); // don't hide a half-filled form
    active = true;
    paint();
    el.classList.add('on');
    paintTimer = window.setInterval(paint, 15_000);
  }

  function hide() {
    active = false;
    el.classList.remove('on');
    clearInterval(paintTimer);
    arm();
  }

  function isNight(hour: number) {
    const { nightStart: a, nightEnd: b } = getState().settings;
    if (a === b) return false;
    return a < b ? hour >= a && hour < b : hour >= a || hour < b;
  }

  function paint() {
    const s = getState();
    const now = new Date();
    const key = toKey(now);
    const today = eventsOn(s.events, key);
    const upcoming = today.filter((e) => endOf(e, key) > now);
    const tomorrow = eventsOn(s.events, toKey(addDays(now, 1)));

    el.classList.toggle('night', isNight(now.getHours()));

    const banner = upcoming.length
      ? h('div', { class: 'banner' }, bellIcon(), `${countLabel(upcoming.length)} today`)
      : h('div', { class: 'banner quiet' }, today.length ? 'All done for today' : 'Nothing on today');

    const shown = today.slice(0, 6);
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

    const next =
      tomorrow.length > 0 &&
      h(
        'div',
        { class: 'saver-next' },
        `Tomorrow: ${countLabel(tomorrow.length)} — first `,
        h('b', {}, tomorrow[0].allDay ? tomorrow[0].title : `${tomorrow[0].start} ${tomorrow[0].title}`),
      );

    // gentle drift so nothing sits on the same pixels all night
    const dx = Math.round((Math.random() - 0.5) * 40);
    const dy = Math.round((Math.random() - 0.5) * 30);

    el.replaceChildren(
      h(
        'div',
        { class: 'saver-inner', style: `transform:translate(${dx}px,${dy}px)` },
        h('div', { class: 'saver-time' }, now.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })),
        h('div', { class: 'saver-date' }, now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })),
        banner,
        today.length > 0 && list,
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

  arm();

  return {
    show,
    rearm: arm,
    refresh: () => active && paint(),
  };
}
