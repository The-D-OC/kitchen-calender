// Keeps the tablet screen from switching off while the page is visible.
// Browsers drop the lock whenever the page is hidden, so we re-request on return.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export const wakeLockSupported = () => 'wakeLock' in navigator;

async function acquire() {
  if (!wanted || sentinel || !wakeLockSupported() || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Denied (e.g. low battery, not HTTPS). Try again on the next touch.
  }
}

export async function setWakeLock(on: boolean) {
  wanted = on;
  if (on) await acquire();
  else {
    await sentinel?.release().catch(() => {});
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', acquire);
// Some browsers only grant the lock after a user gesture
window.addEventListener('pointerdown', acquire, { passive: true });
