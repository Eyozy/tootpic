/**
 * DOM element caching utility for performance optimization
 */

export class DOMCache {
  private cache = new Map<string, Element>();
  private observer?: MutationObserver;

  constructor() {
    this.setupObserver();
  }

  /**
   * Get element from cache or query DOM
   */
  getElement<T extends Element>(id: string): T | null {
    if (!this.cache.has(id)) {
      const element = document.getElementById(id) as unknown as T;
      if (element) {
        this.cache.set(id, element);
      }
      return element;
    }
    return this.cache.get(id) as T | null;
  }

  /**
   * Get element by selector with caching
   */
  querySelector<T extends Element>(selector: string): T | null {
    if (!this.cache.has(selector)) {
      const element = document.querySelector(selector) as unknown as T;
      if (element) {
        this.cache.set(selector, element);
      }
      return element;
    }
    return this.cache.get(selector) as T | null;
  }

  /**
   * Get elements by selector with caching
   */
  querySelectorAll<T extends Element>(selector: string): NodeListOf<T> {
    return document.querySelectorAll(selector) as NodeListOf<T>;
  }

  /**
   * Clear cache for specific element
   */
  clearCache(id: string): void {
    this.cache.delete(id);
  }

  /**
   * Clear entire cache
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Setup mutation observer to clear cache when DOM changes
   */
  private setupObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Clear cache for removed elements
              this.cache.forEach((cachedElement, key) => {
                if (cachedElement === element || element.contains(cachedElement)) {
                  this.cache.delete(key);
                }
              });
            }
          });
        }
      });
    });

    // Observe entire document for changes
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Destroy observer and cleanup
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = undefined;
    }
    this.clearAllCache();
  }
}

// Singleton instance
export const domCache = new DOMCache();