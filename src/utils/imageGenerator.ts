/**
 * Image generation utility for template exports
 */

import { domCache } from './domCache';
import { templateManager } from './templateManager';
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

      // Create cloned element for image generation
      const clone = this.createPreviewClone(originalNode);
      const container = this.createTempContainer(clone);

      // Wait for images to fully load
      await this.waitForImages(container);

      // Generate image
      const dataUrl = await this.generateImage(container, clone, {
        quality,
        pixelRatio,
        backgroundColor,
      });

      // Download image
      this.downloadImage(dataUrl);

    } catch (error) {
      console.error('Image generation failed:', error);
      this.showError('Image generation failed. Please try again.');
    } finally {
      this.resetDownloadButton();
      this.cleanup();
    }
  }

  /**
   * Create a clone of the preview element
   */
  private createPreviewClone(originalNode: Element): HTMLElement {
    const clone = originalNode.cloneNode(true) as HTMLElement;

    // Remove preview card borders only, keep other styles
    clone.classList.remove('preview-card', 'border', 'rounded-xl');

    // Set fixed width, auto height
    clone.style.width = `${IMAGE_CONFIG.MAX_WIDTH}px`;
    clone.style.maxWidth = `${IMAGE_CONFIG.MAX_WIDTH}px`;
    clone.style.minWidth = `${IMAGE_CONFIG.MAX_WIDTH}px`;

    // Auto height for content
    clone.style.height = 'auto';
    clone.style.minHeight = 'auto';
    clone.style.maxHeight = 'none';

    // Ensure content displays correctly
    clone.style.display = 'flex';
    clone.style.flexDirection = 'column';
    clone.style.visibility = 'visible';
    clone.style.opacity = '1';

    return clone;
  }

  /**
   * Create temporary container for image generation
   */
  private createTempContainer(clone: HTMLElement): HTMLElement {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-10000px';
    container.style.top = '-10000px';
    container.style.width = `${IMAGE_CONFIG.MAX_WIDTH}px`; 
    container.style.height = 'auto'; // Auto height for content
    container.style.minHeight = 'auto'; // No minimum height set
    container.style.zIndex = '-9999';
    container.style.backgroundColor = templateManager.getTemplateBackgroundColor();
    container.style.padding = '0'; 
    container.style.boxSizing = 'border-box';
    container.appendChild(clone);
    document.body.appendChild(container);

    return container;
  }

  /**
   * Generate image from DOM element
   */
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

    // Wait for a short time to ensure complete layout rendering
    await new Promise(resolve => setTimeout(resolve, 100));

    const dataUrl = await toPng(clone, {
      quality: options.quality,
      pixelRatio: options.pixelRatio,
      cacheBust: true,
      backgroundColor: options.backgroundColor,
      width: IMAGE_CONFIG.MAX_WIDTH,
      // Keep 670px width, increase PPI through pixelRatio
      // Do not set height, let content adapt height
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
      },
      filter: (node: Node) => {
        // Filter out elements that might cause issues
        return node.nodeName !== 'SCRIPT';
      },
    });

    return dataUrl;
  }

  /**
   * Download image with filename
   */
  private downloadImage(dataUrl: string): void {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    link.download = `tootpic-${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  }

  /**
   * Set download button state
   */
  private setDownloadButtonState(text: string): void {
    if (this.downloadBtn) {
      this.downloadBtn.disabled = true;
      this.downloadBtn.textContent = text;
    }
  }

  /**
   * Reset download button
   */
  private resetDownloadButton(): void {
    if (this.downloadBtn) {
      this.downloadBtn.disabled = false;
      this.downloadBtn.textContent = 'Download';
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    // You can implement a toast notification or error display here
    console.error(message);
    alert(message); // Fallback for now
  }

  /**
   * Wait for all images to load
   */
  private async waitForImages(container: HTMLElement): Promise<void> {
    const images = container.querySelectorAll('img');
    const imagePromises = Array.from(images).map(img => {
      return new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Continue even if loading fails
          // Set timeout to avoid infinite waiting
          setTimeout(() => resolve(), 3000);
        }
      });
    });

    await Promise.all(imagePromises);

    // Additional wait to ensure rendering completion
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Cleanup temporary elements
   */
  private cleanup(): void {
    const tempContainers = document.querySelectorAll('[style*="z-index: -9999"]');
    tempContainers.forEach(container => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });
  }

  /**
   * Destroy generator
   */
  destroy(): void {
    this.downloadBtn = null;
  }
}

// Singleton instance
export const imageGenerator = new ImageGenerator();
