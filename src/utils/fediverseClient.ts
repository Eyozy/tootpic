import { parseFediverseUrl, convertMastodonToUniversal, convertActivityPubToUniversal } from './activitypubParser';
import { extractHashtagNames } from './netHelpers';
import type { FediversePost, FediverseAccount } from '../types/activitypub';
import { SUPPORTED_PLATFORMS, PlatformConfig } from '../types/activitypub';
import { LRUCache } from './apiCache';

export interface FetchPostResult {
  success: boolean;
  data?: FediversePost;
  error?: string;
  errorCode?: string;
  platform?: string;
  suggestion?: string;
}

export enum ErrorCode {
  INVALID_URL = 'INVALID_URL',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_FOUND = 'NOT_FOUND',
  PRIVATE_POST = 'PRIVATE_POST',
  SERVER_ERROR = 'SERVER_ERROR',
  CORS_ERROR = 'CORS_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
}

/**
 * Universal Fediverse client with LRU cache for better performance
 */
export class FediverseClient {
  private static postCache = new LRUCache<FetchPostResult>(100, 30);

  /**
   * Universal API request method supporting different HTTP methods and platform configurations
   */
  private static async makeApiRequest(
    domain: string,
    endpoint: { path: string; method: 'GET' | 'POST' },
    data?: any,
    headers?: Record<string, string>
  ): Promise<Response> {
    let url = `https://${domain}${endpoint.path}`;

    // For GET requests, replace ID in URL path
    if (endpoint.method === 'GET' && data?.id) {
      url = url.replace('{id}', data.id);
    }

    const defaultHeaders: Record<string, string> = {
      'User-Agent': 'TootPic/1.0 (+https://github.com/Eyozy/tootpic)',
      'Accept': 'application/json, application/activity+json',
    };

    const requestConfig: RequestInit = {
      method: endpoint.method,
      headers: { ...defaultHeaders, ...headers },
    };

    // For POST requests, add request body (full data object)
    if (endpoint.method === 'POST' && data) {
      (requestConfig.headers as Record<string, string>)['Content-Type'] = 'application/json';
      requestConfig.body = JSON.stringify(data);
    }

    return fetch(url, requestConfig);
  }

  /**
   * Fetch a post from any Fediverse platform
   * Fetch post with cache support to reduce duplicate requests
   */
  static async fetchPost(url: string): Promise<FetchPostResult> {
    const cached = this.postCache.get(url);
    if (cached) {
      console.log(`[FediverseClient] Cache hit: ${url.substring(0, 50)}...`);
      return cached;
    }

    console.log(`[FediverseClient] Cache miss, fetching: ${url.substring(0, 50)}...`);

    try {
      // Validate URL format
      if (!url || typeof url !== 'string') {
        return {
          success: false,
          error: 'Please enter a valid URL',
          errorCode: ErrorCode.INVALID_URL,
          suggestion: 'Make sure you\'re pasting a complete URL (e.g., https://mastodon.social/@username/123456)',
        };
      }

      try {
        new URL(url);
      } catch {
        return {
          success: false,
          error: 'Invalid URL format',
          errorCode: ErrorCode.INVALID_URL,
          suggestion: 'Please check the URL format and try again',
        };
      }

      // Check if this is obviously not a Fediverse URL
      const obviousNonFediversePatterns = [
        /github\.com/,
        /gitlab\.com/,
        /bitbucket\.org/,
        /stackoverflow\.com/,
        /reddit\.com/,
        /twitter\.com/,
        /x\.com/,
        /facebook\.com/,
        /instagram\.com/,
        /linkedin\.com/,
        /youtube\.com/,
        /youtu\.be/,
      ];

      for (const pattern of obviousNonFediversePatterns) {
        if (pattern.test(url.toLowerCase())) {
          return {
            success: false,
            error: 'This URL is from a platform that does not support the ActivityPub protocol',
            errorCode: ErrorCode.UNSUPPORTED_PLATFORM,
            suggestion: 'Please use a URL from a Fediverse platform like Mastodon, Pixelfed, PeerTube, Misskey, or any ActivityPub-compatible service. For the Ech0 project, you would need the URL of their actual Fediverse instance (like https://memo.vaaat.com), not their GitHub repository.',
          };
        }
      }

      // Parse the URL to identify platform and extract post info
      const parsed = parseFediverseUrl(url);
      if (!parsed) {
        return {
          success: false,
          error: 'Unsupported URL',
          errorCode: ErrorCode.UNSUPPORTED_PLATFORM,
          suggestion: 'Use direct post link from supported Fediverse platform (Mastodon, Pixelfed, PeerTube, etc.).',
        };
      }

      // Validate platform configuration exists
      const platformConfig = SUPPORTED_PLATFORMS[parsed.platform];
      if (!platformConfig) {
        return {
          success: false,
          error: `Unsupported platform: ${parsed.platform}`,
          errorCode: ErrorCode.UNSUPPORTED_PLATFORM,
          suggestion: 'Please try using a URL from a supported platform such as Mastodon, Pixelfed, or PeerTube',
        };
      }

      // Route to appropriate platform handler
      let result: FetchPostResult;

      switch (parsed.platform) {
        case 'mastodon':
          result = await this.fetchMastodonPost(parsed);
          break;
        case 'pleroma':
          result = await this.fetchPleromaPost(parsed);
          break;
        case 'pixelfed':
          result = await this.fetchPixelfedPost(parsed);
          break;
        case 'misskey':
          result = await this.fetchMisskeyPost(parsed);
          break;
        case 'peertube':
          result = await this.fetchPeerTubePost(parsed);
          break;
        case 'ech0':
          result = await this.fetchEch0Post(parsed);
          break;
        case 'generic':
          // For generic URLs, try to detect platform-specific APIs first
          // Check if URL pattern looks like PeerTube
          if (parsed.originalUrl.includes('/videos/watch/') || parsed.originalUrl.includes('/w/')) {
            const peertubeResult = await this.fetchPeerTubePost(parsed);
            if (peertubeResult.success) {
              result = peertubeResult;
              break;
            }
          }
          // Check if URL pattern looks like Misskey
          else if (parsed.originalUrl.includes('/notes/')) {
            const misskeyResult = await this.fetchMisskeyPost(parsed);
            if (misskeyResult.success) {
              result = misskeyResult;
              break;
            }
          }
          result = await this.fetchActivityPubObject(parsed.domain, parsed.id);
          break;
        default:
          result = {
            success: false,
            error: `Unsupported platform: ${parsed.platform}`,
            errorCode: ErrorCode.UNSUPPORTED_PLATFORM,
            suggestion: 'Try a URL from a supported platform like Mastodon, Pixelfed, or PeerTube',
          };
      }

      // Only cache successful results
      if (result.success) {
        this.postCache.set(url, result);
        console.log(`[FediverseClient] Result cached: ${url.substring(0, 50)}...`);
      }

      return result;
    } catch (error) {
      console.error('Error fetching Fediverse post:', error);

      // Handle different types of errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          error: 'Network error while fetching the post',
          errorCode: ErrorCode.NETWORK_ERROR,
          suggestion: 'Check your internet connection and try again',
        };
      }

