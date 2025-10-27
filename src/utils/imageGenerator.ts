/**
 * Image generation utility for template exports
 */

import { domCache } from './domCache';
import { templateManager } from './templateManager';
import { resourceLoader } from './resourceLoader';
import { API_CONFIG, IMAGE_CONFIG } from '../constants';
import { toPng } from 'html-to-image';

export interface GenerationOptions {
  quality?: number;
  pixelRatio?: number;
  backgroundColor?: string;
}

export class ImageGenerator {
  private downloadBtn: HTMLButtonElement | null = null;

  constructor() {
    this.downloadBtn = domCache.getElement('download-btn');
  }

  /**
   * Generate and download image
   */
  async generateAndDownload(options: GenerationOptions = {}): Promise<void> {
    const {
      quality = API_CONFIG.IMAGE_QUALITY,
      pixelRatio = API_CONFIG.IMAGE_PIXEL_RATIO,
      backgroundColor = templateManager.getTemplateBackgroundColor(),
    } = options;

    const originalNode = domCache.getElement('style-a-container');
    if (!originalNode) {
      throw new Error('Preview container not found');
    }

    if (!this.downloadBtn) {
      throw new Error('Download button not found');
    }

    try {
      this.setDownloadButtonState('Preparing...');

      const clone = this.createPreviewClone(originalNode);
      const container = this.createTempContainer(clone);

      await this.waitForImages(container);

      const dataUrl = await this.generateImage(container, clone, {
        quality,
        pixelRatio,
        backgroundColor,
      });

      this.downloadImage(dataUrl);

    } catch (error) {
      console.error('Detailed image generation error:', error);
      // More specific error messages
      if (error instanceof Error) {
        if (error.message.includes('cssRules') || error.message.includes('CSSStyleSheet')) {
          this.showError('CSS loading issue. Please refresh and try again.');
        } else if (error.message.includes('timeout') || error.message.includes('failed to load')) {
          this.showError('Resource loading failed. Check your connection and try again.');
        } else {
          this.showError('Image generation failed. Please try again.');
        }
      } else {
        this.showError('Image generation failed. Please try again.');
      }
    } finally {
      this.resetDownloadButton();
      this.cleanup();
    }
  }

  private createPreviewClone(originalNode: Element): HTMLElement {
    const clone = originalNode.cloneNode(true) as HTMLElement;

    clone.classList.remove('preview-card', 'border', 'rounded-xl');

    clone.style.width = `${IMAGE_CONFIG.MAX_WIDTH}px`;
    clone.style.maxWidth = `${IMAGE_CONFIG.MAX_WIDTH}px`;
    clone.style.minWidth = `${IMAGE_CONFIG.MAX_WIDTH}px`;

    clone.style.height = 'auto';
    clone.style.minHeight = 'auto';
    clone.style.maxHeight = 'none';

    clone.style.display = 'flex';
    clone.style.flexDirection = 'column';
    clone.style.visibility = 'visible';
    clone.style.opacity = '1';

    return clone;
  }

  private createTempContainer(clone: HTMLElement): HTMLElement {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-10000px';
    container.style.top = '-10000px';
    container.style.width = `${IMAGE_CONFIG.MAX_WIDTH}px`;
    container.style.height = 'auto';
    container.style.minHeight = 'auto';
    container.style.zIndex = '-9999';
    container.style.backgroundColor = templateManager.getTemplateBackgroundColor();
    container.style.padding = '0';
    container.style.boxSizing = 'border-box';
    container.appendChild(clone);
    document.body.appendChild(container);

    return container;
  }

  private async inlineInterCSS(clone: HTMLElement): Promise<void> {
    try {
      // Use multiple reliable CDN sources as fallback
      const cssSources = [
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.17/css/inter.min.css',
        'https://unpkg.com/@fontsource/inter@5.0.17/css/inter.min.css'
      ];

      let cssText = '';
      let loaded = false;

      for (const cssUrl of cssSources) {
        try {
          const response = await fetch(cssUrl, {
            mode: 'cors',
            credentials: 'omit'
          });
          
          if (response.ok) {
            cssText = await response.text();
            loaded = true;
            break;
          }
        } catch (e) {
          console.warn(`Failed to load CSS from ${cssUrl}:`, e);
          continue;
        }
      }

      if (!loaded || !cssText) {
        console.warn('All CSS sources failed, using fallback Inter font stack');
        return;
      }

      // Create style element and inject CSS
      const style = document.createElement('style');
      style.textContent = cssText;
      style.setAttribute('data-inter-inline', 'true');
      (clone.ownerDocument || document).head.appendChild(style);

      // Remove conflicting existing Inter links
      const existingLinks = (clone.ownerDocument || document).querySelectorAll('link[href*="inter"], link[href*="Inter"], link[href*="fonts.googleapis"]');
      existingLinks.forEach(link => link.remove());

    } catch (error) {
      console.error('Failed to inline Inter CSS:', error);
      // Don't throw error, continue execution - use system font as fallback
    }
  }

