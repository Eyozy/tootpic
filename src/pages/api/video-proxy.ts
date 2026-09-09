import type { APIRoute } from 'astro';
import { safeFetch } from '../../utils/netHelpers';

export const prerender = false;

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
];

const ALLOWED_MEDIA_PREFIXES = ['video/', 'audio/', 'application/ogg', 'application/vnd.apple.mpegurl'];

export const GET: APIRoute = async ({ request }) => {
  const rawUrl = new URL(request.url).searchParams.get('url') || '';

  try {
    const headers = new Headers();
    const range = request.headers.get('range');
    if (range) headers.set('range', range);

    const upstream = await safeFetch(rawUrl, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response('Failed to fetch video', { status: upstream.status || 502 });
    }

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const isAllowedMedia = ALLOWED_MEDIA_PREFIXES.some(prefix => contentType.startsWith(prefix));
    if (!isAllowedMedia) {
      return new Response('Upstream is not a valid media type', { status: 415 });
    }

    const responseHeaders = new Headers();
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=3600');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response('Invalid or unreachable video URL', { status: 400 });
  }
};

