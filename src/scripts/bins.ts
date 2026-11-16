import type { Bin } from './types';
import { store, uid } from './store';
import { $, cls, h } from './dom';
import { LOCALE, addDays, daysBetween, fromKey, startOfWeek, toKey } from './dates';
import { ask, showAlert } from './ui';
import { play, speak } from './sound';
import { markFired, notify, readFired } from './notify';

/* ------------------------------------------------------------------ *
 * Bin days: coloured bin icons on collection days, a "bins out
 * tonight" notice, and an evening-before (or same-morning) reminder.
 * ------------------------------------------------------------------ */

export const BIN_COLOURS: { color: string; label: string }[] = [
  { color: '#2b2d31', label: 'Black' },
  { color: '#8a8f98', label: 'Grey' },
  { color: '#2f6fd6', label: 'Blue' },
  { color: '#2e9d4f', label: 'Green' },
  { color: '#8b5a2b', label: 'Brown' },
  { color: '#7d4fb3', label: 'Purple' },
  { color: '#d64545', label: 'Red' },
  { color: '#e8c547', label: 'Yellow' },
];
const colourName = (c: string) => BIN_COLOURS.find((x) => x.color.toLowerCase() === c.toLowerCase())?.label.toLowerCase() ?? '';

const PRESETS: { name: string; color: string }[] = [
  { name: 'General waste', color: '#2b2d31' },
  { name: 'Recycling', color: '#2f6fd6' },
  { name: 'Garden waste', color: '#2e9d4f' },
  { name: 'Food waste', color: '#8b5a2b' },
  { name: 'Glass', color: '#7d4fb3' },
];

/** Does this bin get collected on this day? (works backwards from the known date too) */
export function binOn(b: Bin, key: string): boolean {
  const period = 7 * Math.max(1, b.everyWeeks);
  const diff = daysBetween(b.date, key);
  return ((diff % period) + period) % period === 0;
}
export const binsOn = (key: string) => store.get().bins.filter((b) => binOn(b, key));

/** Next collection on/after a day */
export function nextCollection(b: Bin, from = toKey(new Date())): string {
  for (let i = 0; i < 7 * Math.max(1, b.everyWeeks); i++) {
    const k = toKey(addDays(fromKey(from), i));
    if (binOn(b, k)) return k;
  }
  return from;
}

