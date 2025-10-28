import type { APIRoute } from 'astro';

// This must be set to false for GET requests with query params to work correctly in production.
export const prerender = false;

/**
 * Fetches an image and converts it to Base64, with a timeout.
 * @param url The image URL.
 * @param timeout Timeout in milliseconds.
 * @returns An object with the original URL and the resulting Data URL or 'failed' string.
 */
async function imageToBase64(url: string, timeout = 4000): Promise<{ url: string, dataUrl: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    
    return { url, dataUrl: `data:${contentType};base64,${base64}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Timeout loading image: ${url}`);
    } else {
      console.error(`Error converting image to Base64 for URL ${url}:`, error);
    }
    return { url, dataUrl: 'failed' }; // Use a special string to indicate failure
  }
}

/**
 * API route that streams image data back to the client using Server-Sent Events.
 */
export const GET: APIRoute = async ({ request }) => {
  const searchParams = new URL(request.url).searchParams;
  const imageUrlsParam = searchParams.get('urls');

  if (!imageUrlsParam) {
    return new Response(JSON.stringify({ error: '`urls` query parameter is required' }), { status: 400 });
  }

  const imageUrls = imageUrlsParam.split(',').filter(Boolean);

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Process all images in parallel
      const promises = imageUrls.map(url => 
        imageToBase64(url).then(result => {
          // Send each result back as soon as it's ready
          sendEvent(result);
        })
      );

      // Wait for all promises to settle
      await Promise.all(promises);

      // Close the stream once all images are processed
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};