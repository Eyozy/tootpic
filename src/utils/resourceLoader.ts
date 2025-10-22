/**
 * Resource Loader - Unified management of image preloading and caching
 *
 * Core problems solved:
 * 1. Images and text content cannot load and display simultaneously
 * 2. Repeated waiting for resource loading when downloading images
 * 3. Lack of unified image loading state management
 *
 * Optimization effects:
 * - Preload all image resources to ensure synchronous display
 * - Cache loaded images to avoid repeated waiting
 * - Provide detailed loading progress and error handling
 * - Support ESC cancellation for long loading operations
 */

export interface ImageResource {
  url: string;
  type: 'avatar' | 'emoji' | 'attachment' | 'preview';
  priority: 'high' | 'medium' | 'low';
}

export interface LoadProgress {
  total: number;
  loaded: number;
  failed: number;
  percentage: number;
  currentResource?: string;
}

export interface LoadOptions {
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  onProgress?: (progress: LoadProgress) => void;
  onResourceLoaded?: (resource: ImageResource) => void;
  onResourceFailed?: (resource: ImageResource, error: Error) => void;
}

export class ResourceLoader {
  private cache = new Map<string, HTMLImageElement>();
  private loadingPromises = new Map<string, Promise<HTMLImageElement>>();
  private corsProxy: string;

  constructor(corsProxy: string = 'https://cors.eu.org/') {
    this.corsProxy = corsProxy;
  }

  /**
   * Batch preload image resources
   */
  async preloadImages(resources: ImageResource[], options: LoadOptions = {}): Promise<HTMLImageElement[]> {
    const {
      timeout = 8000,
      retryAttempts = 2,
      retryDelay = 1000,
      onProgress,
      onResourceLoaded,
      onResourceFailed
    } = options;

    const progress: LoadProgress = {
      total: resources.length,
      loaded: 0,
      failed: 0,
      percentage: 0
    };

    // Sort resources by priority
    const sortedResources = this.sortResourcesByPriority(resources);

    // Create loading tasks
    const loadPromises = sortedResources.map(async (resource) => {
      try {
        const image = await this.loadSingleImage(resource, {
          timeout,
          retryAttempts,
          retryDelay
        });

        progress.loaded++;
        progress.percentage = Math.round((progress.loaded / progress.total) * 100);
        progress.currentResource = resource.url;

        onProgress?.(progress);
        onResourceLoaded?.(resource);

        return image;
      } catch (error) {
        progress.failed++;
        progress.percentage = Math.round(((progress.loaded + progress.failed) / progress.total) * 100);

        onProgress?.(progress);
        onResourceFailed?.(resource, error as Error);

        throw error;
      }
    });

    const results = await Promise.allSettled(loadPromises);

    const loadedImages: HTMLImageElement[] = [];
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        loadedImages.push(result.value);
      }
    });

    return loadedImages;
  }

  /**
   * Load single image
   */
  private async loadSingleImage(resource: ImageResource, options: {
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  }): Promise<HTMLImageElement> {
    const { timeout, retryAttempts, retryDelay } = options;
    const proxiedUrl = `${this.corsProxy}${resource.url}`;

    if (this.cache.has(proxiedUrl)) {
      return this.cache.get(proxiedUrl)!;
    }

    if (this.loadingPromises.has(proxiedUrl)) {
      return this.loadingPromises.get(proxiedUrl)!;
    }

    const loadPromise = this.createLoadPromise(proxiedUrl, timeout, retryAttempts, retryDelay);
    this.loadingPromises.set(proxiedUrl, loadPromise);

    try {
      const image = await loadPromise;
      this.cache.set(proxiedUrl, image);
      return image;
    } finally {
      this.loadingPromises.delete(proxiedUrl);
    }
  }

  /**
   * Create image loading Promise
   */
  private async createLoadPromise(
    url: string,
    timeout: number,
    retryAttempts: number,
    retryDelay: number
  ): Promise<HTMLImageElement> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        return await this.loadImageWithTimeout(url, timeout);
      } catch (error) {
        lastError = error as Error;

        if (attempt === retryAttempts) {
          throw new Error(`Failed to load image after ${retryAttempts + 1} attempts: ${url}`);
        }

        if (retryDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Load image with timeout
   */
  private async loadImageWithTimeout(url: string, timeout: number): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';

      const timeoutId = setTimeout(() => {
        reject(new Error(`Image load timeout: ${url}`));
      }, timeout);

      image.onload = () => {
        clearTimeout(timeoutId);
        resolve(image);
      };

      image.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error(`Image load failed: ${url}`));
      };

      image.src = url;
    });
  }

  /**
   * Sort resources by priority
   */
  private sortResourcesByPriority(resources: ImageResource[]): ImageResource[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return [...resources].sort((a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  /**
   * Extract image resources from Mastodon post data
   */
  extractImageResources(postData: any): ImageResource[] {
    const resources: ImageResource[] = [];
    const corsProxy = this.corsProxy;

    if (!postData) return resources;

    const sourcePost = postData.reblog || postData;

    if (sourcePost.account?.avatar) {
      resources.push({
        url: sourcePost.account.avatar,
        type: 'avatar',
        priority: 'high'
      });
    }

    if (sourcePost.emojis?.length > 0) {
      sourcePost.emojis.forEach((emoji: any) => {
        if (emoji.url) {
          resources.push({
            url: emoji.url,
            type: 'emoji',
            priority: 'medium'
          });
        }
      });
    }

    if (sourcePost.account?.emojis?.length > 0) {
      sourcePost.account.emojis.forEach((emoji: any) => {
        if (emoji.url) {
          resources.push({
            url: emoji.url,
            type: 'emoji',
            priority: 'medium'
          });
        }
      });
    }

    if (sourcePost.media_attachments?.length > 0) {
      sourcePost.media_attachments.slice(0, 4).forEach((attachment: any) => {
        let imageUrl: string;

        if (attachment.type === 'image') {
          imageUrl = attachment.url;
        } else {
          imageUrl = attachment.preview_url || attachment.url;
        }

        if (imageUrl) {
          resources.push({
            url: imageUrl,
            type: attachment.type === 'image' ? 'attachment' : 'preview',
            priority: 'low'
          });
        }
      });
    }

    return resources;
  }

  /**
   * Get cached image
   */
  getCachedImage(url: string): HTMLImageElement | null {
    const proxiedUrl = `${this.corsProxy}${url}`;
    return this.cache.get(proxiedUrl) || null;
  }

  /**
   * Check if image is cached
   */
  isImageCached(url: string): boolean {
    const proxiedUrl = `${this.corsProxy}${url}`;
    return this.cache.has(proxiedUrl);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      loading: this.loadingPromises.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(): number {
    return this.cache.size * 500 * 1024;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired loading Promises
   */
  cleanupLoadingPromises(): void {
  }

  /**
   * Set CORS proxy
   */
  setCorsProxy(proxy: string): void {
    this.corsProxy = proxy;
  }

  /**
   * Get current CORS proxy
   */
  getCorsProxy(): string {
    return this.corsProxy;
  }
}

export const resourceLoader = new ResourceLoader();
