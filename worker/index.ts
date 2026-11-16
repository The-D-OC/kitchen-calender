// Cloudflare Worker: serves the static site and one small API route.
//
//   GET /api/ics?url=<https or webcal calendar link>
//
// Calendar providers (Google, iCloud, Outlook) don't send CORS headers, so the
// browser can't read their .ics feeds directly. This fetches the feed on the
// server side and only ever returns real iCalendar data, so it can't be used as
// a general-purpose proxy.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const MAX_BYTES = 5_000_000;

const reply = (body: string, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'content-type': type, 'cache-control': 'no-store' } });

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
      headers: { 'user-agent': 'KitchenCalendar/1.0 (+https://github.com)', accept: 'text/calendar, */*' },
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ics') {
      if (request.method !== 'GET') return reply('Method not allowed', 405);
      return proxyCalendar(url);
    }
    return env.ASSETS.fetch(request);
  },
};
