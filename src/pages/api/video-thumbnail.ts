import type { APIRoute } from 'astro';
import { bufferToBody, isSafeRemoteHttpUrl } from '../../utils/netHelpers';
import { LRUCache } from '../../utils/apiCache';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const prerender = false;

const execAsync = promisify(exec);
const thumbnailCache = new LRUCache<Buffer>(64, 60);

 

/**
 * Extract video ID from various platforms
 */
function extractVideoInfo(url: string): { platform: string; id: string; thumbnailUrl?: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Bilibili
    if (host.includes('bilibili.com') || host.includes('b23.tv')) {
      const bvMatch = url.match(/\/video\/(BV[0-9A-Za-z]{10})/i);
      if (bvMatch) {
        return {
          platform: 'bilibili',
          id: bvMatch[1],
          thumbnailUrl: `https://i0.hdslb.com/bfs/archive/${bvMatch[1]}.jpg`,
        };
      }
    }

    // YouTube
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const videoId = u.searchParams.get('v') || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)?.[1];
      if (videoId) {
        return {
          platform: 'youtube',
          id: videoId,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        };
      }
    }

    // Direct video files (Ech0 self-hosted videos)
    const pathname = u.pathname.toLowerCase();
    if (pathname.endsWith('.mp4') || pathname.endsWith('.webm') || pathname.endsWith('.mov')) {
      return {
        platform: 'direct',
        id: pathname.split('/').pop() || 'video',
        // No thumbnail URL for direct videos - will use placeholder
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch image from URL and return as buffer
 */
async function fetchImageAsBuffer(imageUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
      },
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Generate video thumbnail using FFmpeg
 * This downloads the first part of the video and extracts a frame
 */
async function downloadVideoBuffer(videoUrl: string, maxBytes: number, rangeHeader?: string): Promise<Buffer | null> {
  try {
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
        ...(rangeHeader ? { 'Range': rangeHeader } : {}),
      },
    });

    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!rangeHeader && contentLength && contentLength > maxBytes) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) return null;
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

