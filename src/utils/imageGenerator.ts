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
      console.error('Image generation failed:', error);
      this.showError('Image generation failed. Please try again.');
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

    await new Promise(resolve => setTimeout(resolve, 100));

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
      return new Promise<void>((resolve) => {
        const imgElement = img as HTMLImageElement;
        const originalUrl = this.extractOriginalUrl(imgElement.src, corsProxy);

        if (resourceLoader.isImageCached(originalUrl)) {
          resolve();
          return;
        }

        if (imgElement.complete) {
          resolve();
        } else {
          imgElement.onload = () => resolve();
          imgElement.onerror = () => resolve();
          setTimeout(() => resolve(), 2000);
        }
      });
    });

    await Promise.all(imagePromises);

    await new Promise(resolve => setTimeout(resolve, 200));
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
