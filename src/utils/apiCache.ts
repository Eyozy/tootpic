/**
 * LRU (Least Recently Used) cache implementation
 * Prevents memory leaks and improves API response speed
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private ttl: number; // Time to live in milliseconds

  /**
   * Create LRU cache instance
   * @param maxSize Maximum number of cache entries (default: 100)
   * @param ttlMinutes Cache expiration time in minutes (default: 30)
   */
  constructor(maxSize: number = 100, ttlMinutes: number = 30) {
    this.maxSize = maxSize;
    this.ttl = ttlMinutes * 60 * 1000;
  }

  /**
   * Get cached data
   * @param key Cache key
   * @returns Cached data, or null if not found or expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // LRU strategy: Move accessed entry to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  /**
   * Set cached data
   * @param key Cache key
   * @param data Data to cache
   */
  set(key: string, data: T): void {
    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.ttl
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired cache entries (called periodically for garbage collection)
   */
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[LRUCache] Cleaned ${cleanedCount} expired entries, remaining: ${this.cache.size}`);
    }
  }

  getStats(): {
    size: number;
    maxSize: number;
    usage: string;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.cache.values());

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: `${((this.cache.size / this.maxSize) * 100).toFixed(1)}%`,
      oldestEntry: entries.length > 0 ? entries[0].timestamp : null,
      newestEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null
    };
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Set cache with custom TTL
   * @param key Cache key
   * @param data Data to cache
   * @param ttlMinutes Custom expiration time in minutes
   */
  setWithCustomTTL(key: string, data: T, ttlMinutes: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const customTTL = ttlMinutes * 60 * 1000;
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + customTTL
    });
  }
}

/**
 * Fediverse API cache instance (100 posts, 30 min TTL)
 */
export const fediverseApiCache = new LRUCache<any>(100, 30);

// Cleanup expired entries every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    fediverseApiCache.cleanup();
  }, 10 * 60 * 1000);
}
