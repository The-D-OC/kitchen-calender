import { freshInstall, store } from './store';
import { $ } from './dom';
import { LOCALE } from './dates';
import { ask, toast } from './ui';
import { qrSvg } from './qr';
import { KEY_RE, ensureHouseholdKey, householdKey, onKeyChange, setHouseholdKey } from './household';

/* ------------------------------------------------------------------ *
 * Automatic cloud backup.
 *
 * Everything is already saved on the tablet straight away (refresh or
 * closing the app is safe). This also keeps a copy in the household's
 * private storage on Cloudflare, so a wiped or replaced tablet can get
 * everything back with the recovery link. Photos stay on the tablet.
 * ------------------------------------------------------------------ */

const LAST_KEY = 'family-calendar:last-backup';
const SAVE_DELAY = 4000;
const KEEPALIVE_LIMIT = 60_000; // browsers cap "send while closing" requests at 64 KB

export const recoveryLink = (key: string) => `${location.origin}/#restore=${key}`;

let timer = 0;
let dirty = false;
let saving = false;
let lastError = '';

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const lastSaved = () => Number(localStorage.getItem(LAST_KEY) || 0);

function snapshot(): string {
  return JSON.stringify(store.get());
}

async function save(opts: { keepalive?: boolean } = {}): Promise<boolean> {
  const key = householdKey();
  if (!key || saving) return false;
  saving = true;
  dirty = false;
  const body = snapshot();
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-household-key': key },
      body,
      keepalive: !!opts.keepalive && body.length < KEEPALIVE_LIMIT,
    });
    if (!res.ok) throw new Error(res.status === 404 ? 'Backup works once the site is deployed to Cloudflare.' : (await res.text()).slice(0, 160));
    localStorage.setItem(LAST_KEY, String(Date.now()));
    lastError = '';
    return true;
  } catch (err) {
    dirty = true;
    lastError = navigator.onLine ? (err as Error).message : 'Offline — will back up when the internet is back.';
    return false;
  } finally {
    saving = false;
    renderStatus();
  }
}

function schedule() {
  dirty = true;
  clearTimeout(timer);
  timer = window.setTimeout(() => save(), SAVE_DELAY);
}

export function backupStatusText(): string {
  const t = lastSaved();
  if (lastError && dirty) return `⚠ Not backed up: ${lastError}`;
  if (!t) return 'Not backed up yet.';
  const mins = Math.round((Date.now() - t) / 60_000);
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : new Date(t).toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `☁️ Backed up automatically · last saved ${when}`;
}

function renderStatus() {
  const el = document.getElementById('backup-status');
  if (el) el.textContent = backupStatusText();
}

/* ---------- restore ---------- */

async function fetchBackup(key: string): Promise<{ text: string; savedAt: number } | null> {
  const res = await fetch('/api/state', { headers: { 'x-household-key': key }, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.text()).slice(0, 160) || `Error ${res.status}`);
  return { text: await res.text(), savedAt: Number(res.headers.get('x-saved-at') || 0) };
}

/** Restore from a recovery link or code. Returns true if restored. */
export async function restoreFrom(input: string): Promise<boolean> {
  const m = /(?:restore=|k=)?([A-Za-z0-9_-]{32,64})\s*$/.exec(input.trim());
  const key = m?.[1];
  if (!key || !KEY_RE.test(key)) {
    toast(['That doesn’t look like a recovery link.'], 5000);
    return false;
  }
  let backup;
  try {
    backup = await fetchBackup(key);
  } catch (err) {
    toast([`Couldn’t reach the backup: ${(err as Error).message}`], 7000);
    return false;
  }
  if (!backup) {
    toast(['No backup found for that link.'], 6000);
    return false;
  }
  let next;
  try {
    next = store.parseBackup(backup.text);
  } catch {
    toast(['That backup couldn’t be read.'], 6000);
    return false;
  }
  const when = backup.savedAt ? new Date(backup.savedAt).toLocaleString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'earlier';
  const ok = await ask(
    `Restore the backup from ${when}? It has ${n(next.members.length, 'person', 'people')}, ${n(next.events.filter((e) => !e.feedId).length, 'event')}, ${n(next.items.length, 'list item')} and ${n(next.notes.length, 'note')}. This replaces what’s on this tablet.`,
    'Restore',
    false,
  );
  if (!ok) return false;
  setHouseholdKey(key); // keep the same key so paired phones keep working
  store.replace(next);
  localStorage.setItem(LAST_KEY, String(backup.savedAt || Date.now()));
  toast(['✅ Everything’s back. Paired phones still work.'], 5000);
  renderStatus();
  return true;
}

/* ---------- recovery link dialog ---------- */

function showRecovery() {
  const key = ensureHouseholdKey();
  const link = recoveryLink(key);
  $('#recovery-qr').replaceChildren(qrSvg(link));
  $('#recovery-link').textContent = link;
  $<HTMLDialogElement>('#recovery-dialog').showModal();
  save();
}

/* ---------- start ---------- */

export function initBackup() {
  // 1. Opened with a recovery link (…/#restore=KEY)?
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('restore');
  if (fromHash) {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => restoreFrom(fromHash), 600);
  } else if (freshInstall && !householdKey()) {
    // 2. Brand-new (or wiped) tablet: offer to restore before starting fresh
    setTimeout(() => $<HTMLDialogElement>('#welcome-dialog').showModal(), 600);
  }

  ensureHouseholdKey();
  store.subscribe(schedule);
  onKeyChange.push(() => save());

  // Save straight away if the app is being hidden/closed with unsaved changes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) save({ keepalive: true });
  });
  window.addEventListener('pagehide', () => dirty && save({ keepalive: true }));
  window.addEventListener('online', () => dirty && save());
  // First backup, and a safety-net save every 15 minutes if something failed
  setTimeout(() => {
    if (!lastSaved() || Date.now() - lastSaved() > 6 * 3_600_000) save();
  }, 3000);
  setInterval(() => dirty && save(), 15 * 60_000);

  $('#backup-now').addEventListener('click', async () => {
    const ok = await save();
    toast([ok ? '☁️ Backed up.' : `⚠ ${lastError}`], 4000);
  });
  $('#btn-recovery').addEventListener('click', showRecovery);
  $('#recovery-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(recoveryLink(ensureHouseholdKey()));
      toast(['Recovery link copied.'], 3000);
    } catch {
      toast(['Couldn’t copy — take a photo of the QR code instead.'], 4000);
    }
  });

  // Welcome dialog on a fresh tablet
  $('#welcome-fresh').addEventListener('click', () => $<HTMLDialogElement>('#welcome-dialog').close());
  $('#welcome-restore').addEventListener('click', async () => {
    const ok = await restoreFrom($<HTMLInputElement>('#welcome-link').value);
    if (ok) $<HTMLDialogElement>('#welcome-dialog').close();
  });
  $('#settings-restore').addEventListener('click', async () => {
    const link = $<HTMLInputElement>('#restore-link');
    if (await restoreFrom(link.value)) link.value = '';
  });

  renderStatus();
  setInterval(renderStatus, 60_000);
}