const SVG = 'http://www.w3.org/2000/svg';
/** A little wheelie bin in the bin's colour */
export function binIcon(color: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'bin-icon');
  svg.setAttribute('aria-hidden', 'true');
  const outline = colourName(color) === 'black' ? '#9ba1ad' : 'rgba(0,0,0,.35)';
  const parts: [string, Record<string, string>][] = [
    ['rect', { x: '3', y: '3', width: '18', height: '3.2', rx: '1', fill: color, stroke: outline, 'stroke-width': '1' }],
    ['path', { d: 'M4.5 7h15l-1.6 12.2a1.5 1.5 0 0 1-1.5 1.3H7.6a1.5 1.5 0 0 1-1.5-1.3z', fill: color, stroke: outline, 'stroke-width': '1' }],
    ['path', { d: 'M9 10v7M12 10v7M15 10v7', stroke: 'rgba(255,255,255,.35)', 'stroke-width': '1.2', 'stroke-linecap': 'round' }],
    ['circle', { cx: '7.5', cy: '21.2', r: '1.6', fill: '#1b1d22', stroke: outline, 'stroke-width': '.8' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** "Recycling (blue)" */
export const binLabel = (b: Bin) => `${b.name}${colourName(b.color) ? ` (${colourName(b.color)})` : ''}`;

/** What should the kitchen be nagging about right now? */
export function binNotice(now = new Date()): { when: 'tonight' | 'today'; bins: Bin[] } | null {
  const today = toKey(now);
  const tomorrow = toKey(addDays(now, 1));
  const hour = now.getHours();
  const todays = binsOn(today);
  if (todays.length && hour < 12) return { when: 'today', bins: todays };
  const tomorrows = binsOn(tomorrow);
  if (tomorrows.length && hour >= 15) return { when: 'tonight', bins: tomorrows };
  return null;
}

export function binNoticeEl(compact = false) {
  const n = binNotice();
  if (!n) return null;
  const names = n.bins.map((b) => b.name).join(' + ');
  return h(
    'button',
    { type: 'button', class: cls('bin-notice', compact && 'compact'), onclick: () => openBins() },
    h('span', { class: 'bin-icons' }, ...n.bins.map((b) => binIcon(b.color, compact ? 30 : 26))),
    h('span', {}, h('b', {}, n.when === 'tonight' ? 'Bins out tonight' : 'Bin day today'), h('small', {}, names)),
  );
}

/* ---------- reminder ---------- */

function check() {
  const s = store.get();
  const t = s.settings.binRemindTime;
  if (!t || !s.bins.length) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < t) return;
  const day = s.settings.binRemindWhen === 'before' ? toKey(addDays(now, 1)) : toKey(now);
  const due = binsOn(day);
  if (!due.length) return;
  const id = `bins|${day}`;
  if (id in readFired()) return;
  // Only fire within 2 hours of the set time, so opening the app late at night doesn't nag
  const [h0, m0] = t.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() - (h0 * 60 + m0) > 120) return;
  markFired(id);
  const names = due.map(binLabel).join(' and ');
  const title = s.settings.binRemindWhen === 'before' ? 'Bins out tonight' : 'Bin day today';
  play('bell');
  if (s.settings.voice) setTimeout(() => speak(`${title}: ${names}`), 2200);
  if (s.settings.notifications) notify(`🗑️ ${title}`, names, 'bins');
  showAlert({ title, subtitle: names, color: due[0].color === '#2b2d31' ? '#8a8f98' : due[0].color, actions: [{ label: 'Done', primary: true }] });
}

/* ---------- dialog ---------- */

function renderBins() {
  const s = store.get();
  const list = $('#bins-list');
  list.replaceChildren(
    ...s.bins.map((b) => {
      const next = nextCollection(b);
      const update = (fn: (x: Bin) => void) =>
        store.update((st) => {
          const x = st.bins.find((y) => y.id === b.id);
          if (x) fn(x);
        });
      return h(
        'div',
        { class: 'bin-row' },
        h('div', { class: 'bin-row-head' }, binIcon(b.color, 40), h('input', {
          class: 'input',
          value: b.name,
          maxlength: '30',
          'aria-label': 'Bin name',
          onchange: (e: Event) => update((x) => (x.name = (e.target as HTMLInputElement).value.trim() || 'Bin')),
        }), h(
          'button',
          {
            type: 'button',
            class: 'btn icon ghost',
            'aria-label': `Remove ${b.name}`,
            onclick: async () => {
              if (!(await ask(`Remove the ${b.name} bin?`, 'Remove'))) return;
              store.update((st) => {
                st.bins = st.bins.filter((x) => x.id !== b.id);
              });
              renderBins();
            },
          },
          '✕',
        )),
        h(
          'div',
          { class: 'swatches' },
          ...BIN_COLOURS.map((c) =>
            h('button', {
              type: 'button',
              class: cls('swatch', c.color === b.color && 'on'),
              style: `--c:${c.color}`,
              title: c.label,
              'aria-label': c.label,
              onclick: () => {
                update((x) => (x.color = c.color));
                renderBins();
              },
            }),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'label',
            { class: 'field' },
            h('span', {}, 'A collection day'),
            h('input', {
              type: 'date',
              value: b.date,
              onchange: (e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) update((x) => (x.date = v));
                renderBins();
              },
            }),
          ),
          h(
            'label',
            { class: 'field' },
            h('span', {}, 'Collected'),
            (() => {
              const sel = h(
                'select',
                {
                  onchange: (e: Event) => {
                    update((x) => (x.everyWeeks = Number((e.target as HTMLSelectElement).value)));
                    renderBins();
                  },
                },
                ...[
                  [1, 'Every week'],
                  [2, 'Every 2 weeks'],
                  [3, 'Every 3 weeks'],
                  [4, 'Every 4 weeks'],
                ].map(([v, l]) => h('option', { value: String(v) }, String(l))),
              );
              sel.value = String(b.everyWeeks);
              return sel;
            })(),
          ),
        ),
        h(
          'small',
          { class: 'muted' },
          `Next: ${fromKey(next).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' })}`,
        ),
      );
    }),
  );
  if (!s.bins.length) list.append(h('p', { class: 'muted small' }, 'Add your bins below. Pick any date one of them was (or will be) collected, and how often.'));
  $('#bin-presets').replaceChildren(
    ...PRESETS.filter((p) => !s.bins.some((b) => b.name === p.name)).map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            // Default: next occurrence of the same weekday as the other bins, or next Monday
            const other = store.get().bins[0];
            const date = other ? nextCollection(other) : toKey(addDays(startOfWeek(new Date()), 7));
            store.update((st) => st.bins.push({ id: uid(), name: p.name, color: p.color, date, everyWeeks: 2 }));
            renderBins();
          },
        },
        binIcon(p.color, 20),
        ` ${p.name}`,
      ),
    ),
  );
  const when = $<HTMLSelectElement>('#bin-remind');
  when.value = s.settings.binRemindTime ? `${s.settings.binRemindWhen}|${s.settings.binRemindTime}` : '';
}

export function openBins() {
  renderBins();
  $<HTMLDialogElement>('#bins-dialog').showModal();
}

export function initBins() {
  const when = $<HTMLSelectElement>('#bin-remind');
  const opts: [string, string][] = [
    ['', 'No reminder'],
    ...['17:00', '18:00', '19:00', '20:00', '21:00'].map((t): [string, string] => [`before|${t}`, `Evening before, ${t}`]),
    ...['06:30', '07:00', '07:30'].map((t): [string, string] => [`same|${t}`, `Same morning, ${t}`]),
  ];
  when.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
  when.addEventListener('change', () =>
    store.update((s) => {
      const [w, t] = when.value.split('|');
      s.settings.binRemindWhen = (w as 'before' | 'same') || 'before';
      s.settings.binRemindTime = t ?? '';
    }),
  );
  $('#btn-bins').addEventListener('click', openBins);
  check();
  setInterval(check, 20_000);
}
