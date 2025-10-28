import type { APIRoute } from 'astro';

// This must be set to false for POST requests to work in production.
export const prerender = false;

/**
 * Fetches an image from a URL and converts it to a Base64 Data URL.
 * Includes a timeout to prevent long waits.
 * @param url The URL of the image to fetch.
 * @param timeout The timeout in milliseconds.
 * @returns A promise that resolves to the Base64 string or an empty string on failure.
 */
async function imageToBase64(url: string, timeout = 5000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Timeout loading image: ${url}`);
    } else {
      console.error(`Error converting image to Base64 for URL ${url}:`, error);
    }
    return ''; // Return empty string on failure or timeout
  }
}

/**
 * API route to fetch the initial post data (meta + avatar) quickly.
 */
export const POST: APIRoute = async ({ request }) => {
  let url: string;

  try {
    const body = await request.json();
    url = body.url;
    if (!url) {
      throw new Error('URL is required in the request body.');
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request body. Please provide a URL.' }), { status: 400 });
  }

  let match;
  try {
    const urlObject = new URL(url);
    const pathParts = urlObject.pathname.split('/').filter(p => p);
    if (pathParts.length >= 2 && pathParts[0].startsWith('@')) {
      match = { instance: urlObject.hostname, id: pathParts[1] };
    } else {
      throw new Error('Invalid URL format');
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid URL format. Expected format: https://instance/@user/id' }), { status: 400 });
  }

  const { instance, id } = match;
  const apiUrl = `https://${instance}/api/v1/statuses/${id}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching from Mastodon API [${response.status}]: ${errorText}`);
      if (response.status === 404) {
        return new Response(JSON.stringify({ error: 'Post not found. Please check if the URL is correct and the post is public.' }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: `Failed to fetch from instance: ${response.statusText}` }), { status: response.status });
    }
    const postData = await response.json();
    const sourcePost = postData.reblog || postData;

    // Fetch the high-priority avatar right away
    const avatarDataUrl = sourcePost.account?.avatar ? await imageToBase64(sourcePost.account.avatar) : '';

    const imageMap: Record<string, string> = {};
    if (sourcePost.account?.avatar && avatarDataUrl) {
      imageMap[sourcePost.account.avatar] = avatarDataUrl;
    }

    // Collect all other image URLs to be streamed later
    const remainingImageUrls = new Set<string>();
    const emojis = [...(sourcePost.emojis || []), ...(sourcePost.account?.emojis || [])];
    emojis.forEach(e => {
      if(e.url) remainingImageUrls.add(e.url)
    });

    if (sourcePost.media_attachments?.length > 0) {
      sourcePost.media_attachments.slice(0, 4).forEach((attachment: any) => {
        const imageUrl = attachment.type === 'image' ? attachment.url : (attachment.preview_url || attachment.url);
        if (imageUrl) remainingImageUrls.add(imageUrl);
      });
    }

    return new Response(JSON.stringify({
      postData,
      imageMap, // Contains the already-processed avatar
      imageUrls: Array.from(remainingImageUrls), // Contains only the remaining images
      fetchedInstance: instance,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API Route Error (fetch-post-meta):', error);
    return new Response(JSON.stringify({ error: 'An internal server error occurred while fetching post metadata.' }), { status: 500 });
  }
};