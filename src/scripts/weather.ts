import type { Place } from './types';

// Open-Meteo: free, no API key, CORS-enabled. https://open-meteo.com

export interface DayForecast {
  date: string;
  code: number;
  max: number;
  min: number;
  rain: number;
}
export interface Forecast {
  fetchedAt: number;
  place: string;
  temp: number;
  code: number;
  days: DayForecast[];
}

const CACHE_KEY = 'family-calendar:weather';
const MAX_AGE = 30 * 60_000;

export function cachedWeather(place: Place | null): Forecast | null {
  if (!place) return null;
  try {
    const f = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as Forecast | null;
    return f && f.place === place.name ? f : null;
  } catch {
    return null;
  }
}

export async function fetchWeather(place: Place, force = false): Promise<Forecast> {
  const cached = cachedWeather(place);
  if (!force && cached && Date.now() - cached.fetchedAt < MAX_AGE) return cached;
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Weather service replied ${res.status}`);
  const j = await res.json();
  const f: Forecast = {
    fetchedAt: Date.now(),
    place: place.name,
    temp: Math.round(j.current.temperature_2m),
    code: j.current.weather_code,
    days: (j.daily.time as string[]).map((date, i) => ({
      date,
      code: j.daily.weather_code[i],
      max: Math.round(j.daily.temperature_2m_max[i]),
      min: Math.round(j.daily.temperature_2m_min[i]),
      rain: j.daily.precipitation_probability_max?.[i] ?? 0,
    })),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(f));
  return f;
}

export async function searchPlaces(name: string): Promise<Place[]> {
  const q = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!res.ok) throw new Error(`Place search replied ${res.status}`);
  const j = await res.json();
  return ((j.results ?? []) as { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[]).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** WMO weather code → emoji + words */
export function describeWeather(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if (code <= 48) return { icon: '🌫️', label: 'Fog' };
  if (code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if (code <= 67) return { icon: '🌧️', label: 'Rain' };
  if (code <= 77) return { icon: '🌨️', label: 'Snow' };
  if (code <= 82) return { icon: '🌧️', label: 'Showers' };
  if (code <= 86) return { icon: '🌨️', label: 'Snow showers' };
  return { icon: '⛈️', label: 'Thunderstorms' };
}
