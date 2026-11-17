import { store } from './store';
import { cachedWeather } from './weather';
import { toKey } from './dates';

/* Light "warm paper" by day, warm dark after sunset (or fixed, from Settings). */

const FALLBACK = { sunrise: '07:00', sunset: '19:00' };

/** Today's sunrise/sunset from the weather forecast, or 7am / 7pm */
export function sunTimes(): { sunrise: string; sunset: string; real: boolean } {
  const f = cachedWeather(store.get().settings.weather);
  const today = f?.days.find((d) => d.date === toKey(new Date()));
  if (today?.sunrise && today.sunset) return { sunrise: today.sunrise, sunset: today.sunset, real: true };
  return { ...FALLBACK, real: false };
}

export function isDarkNow(now = new Date()): boolean {
  const mode = store.get().settings.theme;
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  const { sunrise, sunset } = sunTimes();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= sunset || hhmm < sunrise;
}

export function applyTheme() {
  const dark = isDarkNow();
  const root = document.documentElement;
  if (root.classList.contains('theme-dark') !== dark) root.classList.toggle('theme-dark', dark);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#16130F' : '#F6F1E7';
}

export function themeStatus(): string {
  const mode = store.get().settings.theme;
  if (mode !== 'auto') return '';
  const { sunrise, sunset, real } = sunTimes();
  return real
    ? `Dark from sunset (${sunset}) until sunrise (${sunrise}) — times from your weather location.`
    : `Dark from ${sunset} until ${sunrise}. Set a weather location to follow the real sunset.`;
}

export function initTheme() {
  applyTheme();
  store.subscribe(applyTheme);
  setInterval(applyTheme, 30_000);
  document.addEventListener('visibilitychange', applyTheme);
}
