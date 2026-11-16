// Cloudflare Worker: serves the static site plus a few small API routes.
//
//   GET  /api/ics?url=…            fetch a Google/iCloud/Outlook calendar feed (CORS workaround)
//
//   Phone → tablet "inbox" (header  X-Household-Key: <secret from the tablet's QR code>)
//   POST /api/inbox                phone sends an event / list item / note
//   GET  /api/inbox                tablet collects waiting messages
//   POST /api/inbox/ack            tablet confirms it saved them   { keys: [...] }
//   GET  /api/profile              phone reads family names + colours
//   PUT  /api/profile              tablet publishes family names + colours
//   PUT  /api/state                tablet backs up its whole calendar (automatic)
//   GET  /api/state                restore that backup onto a new/wiped tablet
//
// Each household gets its own Durable Object, named by a SHA-256 hash of its
// secret key, so the key itself is never stored and households can't see each other.

import { KEY_PATTERN, cleanMessage, cleanProfile } from '../src/scripts/inbox-types';

/* Minimal types so this file needs no extra type packages */
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T>(opts: { prefix: string; limit?: number }): Promise<Map<string, T>>;
}
interface DOState {
  storage: DOStorage;
}
interface DOStub {
  fetch(request: Request): Promise<Response>;
}
interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DOStub;
}
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HOUSEHOLD: DONamespace;
}

const MAX_BYTES = 5_000_000;
const MAX_QUEUED = 200;
const MAX_BODY = 4_000;
const MAX_STATE = 3_000_000; // whole-calendar backup (photos are not included)
const CHUNK = 100_000; // stored in pieces to stay well under per-value limits

const reply = (body: string, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': type, 'cache-control': 'no-store' } });
const json = (data: unknown, status = 200) => reply(JSON.stringify(data), status, 'application/json');

/* ------------------------- calendar feed proxy ------------------------- */

function isPrivateHost(host: string) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.)/i.test(host) || host.endsWith('.local');
}

async function proxyCalendar(requestUrl: URL): Promise<Response> {
  const raw = (requestUrl.searchParams.get('url') ?? '').trim().replace(/^webcal:\/\//i, 'https://');
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return reply('Missing or invalid calendar link.', 400);
  }
  if (target.protocol !== 'https:') return reply('Only https:// or webcal:// calendar links are supported.', 400);
  if (isPrivateHost(target.hostname)) return reply('That address is not allowed.', 400);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { 'user-agent': 'KitchenCalendar/1.0', accept: 'text/calendar, */*' },
      redirect: 'follow',
      // Cache at Cloudflare's edge for 5 minutes so several tablets don't hammer the provider
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
  } catch {
    return reply('Could not reach the calendar server.', 502);
  }
  if (!upstream.ok) return reply(`The calendar server replied ${upstream.status}. Check the link is the secret iCal address.`, 502);
  if (Number(upstream.headers.get('content-length') ?? 0) > MAX_BYTES) return reply('That calendar is too large.', 413);

  const body = await upstream.text();
  if (body.length > MAX_BYTES) return reply('That calendar is too large.', 413);
  if (!body.trimStart().startsWith('BEGIN:VCALENDAR')) return reply('That link did not return a calendar (.ics).', 422);
  return reply(body, 200, 'text/calendar; charset=utf-8');
}

/* --------------------------- household inbox --------------------------- */

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  return JSON.parse(text);
}

/** One per household. Holds waiting messages and the family profile. */
export class Household {
  constructor(
    private state: DOState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const storage = this.state.storage;

    if (pathname === '/inbox' && request.method === 'POST') {
      let msg;
      try {
        msg = cleanMessage(await readJson(request));
      } catch {
        return reply('Bad request', 400);
      }
      if (!msg) return reply('That message is missing something (a title and date for events).', 400);
      const waiting = await storage.list({ prefix: 'm:', limit: MAX_QUEUED + 1 });
      if (waiting.size >= MAX_QUEUED) return reply('The kitchen calendar has lots of messages waiting — is it switched on?', 429);
      const key = `m:${String(Date.now()).padStart(15, '0')}:${crypto.randomUUID().slice(0, 8)}`;
      await storage.put(key, msg);
      return json({ ok: true, key }, 201);
    }

    if (pathname === '/inbox' && request.method === 'GET') {
      const waiting = await storage.list({ prefix: 'm:', limit: 100 });
      return json({ messages: [...waiting].map(([key, msg]) => ({ key, msg })) });
    }

    if (pathname === '/inbox/ack' && request.method === 'POST') {
      try {
        const { keys } = (await readJson(request)) as { keys?: unknown };
        const valid = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string' && k.startsWith('m:')).slice(0, 128) : [];
        if (valid.length) await storage.delete(valid);
        return json({ ok: true, deleted: valid.length });
      } catch {
        return reply('Bad request', 400);
      }
    }

    if (pathname === '/profile' && request.method === 'GET') {
      return json((await storage.get('profile')) ?? { members: [], updatedAt: 0 });
    }

    if (pathname === '/profile' && request.method === 'PUT') {
      let profile;
      try {
        profile = cleanProfile(await readJson(request));
      } catch {
        return reply('Bad request', 400);
      }
      if (!profile) return reply('Bad request', 400);
      await storage.put('profile', profile);
      return json({ ok: true });
    }

    if (pathname === '/state' && request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_STATE) return reply('Backup too large', 413);
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data?.members) || !Array.isArray(data?.events)) throw new Error();
      } catch {
        return reply('That is not a calendar backup', 400);
      }
      const old = (await storage.get<{ chunks: number }>('state:meta'))?.chunks ?? 0;
      const chunks = Math.max(1, Math.ceil(text.length / CHUNK));
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < chunks; i++) entries[`state:c:${String(i).padStart(3, '0')}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      const savedAt = Date.now();
      entries['state:meta'] = { chunks, savedAt, bytes: text.length };
      await storage.put(entries);
      const stale = [];
      for (let i = chunks; i < old; i++) stale.push(`state:c:${String(i).padStart(3, '0')}`);
      if (stale.length) await storage.delete(stale);
      return json({ ok: true, savedAt });
    }

    if (pathname === '/state' && request.method === 'GET') {
      const meta = await storage.get<{ chunks: number; savedAt: number }>('state:meta');
      if (!meta) return reply('No backup yet', 404);
      const parts = await storage.list<string>({ prefix: 'state:c:' });
      const text = [...parts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, meta.chunks)
        .map(([, v]) => v)
        .join('');
      return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-saved-at': String(meta.savedAt) } });
    }

    return reply('Not found', 404);
  }
}

async function household(request: Request, url: URL, env: Env): Promise<Response> {
  const key = request.headers.get('x-household-key') ?? '';
  if (!KEY_PATTERN.test(key)) return reply('This phone isn’t paired — scan the QR code on the kitchen calendar.', 401);
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(await sha256(key)));
  const sub = url.pathname.replace(/^\/api/, '');
  return stub.fetch(new Request(`https://household${sub}`, { method: request.method, headers: { 'content-type': 'application/json' }, body: request.method === 'GET' ? undefined : await request.text() }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ics') {
      if (request.method !== 'GET') return reply('Method not allowed', 405);
      return proxyCalendar(url);
    }
    if (['/api/inbox', '/api/inbox/ack', '/api/profile', '/api/state'].includes(url.pathname)) {
      return household(request, url, env);
    }
    if (url.pathname.startsWith('/api/')) return reply('Not found', 404);
    return env.ASSETS.fetch(request);
  },
};
