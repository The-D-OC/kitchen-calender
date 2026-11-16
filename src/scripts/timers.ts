import type { Timer } from './types';
import { store, uid } from './store';
import { $, cls, h } from './dom';
import { play, speak } from './sound';
import { ask, showAlert } from './ui';
import { notify } from './notify';

/* Kitchen timers: several at once, survive a page reload, ring until stopped. */

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return hrs ? `${hrs}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const ringing = new Map<string, number>();
const acknowledged = new Set<string>();

export function startTimer(minutes: number, label?: string) {
  const ms = Math.round(minutes * 60_000);
  if (ms <= 0) return;
  const name = label?.trim() || (minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour timer` : `${minutes} min timer`);
  store.update((s) => s.timers.push({ id: uid(), label: name, durationMs: ms, endsAt: Date.now() + ms }));
}

function stopRinging(id: string) {
  clearInterval(ringing.get(id));
  ringing.delete(id);
  acknowledged.add(id);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function cancelTimer(id: string) {
  stopRinging(id);
  acknowledged.delete(id);
  store.update((s) => {
    s.timers = s.timers.filter((t) => t.id !== id);
  });
}

function addMinute(id: string) {
  acknowledged.delete(id);
  store.update((s) => {
    const t = s.timers.find((x) => x.id === id);
    if (t) {
      t.endsAt = Math.max(t.endsAt, Date.now()) + 60_000;
      t.durationMs += 60_000;
    }
  });
}

function ring(t: Timer) {
  if (ringing.has(t.id) || acknowledged.has(t.id)) return;
  const s = store.get().settings;
  play('alarm');
  if (s.voice) setTimeout(() => speak(`${t.label} is done`), 900);
  ringing.set(
    t.id,
    window.setInterval(() => play('alarm'), 1600),
  );
  if (s.notifications) notify(`⏰ ${t.label}`, 'Time’s up!', `timer-${t.id}`);
  showAlert({
    title: t.label,
    subtitle: 'Time’s up!',
    actions: [
      { label: '+1 min', onClick: () => addMinute(t.id) },
      { label: 'Stop', primary: true, onClick: () => cancelTimer(t.id) },
    ],
    onClose: () => stopRinging(t.id),
  });
}

function renderBar() {
  const bar = $('#timers');
  const now = Date.now();
  const timers = [...store.get().timers].sort((a, b) => a.endsAt - b.endsAt);
  // make room in the header: family chips shrink to avatars while timers run
  bar.closest('.top')?.classList.toggle('has-timers', timers.length > 0);
  bar.replaceChildren(
    ...timers.map((t) => {
      const left = t.endsAt - now;
      const pct = Math.min(100, Math.max(0, 100 - (left / t.durationMs) * 100));
      return h(
        'button',
        {
          type: 'button',
          class: cls('timer-pill', left <= 0 && 'done'),
          style: `--p:${pct}%`,
          title: 'Tap to stop',
          onclick: async () => {
            if (left <= 0 || (await ask(`Stop the “${t.label}” timer?`, 'Stop timer'))) cancelTimer(t.id);
          },
        },
        h('span', { class: 'timer-time' }, left <= 0 ? 'Done' : fmtLeft(left)),
        h('span', { class: 'timer-label' }, t.label),
      );
    }),
  );
}

function tick() {
  const now = Date.now();
  for (const t of store.get().timers) {
    if (t.endsAt <= now) {
      // Finished long ago (tablet was off / page reloaded much later): just clear it
      if (now - t.endsAt > 30 * 60_000) cancelTimer(t.id);
      else ring(t);
    }
  }
  renderBar();
}

export function initTimers() {
  const dlg = $<HTMLDialogElement>('#timer-dialog');
  const label = $<HTMLInputElement>('#timer-label');
  const custom = $<HTMLInputElement>('#timer-custom');

  const presets = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90];
  $('#timer-presets').replaceChildren(
    ...presets.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: 'btn preset',
          onclick: () => {
            startTimer(m, label.value);
            dlg.close();
          },
        },
        m >= 60 ? `${m / 60 === 1 ? '1 h' : `${m / 60} h`}` : `${m} min`,
      ),
    ),
  );
  $('#timer-start').addEventListener('click', () => {
    const mins = parseFloat(custom.value);
    if (!mins || mins <= 0) {
      custom.focus();
      return;
    }
    startTimer(mins, label.value);
    dlg.close();
  });
  $('#btn-timer').addEventListener('click', () => {
    label.value = '';
    custom.value = '';
    dlg.showModal();
  });

  store.subscribe(renderBar);
  tick();
  setInterval(tick, 1000);
}
