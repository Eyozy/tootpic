/**
 * Lightweight DOM access helper, directly delegating to native document methods.
 */
export class DOMCache {
  getElement<T extends Element>(id: string): T | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById(id) as T | null;
  }

  querySelector<T extends Element>(selector: string): T | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector(selector) as T | null;
  }

  querySelectorAll<T extends Element>(selector: string): NodeListOf<T> {
    if (typeof document === 'undefined') return [] as unknown as NodeListOf<T>;
    return document.querySelectorAll(selector) as NodeListOf<T>;
  }

  destroy(): void {}
}

export const domCache = new DOMCache();