      // Check for authentication/permission errors
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('login') || errorMsg.includes('unauthorized') || errorMsg.includes('forbidden') ||
            errorMsg.includes('authentication required') || errorMsg.includes('access denied')) {
          return {
            success: false,
            error: 'This platform requires authentication to access posts',
            errorCode: ErrorCode.PRIVATE_POST,
            suggestion: 'Try a different platform (Mastodon instances usually work without authentication) or a public post from the same platform',
          };
        }

        if (errorMsg.includes('not found') || errorMsg.includes('404')) {
          return {
            success: false,
            error: 'Post not found or may have been deleted',
            errorCode: ErrorCode.NOT_FOUND,
            suggestion: 'Check that the post URL is correct and the post still exists. Try a more recent post or a different platform.',
          };
        }

        if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests') || errorMsg.includes('429')) {
          return {
            success: false,
            error: 'Rate limit exceeded',
            errorCode: ErrorCode.RATE_LIMITED,
            suggestion: 'Please wait a few minutes before trying again',
          };
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch post',
        errorCode: ErrorCode.SERVER_ERROR,
        suggestion: 'Please try again in a few moments or try a different platform',
      };
    }
  }

  /**
   * Fetch post from Mastodon-compatible API
   */
  private static async fetchMastodonPost(parsed: any): Promise<FetchPostResult> {
    try {
      // Get platform configuration
      const platformConfig = SUPPORTED_PLATFORMS.mastodon;

      // Make API request using the new universal method
      const response = await this.makeApiRequest(
        parsed.domain,
        platformConfig.apiEndpoints.status,
        { id: parsed.id }
      );

      if (response.status === 404) {
        return {
          success: false,
          error: 'Post not found or deleted',
          errorCode: ErrorCode.NOT_FOUND,
          suggestion: 'Check that the post URL is correct and the post still exists',
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: 'This post is private or requires authentication',
          errorCode: ErrorCode.PRIVATE_POST,
          suggestion: 'Only public posts can be converted to images',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'Too many requests. Please wait before trying again',
          errorCode: ErrorCode.RATE_LIMITED,
          suggestion: 'Wait a few moments and try again',
        };
      }

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      let mastodonData;
      try {
        mastodonData = await response.json();
      } catch (parseError) {
        return {
          success: false,
          error: 'Failed to parse response from server',
          errorCode: ErrorCode.PARSE_ERROR,
          suggestion: 'The server returned an invalid response format',
        };
      }

      const universalData = convertMastodonToUniversal(mastodonData);

      return {
        success: true,
        data: universalData,
        platform: 'mastodon',
      };
    } catch (error) {
      // If Mastodon API fails, try ActivityPub
      return await this.fetchActivityPubObject(parsed.domain, parsed.id);
    }
  }

  /**
   * Fetch post from Pleroma instance
   */
  private static async fetchPleromaPost(parsed: any): Promise<FetchPostResult> {
    try {
      // Pleroma uses Mastodon-compatible API
      const platformConfig = SUPPORTED_PLATFORMS.pleroma;

      const response = await this.makeApiRequest(
        parsed.domain,
        platformConfig.apiEndpoints.status,
        { id: parsed.id }
      );

      if (!response.ok) {
        throw new Error(`Pleroma API request failed: ${response.statusText}`);
      }

      const pleromaData = await response.json();
      const universalData = convertMastodonToUniversal(pleromaData);
      universalData.platform = 'pleroma';

      return {
        success: true,
        data: universalData,
        platform: 'pleroma',
      };
    } catch (error) {
      return await this.fetchActivityPubObject(parsed.domain, parsed.id);
    }
  }

  /**
   * Fetch post from Pixelfed instance
   */
  private static async fetchPixelfedPost(parsed: any): Promise<FetchPostResult> {
    try {
      const platformConfig = SUPPORTED_PLATFORMS.pixelfed;

      // First try Pixelfed v2 API
      let response = await this.makeApiRequest(
        parsed.domain,
        { path: '/api/v2/statuses/{id}', method: 'GET' },
        { id: parsed.id }
      );

      if (!response.ok) {
        // Fallback to v1 API
        response = await this.makeApiRequest(
          parsed.domain,
          { path: '/api/v1/statuses/{id}', method: 'GET' },
          { id: parsed.id }
        );

        if (!response.ok) {
          // If both Mastodon APIs fail, try ActivityPub fallback
          return await this.fetchPixelfedActivityPub(parsed);
        }
      }

      const pixelfedData = await response.json();

      // Fix: Use avatar_static as fallback if avatar is missing
      if (!pixelfedData.account.avatar && pixelfedData.account.avatar_static) {
        pixelfedData.account.avatar = pixelfedData.account.avatar_static;
      }

      const universalData = convertMastodonToUniversal(pixelfedData);
      universalData.platform = 'pixelfed';

      return {
        success: true,
        data: universalData,
        platform: 'pixelfed',
      };
    } catch (error) {
      // Always try ActivityPub fallback for Pixelfed
      return await this.fetchPixelfedActivityPub(parsed);
    }
  }

  /**
   * Fetch Pixelfed post via ActivityPub from the web page
   */
  private static async fetchPixelfedActivityPub(parsed: any): Promise<FetchPostResult> {
    try {
      // For Pixelfed, we need to try different approaches
      const possibleUrls = [
        // Direct page URL (for extracting ActivityPub from HTML)
        `https://${parsed.domain}/p/${parsed.username}/${parsed.id}`,
        // Standard ActivityPub endpoints
        `https://${parsed.domain}/objects/${parsed.id}`,
        `https://${parsed.domain}/p/${parsed.id}`,
        `https://${parsed.domain}/statuses/${parsed.id}`,
      ].filter(Boolean);

      let activityPubData = null;
      let lastError = null;

      for (const url of possibleUrls) {
        try {
          // First try to get as ActivityPub JSON
          let response = await fetch(url, {
            headers: {
              'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
            },
          });

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json') || contentType.includes('activity+json')) {
              const text = await response.text();

              if (!text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
                try {
                  const data = JSON.parse(text);
                  if (data.type && (data.type === 'Note' || data.type === 'Create' || data.type === 'Image' || data.type === 'Video')) {
                    activityPubData = data;
                    
                    break;
                  }
                } catch (parseError) {
                  lastError = parseError;
                  continue;
                }
              }
            }
          }

          // If ActivityPub headers fail, try to get the page and extract ActivityPub from it
          response = await fetch(url);
          if (response.ok) {
            const text = await response.text();

            // Look for ActivityPub data in the HTML
            const activityJsonMatch = text.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/s);
            if (activityJsonMatch) {
              try {
                const jsonData = JSON.parse(activityJsonMatch[1]);
                if (jsonData.type === 'Note' || (jsonData['@graph'] && jsonData['@graph'].some((item: any) => item.type === 'Note'))) {
                  activityPubData = jsonData['@graph'] ? jsonData['@graph'].find((item: any) => item.type === 'Note') : jsonData;

                  // Extract avatar from HTML meta tags if not in ActivityPub data
                  if (!activityPubData.attributedTo?.icon?.url) {
                    // Try multiple patterns to find the user avatar
                    const avatarPatterns = [
                      // Profile images in various formats
                      /<img[^>]*class=["'][^"']*profile-photo[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      /<img[^>]*class=["'][^"']*avatar[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      /<img[^>]*class=["'][^"']*user-avatar[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      // Data attributes
                      /<img[^>]*data-avatar=["']([^"']+)["'][^>]*>/,
                      /<div[^>]*data-avatar=["']([^"']+)["'][^>]*>/,
                      // Background images
                      /background-image:\s*url\(['"]?([^'"()]+\/avatars\/[^'"()]+)['"]?\)/,
                      // Meta tags (fallback)
                      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/,
                      /<meta[^>]*property=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/,
                      // Direct avatar URLs in common paths
                      /<img[^>]*src=["']([^"']*\/storage\/avatars\/[^"']+)["'][^>]*>/,
                      /<img[^>]*src=["']([^"']*\/avatars\/[^"']+)["'][^>]*>/,
                    ];

                    let avatarUrl = null;
                    for (const pattern of avatarPatterns) {
                      const match = text.match(pattern);
                      if (match && match[1]) {
                        avatarUrl = match[1];
                        // Skip if it's a post image, not a profile avatar
                        if (avatarUrl.includes('/post/') || avatarUrl.includes('/media/') || avatarUrl.includes('/attachments/')) {
                          continue;
                        }
                        break;
                      }
                    }

                    if (avatarUrl) {
                      // Create attributedTo object if it doesn't exist
                      if (!activityPubData.attributedTo) {
                        activityPubData.attributedTo = {};
                      } else if (typeof activityPubData.attributedTo === 'string') {
                        activityPubData.attributedTo = { id: activityPubData.attributedTo };
                      }

                      // Make URL absolute if relative
                      if (avatarUrl.startsWith('/')) {
                        avatarUrl = `https://${parsed.domain}${avatarUrl}`;
                      } else if (!avatarUrl.startsWith('http')) {
                        avatarUrl = `https://${parsed.domain}/${avatarUrl}`;
                      }

                      // Set avatar
                      activityPubData.attributedTo.icon = { url: avatarUrl };
                      
                    }
                  }

                  

                  // Extract video thumbnail from HTML if not in ActivityPub data
                  if (activityPubData.attachment) {
                    // Removed detailed debug output

                    activityPubData.attachment = activityPubData.attachment.map((att: any) => {
                      

                      // If attachment is a video and has no preview/thumbnail
                      if ((att.type === 'Document' || att.type === 'Video') && !att.preview && !att.thumbnail) {
                        
                        // Try to find video thumbnail in HTML
                        const thumbnailPatterns = [
                          // Open Graph image
                          /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/,
                          // Twitter card image
                          /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/,
                          // Video poster attribute
                          /<video[^>]*poster=["']([^"']+)["'][^>]*>/,
                          // Thumbnail images (common in video players)
                          /<img[^>]*class=["'][^"']*thumb[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                          /<img[^>]*class=["'][^"']*poster[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                        ];

                        let thumbnailUrl = null;
                        for (const pattern of thumbnailPatterns) {
                          const match = text.match(pattern);
                          if (match && match[1]) {
                            thumbnailUrl = match[1];
                            // Make URL absolute if relative
                            if (thumbnailUrl.startsWith('/')) {
                              thumbnailUrl = `https://${parsed.domain}${thumbnailUrl}`;
                            } else if (!thumbnailUrl.startsWith('http')) {
                              thumbnailUrl = `https://${parsed.domain}/${thumbnailUrl}`;
                            }
                            break;
                          }
                        }

                        if (thumbnailUrl) {
                          att.preview = { url: thumbnailUrl };
                          
                        } else {
                          // Try to generate thumbnail URL from video URL
                          // Pixelfed pattern: video.mp4 -> video_thumb.jpeg
                          if (att.url && typeof att.url === 'string') {
                            const videoUrl = att.url;
                            // Try Pixelfed's thumbnail pattern first
                            const possibleThumbnails = [
                              videoUrl.replace(/\.mp4$/i, '_thumb.jpeg'),  // Pixelfed
                              videoUrl.replace(/\.mp4$/i, '_thumb.jpg'),
                              videoUrl.replace(/\.mp4$/i, '.jpg'),
                              videoUrl.replace(/\.mp4$/i, '.png'),
                              videoUrl.replace(/\.mp4$/i, '-thumb.jpg'),
                            ];

                            
                            // Use the first one as a fallback (we'll let the browser try to load it)
                            att.preview = { url: possibleThumbnails[0] };
                            
                          }
                        }
                      }
                      return att;
                    });
                  }

                  break;
                }
              } catch (extractError) {
                
                lastError = extractError;
              }
            }
          }
        } catch (e) {
          
          lastError = e;
          continue;
        }
      }

      if (!activityPubData) {
        return {
          success: false,
          error: `Unable to fetch Pixelfed post. This Pixelfed instance may require authentication or have public access restrictions.`,
          errorCode: ErrorCode.PRIVATE_POST,
          suggestion: 'Try a different Pixelfed instance or a post from a public profile. Some instances restrict API access.',
        };
      }

      // Log final ActivityPub data before conversion
      // Removed detailed debug output

      // Convert to universal format
      const universalData = await convertActivityPubToUniversal(activityPubData, parsed.domain);
      universalData.platform = 'pixelfed';

      // Removed detailed debug output

      return {
        success: true,
        data: universalData,
        platform: 'pixelfed',
      };
    } catch (error) {
      console.error('Pixelfed ActivityPub fetch failed:', error);
      return {
        success: false,
        error: `Failed to fetch Pixelfed post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: ErrorCode.SERVER_ERROR,
        suggestion: 'This Pixelfed instance may not allow public access to posts.',
      };
    }
  }

  /**
   * Fetch post from Misskey instance
   */
  private static async fetchMisskeyPost(parsed: any): Promise<FetchPostResult> {
    try {
      // Misskey uses a unique API format, requiring POST requests and specific request body format
      const platformConfig = SUPPORTED_PLATFORMS.misskey;

      const response = await this.makeApiRequest(
        parsed.domain,
        platformConfig.apiEndpoints.status,
        { noteId: parsed.id }
      );

      if (!response.ok) {
        throw new Error(`Misskey API request failed: ${response.statusText}`);
      }

      const misskeyData = await response.json();

      // Fetch instance emoji list to resolve custom emojis
      // Misskey doesn't include emoji URLs in the note response
      let instanceEmojis: Map<string, string> = new Map();
      try {
        
        const emojiResponse = await fetch(`https://${parsed.domain}/api/emojis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (emojiResponse.ok) {
          const emojiData = await emojiResponse.json();
          if (emojiData.emojis && Array.isArray(emojiData.emojis)) {
            emojiData.emojis.forEach((emoji: any) => {
              instanceEmojis.set(emoji.name, emoji.url);
            });
            
          }
        }
      } catch (emojiError) {
        console.warn('Failed to fetch Misskey emoji list:', emojiError);
      }

      // Log Misskey data for debugging
      
      
      
      

      // Extract emoji shortcodes from text and user name
      const textToScan = `${misskeyData.text || ''} ${misskeyData.user?.name || ''}`;
      const emojiPattern = /:([a-zA-Z0-9_]+):/g;
      const foundEmojiNames = new Set<string>();
      let match;

      while ((match = emojiPattern.exec(textToScan)) !== null) {
        foundEmojiNames.add(match[1]);
      }

      // Build emoji list from instance emojis
      const allEmojis: any[] = [];

      // For each emoji found in text, look it up in the instance emoji list
      foundEmojiNames.forEach(emojiName => {
        const emojiUrl = instanceEmojis.get(emojiName);
        if (emojiUrl) {
          allEmojis.push({
            shortcode: emojiName,
            url: emojiUrl,
            staticUrl: emojiUrl,
          });
          
        } else {
          console.warn(`Emoji :${emojiName}: not found in instance emoji list`);
        }
      });

      

      // Convert Misskey format to our universal format
      const universalData: FediversePost = {
        id: misskeyData.id,
        content: misskeyData.text || misskeyData.cw || '',
        createdAt: misskeyData.createdAt,
        updatedAt: misskeyData.updatedAt,
        account: {
          id: misskeyData.user.id,
          username: misskeyData.user.username,
          displayName: misskeyData.user.name || misskeyData.user.username,
          avatar: misskeyData.user.avatarUrl,
          url: misskeyData.user.url || `https://${parsed.domain}/@${misskeyData.user.username}`,
          acct: `${misskeyData.user.username}@${parsed.domain}`,
          platform: 'misskey',
          emojis: allEmojis,
        },
        attachments: misskeyData.files?.map((file: any) => ({
          type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document',
          url: file.url,
          description: file.comment,
          width: file.properties?.width,
          height: file.properties?.height,
        })) || [],
        repliesCount: misskeyData.repliesCount || 0,
        boostsCount: misskeyData.renoteCount || 0,
        favouritesCount: 0, // Misskey tracks reactions differently
        sensitive: !!misskeyData.cw,
        spoilerText: misskeyData.cw || '',
        url: misskeyData.url || `https://${parsed.domain}/notes/${misskeyData.id}`,
        platform: 'misskey',
        tags: misskeyData.tags?.map((tag: string) => ({
          name: `#${tag}`,
          url: `https://${parsed.domain}/tags/${tag}`,
          type: 'hashtag' as const,
        })) || [],
      };

      return {
        success: true,
        data: universalData,
        platform: 'misskey',
      };
    } catch (error) {
      return await this.fetchActivityPubObject(parsed.domain, parsed.id);
    }
  }

  /**
   * Fetch video from PeerTube instance
   */
  private static async fetchPeerTubePost(parsed: any): Promise<FetchPostResult> {
    try {
      const platformConfig = SUPPORTED_PLATFORMS.peertube;

      const response = await this.makeApiRequest(
        parsed.domain,
        platformConfig.apiEndpoints.status,
        { id: parsed.id }
      );

      if (!response.ok) {
        throw new Error(`PeerTube API request failed: ${response.statusText}`);
      }

      const peertubeData = await response.json();

      // Log PeerTube account data for debugging
      // Removed detailed debug output
      // Removed detailed debug output

      // Get avatar URL with multiple fallbacks
      let avatarUrl = undefined;

      // Try account.avatar first
      if (peertubeData.account?.avatar) {
        
        if (peertubeData.account.avatar.path) {
          avatarUrl = peertubeData.account.avatar.path.startsWith('http')
            ? peertubeData.account.avatar.path
            : `https://${parsed.domain}${peertubeData.account.avatar.path}`;
        } else if (peertubeData.account.avatar.url) {
          avatarUrl = peertubeData.account.avatar.url;
        } else if (typeof peertubeData.account.avatar === 'string') {
          avatarUrl = peertubeData.account.avatar.startsWith('http')
            ? peertubeData.account.avatar
            : `https://${parsed.domain}${peertubeData.account.avatar}`;
        }
      }

      // Try account.avatars array
      if (!avatarUrl && peertubeData.account?.avatars && Array.isArray(peertubeData.account.avatars) && peertubeData.account.avatars.length > 0) {
        
        const avatar = peertubeData.account.avatars[0];
        if (avatar.path) {
          avatarUrl = avatar.path.startsWith('http')
            ? avatar.path
            : `https://${parsed.domain}${avatar.path}`;
        }
      }

      // Try channel.avatar as fallback
      if (!avatarUrl && peertubeData.channel?.avatar) {
        
        if (peertubeData.channel.avatar.path) {
          avatarUrl = peertubeData.channel.avatar.path.startsWith('http')
            ? peertubeData.channel.avatar.path
            : `https://${parsed.domain}${peertubeData.channel.avatar.path}`;
        }
      }

      // Try channel.avatars array
      if (!avatarUrl && peertubeData.channel?.avatars && Array.isArray(peertubeData.channel.avatars) && peertubeData.channel.avatars.length > 0) {
        
        const avatar = peertubeData.channel.avatars[0];
        if (avatar.path) {
          avatarUrl = avatar.path.startsWith('http')
            ? avatar.path
            : `https://${parsed.domain}${avatar.path}`;
        }
      }

      // Try avatarUrl field directly
      if (!avatarUrl && peertubeData.account?.avatarUrl) {
        
        avatarUrl = peertubeData.account.avatarUrl;
      }

      

      // Convert PeerTube format to our universal format
      const universalData: FediversePost = {
        id: peertubeData.id,
        content: peertubeData.description || '',
        createdAt: peertubeData.publishedAt,
        account: {
          id: peertubeData.account.id,
          username: peertubeData.account.name,
          displayName: peertubeData.account.displayName || peertubeData.account.name,
          avatar: avatarUrl,
          url: peertubeData.account.url,
          acct: `${peertubeData.account.name}@${parsed.domain}`,
          platform: 'peertube',
          emojis: [],
        },
        attachments: [{
          type: 'video',
          url: peertubeData.files?.[0]?.fileUrl || peertubeData.streamingPlaylists?.[0]?.files?.[0]?.fileUrl,
          previewUrl: peertubeData.previewPath ? `https://${parsed.domain}${peertubeData.previewPath}` : peertubeData.thumbnailPath ? `https://${parsed.domain}${peertubeData.thumbnailPath}` : undefined,
          description: peertubeData.name,
          width: peertubeData.files?.[0]?.resolution?.width,
          height: peertubeData.files?.[0]?.resolution?.height,
        }],
        repliesCount: peertubeData.commentsTotal || 0,
        boostsCount: 0, // PeerTube doesn't have boosts
        favouritesCount: peertubeData.likes || 0,
        sensitive: peertubeData.nsfw || false,
        spoilerText: peertubeData.nsfw ? 'NSFW content' : '',
        url: peertubeData.url,
        platform: 'peertube',
        tags: peertubeData.tags?.map((tag: string) => ({
          name: `#${tag}`,
          url: `https://${parsed.domain}/tags/${tag}`,
          type: 'hashtag' as const,
        })) || [],
      };

      return {
        success: true,
        data: universalData,
        platform: 'peertube',
      };
    } catch (error) {
      return await this.fetchActivityPubObject(parsed.domain, parsed.id);
    }
  }

  /**
   * Fetch post from Ech0 instance
   */
  private static async fetchEch0Post(parsed: any): Promise<FetchPostResult> {
    
    try {
      // Ech0 usually exposes the canonical ActivityPub object under /objects/<id>.
      // Try high-confidence endpoints first and keep lower-confidence routes as fallback.
      const primaryUrls = [
        parsed.id.startsWith('http') ? parsed.id : `https://${parsed.domain}/objects/${parsed.id}`,
        `https://${parsed.domain}/echo/${parsed.id}`,
      ].filter(Boolean);
      const fallbackUrls = [
        `https://${parsed.domain}/posts/${parsed.id}`,
        `https://${parsed.domain}/notes/${parsed.id}`,
        `https://${parsed.domain}/statuses/${parsed.id}`,
      ];
      const possibleUrls = Array.from(new Set([...primaryUrls, ...fallbackUrls]));
      const ech0ApiPromise = this.fetchEch0ApiEcho(parsed.domain, parsed.id).catch(() => null);

      let activityPubData = null;
      let lastError = null;

      for (const url of possibleUrls) {
        try {
          // First try to get as ActivityPub JSON
          let response = await fetch(url, {
            headers: {
              'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
            },
          });

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json') || contentType.includes('activity+json')) {
              const text = await response.text();

              if (!text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
                try {
                  const data = JSON.parse(text);
                  if (data.type && (data.type === 'Note' || data.type === 'Create' || data.type === 'Image' || data.type === 'Video' ||
                      data.type === 'Article' || data.type === 'Page')) {
                    activityPubData = data;
                    
                    break;
                  } else {
                    
                    lastError = new Error(`Invalid ActivityPub object type: ${data.type}`);
                  }
                } catch (parseError) {
                  
                  lastError = parseError;
                  continue;
                }
              }
            }
          }

          // If ActivityPub headers fail, try to get the page and extract ActivityPub from it
          response = await fetch(url);
          if (response.ok) {
            const text = await response.text();

            // Look for ActivityPub data in the HTML
            const activityJsonMatch = text.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/s);
            if (activityJsonMatch) {
              try {
                const jsonData = JSON.parse(activityJsonMatch[1]);
                if (jsonData.type === 'Note' || (jsonData['@graph'] && jsonData['@graph'].some((item: any) => item.type === 'Note'))) {
                  activityPubData = jsonData['@graph'] ? jsonData['@graph'].find((item: any) => item.type === 'Note') : jsonData;

                  // Extract avatar from HTML meta tags if not in ActivityPub data
                  if (!activityPubData.attributedTo?.icon?.url) {
                    // Try multiple patterns to find the user avatar
                    const avatarMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/);
                    const userAvatarMatch = text.match(/<img[^>]*class=["'][^"']*avatar[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/);
                    const profileImageMatch = text.match(/<meta[^>]*property=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/);

                    // Try to find user profile image in various patterns
                    const userProfilePatterns = [
                      /<img[^>]*class=["'][^"']*user[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      /<img[^>]*class=["'][^"']*profile[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      /<img[^>]*alt=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/,
                      /<img[^>]*src=["']([^"']*\/avatars\/[^"']+)["'][^>]*>/,
                      // Ech0 specific avatar patterns
                      /<img[^>]*src=["']([^"']*\/storage\/[^"']+)["'][^>]*>/,
                      /<img[^>]*src=["']([^"']*\/uploads\/[^"']+)["'][^>]*>/,
                      /<img[^>]*src=["']([^"']*\/images\/[^"']+)["'][^>]*>/,
                      /<img[^>]*src=["']([^"']*\/media\/[^"']+)["'][^>]*>/,
                    ];

                    let profileAvatarMatch = null;
                    for (const pattern of userProfilePatterns) {
                      profileAvatarMatch = text.match(pattern);
                      if (profileAvatarMatch) break;
                    }

                    const avatarUrl = profileAvatarMatch?.[1] || userAvatarMatch?.[1] || avatarMatch?.[1] || profileImageMatch?.[1];

                    if (avatarUrl) {
                      // Create attributedTo object if it doesn't exist
                      if (!activityPubData.attributedTo) {
                        activityPubData.attributedTo = {};
                      } else if (typeof activityPubData.attributedTo === 'string') {
                        activityPubData.attributedTo = { id: activityPubData.attributedTo };
                      }

                      // Make URL absolute if relative
                      let absoluteAvatarUrl = avatarUrl;
                      if (avatarUrl.startsWith('/')) {
                        absoluteAvatarUrl = `https://${parsed.domain}${avatarUrl}`;
                      } else if (!avatarUrl.startsWith('http')) {
                        absoluteAvatarUrl = `https://${parsed.domain}/${avatarUrl}`;
                      }

                      // Set avatar
                      activityPubData.attributedTo.icon = { url: absoluteAvatarUrl };
                      
                    }
                  }

                  // Enhanced content extraction for Ech0
                  // Extract additional content from HTML that may not be in ActivityPub data
                  if (activityPubData) {
                    // Extract hashtags from HTML - more specific patterns
                    const hashtags: Array<{ type: string; name: string; href: string }> = [];

                    // Pattern 1: Find standalone hashtags like "#tag"
                    const hashtagPattern1 = /#([^\s#<]+)/g;
                    let match1;
                    while ((match1 = hashtagPattern1.exec(text)) !== null) {
                      const tag = match1[1];
                      if (tag && tag.length > 0 && !hashtags.find(h => h.name === `#${tag}`)) {
                        hashtags.push({
                          type: 'Hashtag',
                          name: `#${tag}`,
                          href: `https://${parsed.domain}/discover/tags/${tag}`,
                        });
                      }
                    }

                    // Pattern 2: Look for hashtags in specific HTML structures
                    const tagElements = text.match(/<[^>]*class="[^"]*tag[^"]*"[^>]*>([^<]+)<\/[^>]*>/gi) || [];
                    for (const element of tagElements) {
                      const tagMatch = element.match(/#([^\s<>]+)/);
                      if (tagMatch) {
                        const tag = tagMatch[1];
                        if (!hashtags.find(h => h.name === `#${tag}`)) {
                          hashtags.push({
                            type: 'Hashtag',
                            name: `#${tag}`,
                            href: `https://${parsed.domain}/discover/tags/${tag}`,
                          });
                        }
                      }
                    }

                    // Extract links from HTML content
                    const linkPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
                    const extractedLinks = [];
                    let linkMatch;
                    while ((linkMatch = linkPattern.exec(text)) !== null) {
                      const href = linkMatch[1];
                      const text = linkMatch[2];
                      if (href && text && !href.startsWith('#')) {
                        extractedLinks.push({ href, text });
                      }
                    }

                    // Extract videos/iframes
                    const iframePattern = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/g;
                    const videos = [];
                    let iframeMatch;
                    while ((iframeMatch = iframePattern.exec(text)) !== null) {
                      const src = iframeMatch[1];
                      if (src) {
                        videos.push({
                          type: 'Video',
                          mediaType: 'text/html',
                          url: src,
                          name: 'Video content',
                        });
                      }
                    }

                    // Extract username from HTML
                    const usernameMatch = text.match(/<[^>]*>@\s*([^<]+)<\/[^>]*>/);
                    if (usernameMatch && activityPubData.attributedTo) {
                      const username = usernameMatch[1].trim();
                      if (!activityPubData.attributedTo.preferredUsername) {
                        activityPubData.attributedTo.preferredUsername = username;
                      }
                    }

                    // Extract display name from HTML
                    const displayNameMatch = text.match(/<h2[^>]*>([^<]+)<\/h2>/);
                    if (displayNameMatch && activityPubData.attributedTo) {
                      const displayName = displayNameMatch[1].trim();
                      if (!activityPubData.attributedTo.name) {
                        activityPubData.attributedTo.name = displayName;
                      }
                    }

                    // Add extracted tags to ActivityPub data
                    if (hashtags.length > 0) {
                      activityPubData.tag = [...(activityPubData.tag || []), ...hashtags];
                    }

                    // Add extracted videos to attachments
                    if (videos.length > 0) {
                      activityPubData.attachment = [...(activityPubData.attachment || []), ...videos];
                    }

                    // IMPORTANT: Do not inject extracted links/hashtags back into content.
                    // Ech0 extension fields are separate from content; merging causes duplicate rendering.

                    
                  }

                  
                  break;
                }
              } catch (extractError) {
                
                lastError = extractError;
              }
            }
          }
        } catch (e) {
          
          lastError = e;
          continue;
        }
      }

      if (!activityPubData) {
        return {
          success: false,
          error: `Unable to find ActivityPub data for this Ech0 instance. This instance may not be properly configured for federation.`,
          errorCode: ErrorCode.NOT_FOUND,
          suggestion: 'Please verify:\n1. The URL points to a specific post (not the main page)\n2. The Ech0 instance has federation enabled\n3. The post is public and accessible\n4. The instance URL is correct (e.g., https://memo.vaaat.com for a working Ech0 instance)',
        };
      }

      // Ech0-specific REST API provides richer data than ActivityPub (extension links, tags, images, etc.).
      // Prefer it to avoid missing embedded links/tags/media in generated images.
      try {
        const ech0Api = await ech0ApiPromise;
        if (ech0Api) {
          const attachmentHasKind = (attachment: any, kind: 'image' | 'video'): boolean => {
            const type = typeof attachment?.type === 'string' ? attachment.type.toLowerCase() : '';
            if (type === kind) return true;

            const mediaType = typeof attachment?.mediaType === 'string' ? attachment.mediaType.toLowerCase() : '';
            if (mediaType.startsWith(`${kind}/`)) return true;

            if (!Array.isArray(attachment?.url)) return false;

            return attachment.url.some((item: any) => {
              const itemMediaType = typeof item?.mediaType === 'string' ? item.mediaType.toLowerCase() : '';
              return itemMediaType.startsWith(`${kind}/`);
            });
          };

          const hasImageAttachments = () => (activityPubData.attachment || []).some((attachment: any) => attachmentHasKind(attachment, 'image'));
          const hasVideoAttachments = () => (activityPubData.attachment || []).some((attachment: any) => attachmentHasKind(attachment, 'video'));

          const markdown = typeof ech0Api.content === 'string' ? ech0Api.content : '';
          const extensionTypeRaw = typeof ech0Api.extension_type === 'string' ? ech0Api.extension_type.trim() : '';
          const extensionType = extensionTypeRaw && /^(MUSIC|VIDEO|WEBSITE|GITHUBPROJ)$/i.test(extensionTypeRaw)
            ? extensionTypeRaw.toUpperCase()
            : '';
          const extensionUrl = this.parseEch0ExtensionToUrl(ech0Api.extension, extensionType);

          // Prefer Ech0 API timestamp if present.
          if (typeof ech0Api.created_at === 'string' && ech0Api.created_at) {
            activityPubData.published = ech0Api.created_at;
          }

          // Use Markdown source from Ech0 API so the UI can render it consistently.
          // IMPORTANT: Ech0 Extension (WEBSITE/MUSIC/VIDEO/...) is separate and must not be injected into content.
          if (markdown && markdown.trim()) {
            activityPubData.source = { content: markdown, mediaType: 'text/markdown' };
            activityPubData.content = markdown;
          }

          // Map Ech0 tags -> ActivityPub tag array.
          if (Array.isArray(ech0Api.tags) && ech0Api.tags.length > 0) {
            const apiTags = ech0Api.tags
              .map((t: any) => (typeof t?.name === 'string' ? t.name.trim() : ''))
              .filter(Boolean);
            if (apiTags.length > 0) {
              activityPubData.tag = [
                ...(activityPubData.tag || []),
                ...apiTags.map((name: string) => ({
                  type: 'Hashtag',
                  name: name.startsWith('#') ? name : `#${name}`,
                  href: `https://${parsed.domain}/discover/tags/${encodeURIComponent(name.replace(/^#/, ''))}`,
                })),
              ];
            }
          }

          // Map Ech0 images -> ActivityPub attachments so our renderer shows them.
          if (!hasImageAttachments() && Array.isArray(ech0Api.images) && ech0Api.images.length > 0) {
            const images = ech0Api.images
              .map((img: any) => (typeof img?.image_url === 'string' ? img.image_url : ''))
              .filter(Boolean)
              // Ech0 images may include data:SVG placeholders in video posts; skip those as real media.
              .filter((u: string) => !String(u).trim().toLowerCase().startsWith('data:'))
              .map((u: string) => this.makeAbsoluteUrl(parsed.domain, u));

            if (images.length > 0) {
              const existing = new Set<string>(
                (activityPubData.attachment || [])
                  .map((att: any) => (typeof att?.url === 'string' ? this.normalizeUrlForDedupe(att.url) : ''))
                  .filter(Boolean),
              );

              const deduped: string[] = [];
              for (const url of images) {
                const key = this.normalizeUrlForDedupe(url);
                if (existing.has(key)) continue;
                if (deduped.some(u => this.normalizeUrlForDedupe(u) === key)) continue;
                deduped.push(url);
              }

              activityPubData.attachment = [
                ...(activityPubData.attachment || []),
                ...deduped.map((url: string) => ({
                  type: 'Image',
                  mediaType: url.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/*',
                  url,
                  name: 'Image',
                })),
              ];

              // NOTE: Ech0 extension is separate; even video URLs should not become attachments here,
              // or the extension block would render twice. Thumbnails are handled on the client.
            }
          }

          // Map Ech0 media (video/audio) -> ActivityPub attachments.
          if (Array.isArray(ech0Api.media) && ech0Api.media.length > 0) {
            // Ech0 Live Photo is usually an image + linked video (via live_video_id).
            // Treat as one media item to avoid an extra video in generated images.
            const liveVideoIds = new Set<number>(
              ech0Api.media
                .map((m: any) => (typeof m?.live_video_id === 'number' ? m.live_video_id : null))
                .filter((v: any) => typeof v === 'number') as number[],
            );
            const liveVideoUrls = new Set<string>(
              ech0Api.media
                .filter((m: any) => typeof m?.id === 'number' && liveVideoIds.has(m.id))
                .map((m: any) => (typeof m?.media_url === 'string' ? this.makeAbsoluteUrl(parsed.domain, m.media_url) : ''))
                .filter(Boolean)
                .map((u: string) => this.normalizeUrlForDedupe(u)),
            );

            // Some instances may already include the live video in ActivityPub attachments.
            // Remove it here so it never reaches universalData.attachments.
            if (liveVideoUrls.size > 0 && Array.isArray(activityPubData.attachment)) {
              activityPubData.attachment = activityPubData.attachment.filter((att: any) => {
                const t = typeof att?.type === 'string' ? att.type : '';
                const url = typeof att?.url === 'string' ? att.url : '';
                if (!t || !url) return true;
                if (t.toLowerCase() !== 'video') return true;
                return !liveVideoUrls.has(this.normalizeUrlForDedupe(url));
              });
            }

            if (hasVideoAttachments()) {
              // ActivityPub already supplied the video attachments we need.
              // Keep Ech0 media as fallback-only to avoid duplicate media cards.
            } else {
              const existing = new Set<string>(
                (activityPubData.attachment || [])
                  .map((att: any) => (typeof att?.url === 'string' ? this.normalizeUrlForDedupe(att.url) : ''))
                  .filter(Boolean),
              );

              const videos = ech0Api.media
                .map((m: any) => ({
                  type: typeof m?.media_type === 'string' ? m.media_type.toLowerCase() : '',
                  url: typeof m?.media_url === 'string' ? this.makeAbsoluteUrl(parsed.domain, m.media_url) : '',
                  id: typeof m?.id === 'number' ? m.id : null,
                }))
                .filter((m: {type: string; url: string; id: number | null}) => m.type === 'video' && m.url && !/^data:/i.test(m.url))
                .filter((m: {type: string; url: string; id: number | null}) => !(typeof m.id === 'number' && liveVideoIds.has(m.id)));

              if (videos.length > 0) {
                const toAdd = videos
                  .map((v: {type: string; url: string; id: number | null}) => v.url)
                  .filter((u: string) => !existing.has(this.normalizeUrlForDedupe(u)));

                if (toAdd.length > 0) {
                  activityPubData.attachment = [
                    ...(activityPubData.attachment || []),
                    ...toAdd.map((url: string) => ({
                      type: 'Video',
                      mediaType: 'video/*',
                      url,
                      name: 'Video',
                    })),
                  ];
                }
              }
            }
          }

          // Preserve Ech0 extension as structured data so the UI can render it in a dedicated section.
          // We'll attach it to the universal post later (after conversion), but keep data available here.
          if (extensionType && extensionUrl) {
            (activityPubData as any).__ech0Extension = { type: extensionType, url: extensionUrl };
          }
        }
      } catch {
        // Best-effort: fall back to ActivityPub-only parsing if API is unavailable.
      }

      // Enhanced content extraction for Ech0 from both HTML content and Markdown source
      
      
      

      let extractedLinks: { href: string; text: string }[] = [];
      let hashtags: any[] = [];
      let videos: any[] = [];

      // First, extract from HTML content (existing logic)
      if (activityPubData.content) {
        const htmlResult = this.extractEch0ContentFromHtml(activityPubData.content, parsed.domain);
        extractedLinks = [...extractedLinks, ...htmlResult.links];
        hashtags = [...hashtags, ...htmlResult.hashtags];
        videos = [...videos, ...htmlResult.videos];
      }

      // Then, extract links from Markdown source content (new logic for Ech0)
      if (activityPubData.source?.content && activityPubData.source.mediaType === 'text/markdown') {
        
        const markdownResult = this.extractEch0ContentFromMarkdown(activityPubData.source.content, parsed.domain);

        // Merge links, avoiding duplicates
        markdownResult.links.forEach(link => {
          const exists = extractedLinks.find(existing =>
            existing.href === link.href || existing.text === link.text
          );
          if (!exists) {
            extractedLinks.push(link);
          }
        });

        hashtags = [...hashtags, ...markdownResult.hashtags];
        videos = [...videos, ...markdownResult.videos];

        
        
      }

      
      

      // Add extracted tags to ActivityPub data
      if (hashtags.length > 0) {
        activityPubData.tag = [...(activityPubData.tag || []), ...hashtags];
        
      }

      // Add extracted videos to attachments
      if (videos.length > 0) {
        activityPubData.attachment = [...(activityPubData.attachment || []), ...videos];
      }

      // NOTE: We intentionally avoid appending extracted links/hashtags into content.
      // Ech0's /api/echo/<id> provides canonical extension links + tags; mutating content here risks URL truncation
      // and makes Markdown rendering inconsistent.

      // Special handling for Ech0: Add GitHub project link if "Ech0" is mentioned in the content
      // Add as plain text, not clickable link
      const contentText = activityPubData.content?.replace(/<[^>]*>/g, '') || '';
      const sourceContent = activityPubData.source?.content || '';
      const fullText = contentText + ' ' + sourceContent;

      if (/\bEch0\b/i.test(fullText)) {
        
        const ech0ProjectUrl = 'https://github.com/lin-snow/Ech0';

        // Add the link to the content as plain text URL
        if (!activityPubData.content?.includes('github.com/lin-snow/Ech0')) {
          activityPubData.content = (activityPubData.content || '') + '\n' + ech0ProjectUrl;
          
        }
      }

      

      // Convert to universal format
      // Debug: Log the ActivityPub data structure
      // Removed detailed debug output

      const universalData = await convertActivityPubToUniversal(activityPubData, parsed.domain);
      universalData.platform = 'ech0';

      // Attach structured extension extracted from Ech0 REST API (if present).
      const ext = (activityPubData as any).__ech0Extension;
      if (ext && typeof ext === 'object' && typeof ext.type === 'string' && typeof ext.url === 'string') {
        (universalData as any).extension = { type: ext.type, url: ext.url };
      }

      // If attributedTo is a string, try to resolve the account to get full details including avatar
      if (typeof activityPubData.attributedTo === 'string') {
        const acctUrl = activityPubData.attributedTo;
        const acctDomain = new URL(acctUrl).hostname;
        const acctUsername = acctUrl.split('/').pop();
        const fullAcct = `${acctUsername}@${acctDomain}`;

        const resolvedAccount = await FediverseClient.resolveAccount(fullAcct);
        if (resolvedAccount) {
          universalData.account = {
            ...universalData.account,
            ...resolvedAccount,
            platform: 'ech0', // Ensure platform is correct
          };
        }
      }

      return {
        success: true,
        data: universalData,
        platform: 'ech0',
      };
    } catch (error) {
      console.error('Ech0 fetch failed:', error);
      return await this.fetchActivityPubObject(parsed.domain, parsed.id);
    }
  }

  private static makeAbsoluteUrl(domain: string, url: string): string {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://${domain}${url}`;
    return `https://${domain}/${url}`;
  }

  private static parseEch0ExtensionToUrl(extension: any, extensionType?: string): string | null {
    if (!extension) return null;
    if (typeof extension === 'string') {
      const trimmed = extension.trim();
      if (!trimmed) return null;
      // Some instances store WEBSITE extension as a JSON string.
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const obj = JSON.parse(trimmed);
          const site = typeof obj?.site === 'string' ? obj.site : (typeof obj?.url === 'string' ? obj.url : '');
          return site?.trim() || null;
        } catch {
          return null;
        }
      }
      // For VIDEO type, convert BV/YouTube ID to full URL
      if (extensionType?.toUpperCase() === 'VIDEO') {
        // Bilibili BV format
        if (/^BV[a-zA-Z0-9]{10}$/.test(trimmed)) {
          return `https://www.bilibili.com/video/${trimmed}`;
        }
        // YouTube ID format (11 characters)
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
          return `https://www.youtube.com/watch?v=${trimmed}`;
        }
      }
      return trimmed;
    }
    if (typeof extension === 'object') {
      const site = typeof (extension as any).site === 'string' ? (extension as any).site : (typeof (extension as any).url === 'string' ? (extension as any).url : '');
      return site?.trim() || null;
    }
    return null;
  }

  private static async fetchEch0ApiEcho(domain: string, id: string): Promise<any | null> {
    // /api/echo/<id> appears to be the canonical public API for Ech0 posts (numeric IDs).
    const numericId = String(id || '').match(/^\d+$/) ? String(id) : null;
    if (!numericId) return null;

    const url = `https://${domain}/api/echo/${numericId}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    if (data.code !== 1 || !data.data) return null;
    return data.data;
  }

  private static normalizeUrlForDedupe(rawUrl: string): string {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      u.hash = '';
      const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from'];
      dropParams.forEach(p => u.searchParams.delete(p));
      const s = u.toString();
      return s.endsWith('/') ? s.slice(0, -1) : s;
    } catch {
      return raw;
    }
  }

  /**
   * Resolve account details from a Fediverse account identifier
   */
  private static async resolveAccount(acct: string): Promise<FediverseAccount | null> {
    try {
      const [username, domain] = acct.split('@');
      if (!username || !domain) return null;

      // Use WebFinger to resolve the account
      const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${acct}`;
      const response = await fetch(webfingerUrl);

      if (!response.ok) return null;

      const webfingerData = await response.json();
      const selfLink = webfingerData.links?.find((link: any) => link.rel === 'self' && link.type.includes('activity+json'));

      if (!selfLink?.href) return null;

      // Fetch the actor profile
      const actorResponse = await fetch(selfLink.href, {
        headers: {
          'Accept': 'application/activity+json',
        },
      });

      if (!actorResponse.ok) return null;

      const actorData = await actorResponse.json();

      // Convert to our account format
      return {
        id: actorData.id,
        username: actorData.preferredUsername,
        displayName: actorData.name || actorData.preferredUsername,
        avatar: actorData.icon?.url,
        url: actorData.url || actorData.id,
        acct: acct,
        platform: 'ech0',
        emojis: actorData.tag?.filter((tag: any) => tag.type === 'Emoji').map((emoji: any) => ({
          shortcode: emoji.name,
          url: emoji.icon.url,
          staticUrl: emoji.icon.url,
        })) || [],
      };
    } catch (error) {
      console.error('Failed to resolve account:', error);
      return null;
    }
  }

  /**
   * Generic ActivityPub object fetcher
   */
  private static async fetchActivityPubObject(domain: string, objectId: string): Promise<FetchPostResult> {
    try {
      // Try multiple possible URL patterns for ActivityPub objects
      const possibleUrls = [
        // Direct object URL
        objectId.startsWith('http') ? objectId : null,
        // Standard objects endpoint
        `https://${domain}/objects/${objectId}`,
        // Posts endpoint (common for Pixelfed and others)
        `https://${domain}/p/${objectId}`,
        // Notes endpoint (common for Misskey and others)
        `https://${domain}/notes/${objectId}`,
        // Statuses endpoint (Mastodon-style)
        `https://${domain}/statuses/${objectId}`,
      ].filter(Boolean);

      let activityPubData = null;
      let lastError = null;

      for (const url of possibleUrls) {
        if (!url) continue;
        try {
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
            },
          });

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('application/json') || contentType.includes('activity+json')) {
              try {
                activityPubData = await response.json();
                
                break;
              } catch (parseError) {
                lastError = parseError;
                continue;
              }
            }
          }
        } catch (e) {
          lastError = e;
          continue;
        }
      }

      if (!activityPubData) {
        return {
          success: false,
          error: `Unable to find ActivityPub data at this URL. This might not be a valid Fediverse post URL, or the instance may not be properly configured for ActivityPub.`,
          errorCode: ErrorCode.NOT_FOUND,
          suggestion: 'Please verify:\n1. The URL points to a specific post (not a user profile or main page)\n2. The platform supports ActivityPub federation\n3. The post is public (not private or deleted)\n4. For projects like Ech0, use their Fediverse instance URL (e.g., https://memo.vaaat.com) not their GitHub repository',
        };
      }

      // If this is not a Create object, try to get the associated object
      let postData = activityPubData;
      if (activityPubData.type === 'Create' && activityPubData.object) {
        if (typeof activityPubData.object === 'string') {
          // Fetch the actual object
          const objectResponse = await fetch(activityPubData.object, {
            headers: {
              'Accept': 'application/activity+json',
            },
          });

          if (objectResponse.ok) {
            postData = await objectResponse.json();
          }
        } else {
          postData = activityPubData.object;
        }
      }

      const universalData = await convertActivityPubToUniversal(postData, domain);

      return {
        success: true,
        data: universalData,
        platform: 'generic',
      };
    } catch (error) {
      console.error('Generic ActivityPub fetch failed:', error);
      return {
        success: false,
        error: `Failed to fetch ActivityPub data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorCode: ErrorCode.SERVER_ERROR,
        suggestion: 'This instance may not support public ActivityPub access or the post may be private.',
      };
    }
  }

  /**
   * Get a list of supported platforms for display
   */
  static getSupportedPlatforms(): { name: string; examples: string[] }[] {
    return [
      {
        name: 'Mastodon',
        examples: ['https://mastodon.social/@username/1234567890', 'https://mastodon.online/users/username/statuses/1234567890'],
      },
      {
        name: 'Pixelfed',
        examples: ['https://pixelfed.social/p/username/1234567890', 'https://pixelfed.social/@username/p/1234567890'],
      },
      {
        name: 'PeerTube',
        examples: ['https://peertube.tv/videos/watch/abc123-def456'],
      },
      {
        name: 'Pleroma',
        examples: ['https://pleroma.site/objects/abc123-def456', 'https://pleroma.site/notice/abc123'],
      },
      {
        name: 'Misskey',
        examples: ['https://misskey.io/notes/abc123def456'],
      },
      {
        name: 'Ech0',
        examples: ['https://your-ech0-instance.com/posts/post123', 'https://your-ech0-instance.com/objects/abc123-def456'],
      },
    ];
  }

  /**
   * Helper to extract content from Ech0 HTML
   */
  private static extractEch0ContentFromHtml(htmlContent: string, domain: string): {
    hashtags: any[];
    links: { href: string; text: string }[];
    videos: any[];
  } {
    const hashtags: any[] = [];
    const links: { href: string; text: string }[] = [];
    const videos: any[] = [];

    // Extract hashtags from HTML (strip tags to avoid matching color codes in attributes)
    const htmlTags = extractHashtagNames(htmlContent);
    htmlTags.forEach((tag: string) => {
      if (tag && tag.length > 0 && !hashtags.find(h => h.name === `#${tag}`)) {
        hashtags.push({
          type: 'Hashtag',
          name: `#${tag}`,
          href: `https://${domain}/discover/tags/${tag}`,
        });
      }
    });

    // Pattern 2: Look for hashtags in specific HTML structures
    const tagElements = htmlContent.match(/<[^>]*class="[^"]*tag[^"]*"[^>]*>([^<]+)<\/[^>]*>/gi) || [];
    for (const element of tagElements) {
      const tagMatch = element.match(/#([^\s<>]+)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        if (!hashtags.find(h => h.name === `#${tag}`)) {
          hashtags.push({
            type: 'Hashtag',
            name: `#${tag}`,
            href: `https://${domain}/discover/tags/${tag}`,
          });
        }
      }
    }

    // Extract links from HTML content
    const linkPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g;
    let linkMatch;
    while ((linkMatch = linkPattern.exec(htmlContent)) !== null) {
      const href = linkMatch[1];
      const text = linkMatch[2];
      if (href && text && !href.startsWith('#')) {
        links.push({ href, text });
      }
    }

    // Extract videos/iframes
    const iframePattern = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/g;
    let iframeMatch;
    while ((iframeMatch = iframePattern.exec(htmlContent)) !== null) {
      const src = iframeMatch[1];
      if (src) {
        videos.push({
          type: 'Video',
          mediaType: 'text/html',
          url: src,
          name: 'Video content',
        });
      }
    }

    return { hashtags, links, videos };
  }

  /**
   * Helper to extract content from Ech0 Markdown source
   */
  private static extractEch0ContentFromMarkdown(markdownContent: string, domain: string): {
    hashtags: any[];
    links: { href: string; text: string }[];
    videos: any[];
  } {
    const hashtags: any[] = [];
    const links: { href: string; text: string }[] = [];
    const videos: any[] = [];

    

    // Extract hashtags from Markdown (strip tags to avoid matching color codes in attributes)
    const markdownTags = extractHashtagNames(markdownContent);
    markdownTags.forEach((tag: string) => {
      if (tag && tag.length > 0 && !hashtags.find(h => h.name === `#${tag}`)) {
        hashtags.push({
          type: 'Hashtag',
          name: `#${tag}`,
          href: `https://${domain}/discover/tags/${tag}`,
        });
      }
    });

    // Extract links from Markdown - multiple patterns
    // Pattern 1: Standard Markdown links [text](url)
    const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let linkMatch;
    while ((linkMatch = markdownLinkPattern.exec(markdownContent)) !== null) {
      const text = linkMatch[1];
      const href = linkMatch[2];
      if (href && text && !href.startsWith('#')) {
        links.push({ href, text });
      }
    }

    // Pattern 2: Standalone URLs (bare links)
    const urlPattern = /(?<![\[\(])\b(https?:\/\/[^\s<]+)(?![\]\)])/gi;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(markdownContent)) !== null) {
      const href = urlMatch[1];
      if (href && !links.find(l => l.href === href)) {
        // Use URL as text if no other text available
        links.push({ href, text: href });
      }
    }

    

    return { hashtags, links, videos };
  }

}
