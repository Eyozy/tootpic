import type { APIRoute } from 'astro';
import { isSafeRemoteHttpUrl } from '../../utils/netHelpers';

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

export const GET: APIRoute = async ({ request }) => {
  const rawUrl = new URL(request.url).searchParams.get('url') || '';
  if (!rawUrl || !isSafeRemoteHttpUrl(rawUrl)) {
    return new Response('Invalid video URL', { status: 400 });
  }

  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('range', range);

  const upstream = await fetch(rawUrl, {
    headers,
    redirect: 'follow',
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Failed to fetch video', { status: upstream.status || 502 });
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
};