  private async replaceBrokenImages(clone: HTMLElement): Promise<void> {
    const images = clone.querySelectorAll('img');
    const fallbackSrc = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDUiIGhlaWdodD0iNDUiIHZpZXdCb3g9IjAgMCA0NSA0NSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjIuNSIgY3k9IjIyLjUiIHI9IjIyLjUiIGZpbGw9IiM5Q0FiQjIiLz4KPGNpcmNsZSBjeD0iMjIuNSIgY3k9IjIyLjUiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4='; // Better looking default avatar placeholder

    const replacements = Array.from(images).map(img => {
      return new Promise<void>((resolve) => {
        const imgElement = img as HTMLImageElement;

        // Skip images that are already data URLs or SVG placeholders
        if (imgElement.src.startsWith('data:') || imgElement.src.includes('PHN2ZyB3aWR0aD0iNDU')) {
          resolve();
          return;
        }

        // Handle proxy URLs
        let originalUrl = imgElement.src;
        if (originalUrl.includes('corsproxy.io')) {
          const urlParts = originalUrl.split('corsproxy.io/?');
          if (urlParts.length > 1) {
            originalUrl = decodeURIComponent(urlParts[1]);
          }
        } else if (originalUrl.includes('cors.eu.org')) {
          originalUrl = originalUrl.replace('https://cors.eu.org/', '');
        }

        // Test if the image can be loaded
        const testImg = new Image();
        testImg.crossOrigin = 'anonymous';

        testImg.onload = () => {
          // Image loaded successfully, keep original URL
          resolve();
        };

        testImg.onerror = () => {
          // Image failed to load, replace with placeholder
          console.warn(`Replacing broken image: ${originalUrl}`);
          imgElement.src = fallbackSrc;
          
          // Ensure placeholder displays correctly
          imgElement.onerror = null; // Prevent infinite loop
          resolve();
        };

        // Start loading test by setting image source
        testImg.src = originalUrl;
      });
    });

    await Promise.all(replacements);
  }

  private async generateImage(
    container: HTMLElement,
    clone: HTMLElement,
    options: {
      quality: number;
      pixelRatio: number;
      backgroundColor: string;
    }
  ): Promise<string> {
    this.setDownloadButtonState('Generating...');

    try {
      // Inline Inter CSS first to avoid remote stylesheet issues
      await this.inlineInterCSS(clone);

      // Replace any broken images before toPng
      await this.replaceBrokenImages(clone);

      const dataUrl = await toPng(clone, {
        quality: options.quality,
        pixelRatio: options.pixelRatio,
        cacheBust: true,
        backgroundColor: options.backgroundColor,
        width: IMAGE_CONFIG.MAX_WIDTH,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
        },
        filter: (node: Node) => {
          return node.nodeName !== 'SCRIPT';
        },
      });

      return dataUrl;
    } finally {
      // Clean up inline styles
      const inlinedStyle = (clone.ownerDocument || document).querySelector('style[data-inter-inline]');
      if (inlinedStyle) {
        inlinedStyle.remove();
      }
    }
  }

  private downloadImage(dataUrl: string): void {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    link.download = `tootpic-${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  }

  private setDownloadButtonState(text: string): void {
    if (this.downloadBtn) {
      this.downloadBtn.disabled = true;
      this.downloadBtn.textContent = text;
    }

    const previewStatus = domCache.getElement('preview-status') as HTMLSpanElement;
    if (previewStatus) {
      previewStatus.textContent = text;
      previewStatus.className = 'text-sm text-blue-600';
    }
  }

  private resetDownloadButton(): void {
    if (this.downloadBtn) {
      this.downloadBtn.disabled = false;
      this.downloadBtn.textContent = 'Download Image';
    }

    const previewStatus = domCache.getElement('preview-status') as HTMLSpanElement;
    if (previewStatus) {
      previewStatus.textContent = 'Preview loaded successfully';
      previewStatus.className = 'text-sm text-green-600';
    }
  }

  private showError(message: string): void {
    console.error(message);
    alert(message);
  }

  private async waitForImages(container: HTMLElement): Promise<void> {
    const images = container.querySelectorAll('img');
    const corsProxy = resourceLoader.getCorsProxy();

    const imagePromises = Array.from(images).map(img => {
      return new Promise<void>((resolve, reject) => {
        const imgElement = img as HTMLImageElement;
        const originalUrl = this.extractOriginalUrl(imgElement.src, corsProxy);

        if (resourceLoader.isImageCached(originalUrl)) {
          resolve();
          return;
        }

        if (imgElement.complete && imgElement.naturalHeight !== 0) {
          resolve();
          return;
        }

        const fallbackSrc = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDUiIGhlaWdodD0iNDUiIHZpZXdCb3g9IjAgMCA0NSA0NSIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjIuNSIgY3k9IjIyLjUiIHI9IjIyLjUiIGZpbGw9IiM5Q0FiQjIiLz4KPGNpcmNsZSBjeD0iMjIuNSIgY3k9IjIyLjUiIHI9IjE4IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4='; // Better looking default avatar placeholder

        let timeoutId: NodeJS.Timeout;

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          imgElement.onload = null;
          imgElement.onerror = null;
        };

        imgElement.onload = () => {
          cleanup();
          resolve();
        };

        imgElement.onerror = () => {
          cleanup();
          console.warn(`Image failed to load, using fallback: ${originalUrl}`);
          imgElement.src = fallbackSrc;
          imgElement.onerror = null; // Prevent infinite loop
          resolve();
        };

        // Set timeout to prevent permanent waiting, increased to 10 seconds
        timeoutId = setTimeout(() => {
          cleanup();
          console.warn(`Image loading timeout: ${originalUrl}`);
          imgElement.src = fallbackSrc;
          resolve();
        }, 10000);
      });
    });

    await Promise.all(imagePromises);
  }

  private extractOriginalUrl(proxiedUrl: string, corsProxy: string): string {
    if (proxiedUrl.startsWith(corsProxy)) {
      return proxiedUrl.substring(corsProxy.length);
    }
    return proxiedUrl;
  }

  private cleanup(): void {
    const tempContainers = document.querySelectorAll('[style*="z-index: -9999"]');
    tempContainers.forEach(container => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });
  }

  destroy(): void {
    this.downloadBtn = null;
  }
}

export const imageGenerator = new ImageGenerator();