async function runFfmpegThumbnail(videoBuffer: Buffer, seekSeconds: number): Promise<Buffer | null> {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const tempVideoPath = path.join(tempDir, `video-${timestamp}.mp4`);
  const tempThumbPath = path.join(tempDir, `thumb-${timestamp}.jpg`);

  try {
    // Write to temp file
    fs.writeFileSync(tempVideoPath, videoBuffer);

    // Use FFmpeg to extract first frame
    // -i input: input file
    // -ss 00:00:01: seek to 1 second (avoid black frames at start)
    // -vframes 1: extract only 1 frame
    // -q:v 2: quality (2 is good, 1 is best)
    // -y: overwrite output
    await execAsync(
      `ffmpeg -i "${tempVideoPath}" -ss ${seekSeconds.toFixed(2)} -vframes 1 -q:v 2 -y "${tempThumbPath}"`,
      { timeout: 10000 }
    );

    // Read the generated thumbnail
    if (fs.existsSync(tempThumbPath)) {
      const thumbnailBuffer = fs.readFileSync(tempThumbPath);
      return thumbnailBuffer;
    }

    return null;
  } catch (error) {
    throw error;
  } finally {
    // Clean up temp files
    try {
      if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      if (fs.existsSync(tempThumbPath)) fs.unlinkSync(tempThumbPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function generateVideoThumbnail(videoUrl: string, seekSeconds: number): Promise<Buffer | null> {
  // First attempt: partial download (faster)
  const rangeBuffer = await downloadVideoBuffer(videoUrl, 4 * 1024 * 1024, 'bytes=0-4194303');
  if (rangeBuffer) {
    try {
      const thumb = await runFfmpegThumbnail(rangeBuffer, seekSeconds);
      if (thumb) return thumb;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // If moov atom is missing, retry with a full download below.
      if (!msg.includes('moov atom not found')) {
        console.error('FFmpeg thumbnail generation failed:', error);
        return null;
      }
    }
  }

  // Second attempt: full download with size cap
  const fullBuffer = await downloadVideoBuffer(videoUrl, 20 * 1024 * 1024);
  if (!fullBuffer) return null;
  try {
    return await runFfmpegThumbnail(fullBuffer, seekSeconds);
  } catch (error) {
    console.error('FFmpeg thumbnail generation failed:', error);
    return null;
  }
}

/**
 * Extract domain and filename from URL for display
 */
function extractVideoInfoFromUrl(url: string): { domain: string; filename: string } {
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, '');
    const pathname = u.pathname;
    const filename = pathname.substring(pathname.lastIndexOf('/') + 1) || 'video';
    // Truncate long filenames
    const shortName = filename.length > 30 ? filename.substring(0, 27) + '...' : filename;
    return { domain, filename: shortName };
  } catch {
    return { domain: 'Video', filename: 'unknown' };
  }
}

/**
 * Generate a beautiful video placeholder SVG
 */
function videoPlaceholderSvg(platform?: string, videoUrl?: string): Response {
  const platformLabel = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Video';
  const gradientColors = {
    bilibili: ['#00A1D6', '#0084B3'],
    youtube: ['#FF0000', '#CC0000'],
    direct: ['#10B981', '#059669'],
    default: ['#4F46E5', '#7C3AED'],
  };
  const colors = gradientColors[platform as keyof typeof gradientColors] || gradientColors.default;

  // Extract video info for display
  const videoInfo = videoUrl ? extractVideoInfoFromUrl(videoUrl) : null;
  const displayDomain = videoInfo?.domain || platformLabel;
  const displayFilename = videoInfo?.filename || '';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="320" cy="140" r="60" fill="rgba(255,255,255,0.2)" filter="url(#glow)"/>
  <circle cx="320" cy="140" r="50" fill="rgba(255,255,255,0.95)"/>
  <path d="M305 125 L305 165 L345 145 Z" fill="${colors[0]}"/>
  <text x="320" y="240" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="18" font-weight="600" fill="rgba(255,255,255,0.95)">${escapeXml(displayDomain)}</text>
  ${displayFilename ? `<text x="320" y="270" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="14" fill="rgba(255,255,255,0.8)">${escapeXml(displayFilename)}</text>` : ''}
  <text x="320" y="310" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="12" fill="rgba(255,255,255,0.6)">Video</text>
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSeekSeconds(raw: string | null): number {
  const fallback = 0.8;
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  // Clamp to a safe range; short videos still get a usable frame.
  if (value < 0.1) return 0.1;
  if (value > 5) return 5;
  return value;
}

export const GET: APIRoute = async ({ request }) => {
  const searchParams = new URL(request.url).searchParams;
  const rawUrl = searchParams.get('url') || '';
  const seekSeconds = parseSeekSeconds(searchParams.get('t'));

  if (!rawUrl || !isSafeRemoteHttpUrl(rawUrl)) {
    return videoPlaceholderSvg(undefined, rawUrl);
  }

  const cacheKey = `${rawUrl}::${seekSeconds.toFixed(2)}`;
  const cachedThumbnail = thumbnailCache.get(cacheKey);
  if (cachedThumbnail) {
    return new Response(bufferToBody(cachedThumbnail), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // Try to get platform-specific thumbnail
  const videoInfo = extractVideoInfo(rawUrl);

  if (videoInfo?.thumbnailUrl) {
    const imageBuffer = await fetchImageAsBuffer(videoInfo.thumbnailUrl);
    if (imageBuffer) {
      thumbnailCache.set(cacheKey, imageBuffer);
      return new Response(bufferToBody(imageBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
  }

  // For direct video files, try to generate thumbnail using FFmpeg
  if (videoInfo?.platform === 'direct') {
    const thumbnailBuffer = await generateVideoThumbnail(rawUrl, seekSeconds);
    if (thumbnailBuffer) {
      thumbnailCache.set(cacheKey, thumbnailBuffer);
      return new Response(bufferToBody(thumbnailBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
  }

  // Return platform-specific placeholder with video URL info
  return videoPlaceholderSvg(videoInfo?.platform, rawUrl);
};
