import { domCache } from './domCache';
import { templateManager } from './templateManager';
import { API_CONFIG, IMAGE_CONFIG } from '../constants';
import { snapdom } from '@zumer/snapdom';

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
   * Generates and downloads an image.
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

    let generationSuccess = false;
    let copySuccess = false;

    try {
      this.setDownloadButtonState('Preparing...');

      const clone = this.createPreviewClone(originalNode);
      const container = this.createTempContainer(clone);

      const dataUrl = await this.generateImage(clone, {
        quality,
        pixelRatio,
        backgroundColor,
      });

      this.downloadImage(dataUrl);
      generationSuccess = true;

      const altTextCopyToggle = document.getElementById('alt-text-copy-toggle') as HTMLInputElement;
      if (altTextCopyToggle?.checked) {
        copySuccess = await this.copyAltTextToClipboard();
      }

    } catch (error) {
      console.error('Detailed image generation error:', error);
      this.showError('Image generation failed, please try again.');
    } finally {
      this.resetDownloadButton(generationSuccess, copySuccess);
      this.cleanup();
    }
  }

  private createPreviewClone(originalNode: Element): HTMLElement {
    const clone = originalNode.cloneNode(true) as HTMLElement;
    clone.classList.remove('preview-card', 'border', 'rounded-xl');
    clone.style.border = '1px solid var(--brand-gray-200, #e5e7eb)';
    
    // [Crucial change] Set border-radius to 0 to remove rounded corners from the downloaded image
    clone.style.borderRadius = '0';

    clone.style.backgroundColor = templateManager.getTemplateBackgroundColor();
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

    // Handle content warning visibility in image generation
    this.handleContentWarningInImage(clone);

    return clone;
  }

  /**
   * Handle content warning banner visibility in image generation
   */
  private handleContentWarningInImage(clone: HTMLElement): void {
    const contentWarningToggle = document.getElementById('content-warning-toggle') as HTMLInputElement;
    const contentWarningBanner = clone.querySelector('#content-warning-banner') as HTMLElement;
    const contentWarningText = clone.querySelector('#content-warning-text') as HTMLElement;

    if (contentWarningBanner) {
      // Check if the user has enabled content warning in images
      const userWantsWarning = contentWarningToggle?.checked;

      // Check if the post actually has content warning by checking if the control is visible
      const hasPostWarning = document.getElementById('content-warning-toggle-container')?.classList.contains('hidden') === false;

      // Check if there's actual warning content
      const hasContent = contentWarningText && contentWarningText.textContent.trim() !== '';

      // Show banner if: user wants it AND post has warning AND content is not empty
      const shouldShowInImage = userWantsWarning && hasPostWarning && hasContent;

      if (!shouldShowInImage) {
        // Remove the banner completely for clean image generation
        contentWarningBanner.remove();
      } else {
        // Ensure banner is properly visible for image generation
        // Reset all animation and transition states
        contentWarningBanner.classList.remove('hidden');
        contentWarningBanner.style.display = 'block';
        contentWarningBanner.style.visibility = 'visible';
        contentWarningBanner.style.opacity = '1';
        contentWarningBanner.style.maxHeight = 'none';
        contentWarningBanner.style.minHeight = 'auto';
        contentWarningBanner.style.height = 'auto';
        contentWarningBanner.style.overflow = 'visible';

        // Ensure proper spacing
        contentWarningBanner.style.marginTop = '12px';
        contentWarningBanner.style.marginBottom = '12px';
        contentWarningBanner.style.paddingTop = '12px';
        contentWarningBanner.style.paddingBottom = '12px';
      }
    }
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
    clone: HTMLElement,
    options: {
      quality: number;
      pixelRatio: number;
      backgroundColor: string;
    }
  ): Promise<string> {
    this.setDownloadButtonState('Generating...');
    
    // snapdom returns an <img> element, we need to extract the src attribute.
    const imgElement = await snapdom.toPng(clone, {
      quality: options.quality,
      dpr: options.pixelRatio, // `pixelRatio` is renamed to `dpr`
      backgroundColor: options.backgroundColor,
      width: IMAGE_CONFIG.MAX_WIDTH,
      // The `style` option is no longer needed as `scale: 1` is the default behavior.
      filter: (node: Node) => node.nodeName !== 'SCRIPT',
    });

    return imgElement.src;
  }

  private downloadImage(dataUrl: string): void {
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    link.download = `tootpic-${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  }

  private async copyAltTextToClipboard(): Promise<boolean> {
    const contentEl = domCache.getElement('style-a-content');
    const cwBannerEl = domCache.getElement('content-warning-banner');
    const cwTextEl = domCache.getElement('content-warning-text');

    if (!contentEl) {
      console.warn('Content element for alt text not found.');
      return false;
    }

    let altText = '';
    // Check if Content Warning (CW) exists and is visible
    const isCwVisible = cwBannerEl && !cwBannerEl.classList.contains('hidden');

    // If Content Warning exists, add its text to altText
    if (isCwVisible && cwTextEl && cwTextEl.textContent) {
      altText += `CW: ${cwTextEl.textContent.trim()}\n\n`;
    }

    // Use innerText to preserve line breaks and formatting for screen readers
    altText += (contentEl as HTMLElement).innerText;

    if (!altText.trim()) {
      console.warn('Alt text content is empty.');
      return false;
    }

    try {
      // Call browser API to write text to clipboard
      await navigator.clipboard.writeText(altText.trim());
      return true;
    } catch (err) {
      console.error('Failed to copy alt text to clipboard:', err);
      this.showError('Could not copy alt text. Please copy it manually.');
      return false;
    }
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

  private resetDownloadButton(generationSuccess: boolean = false, copySuccess: boolean = false): void {
    if (!this.downloadBtn) return;

    this.downloadBtn.disabled = false;
    const previewStatus = domCache.getElement('preview-status') as HTMLSpanElement;

    if (generationSuccess) {
      if (copySuccess) {
        this.downloadBtn.textContent = '✅ Alt Text Copied!';
        if (previewStatus) {
          previewStatus.textContent = 'Image downloaded. Alt text copied.';
          previewStatus.className = 'text-sm text-green-600';
        }
      } else {
        this.downloadBtn.textContent = '✅ Image Downloaded!';
        if (previewStatus) {
          previewStatus.textContent = 'Image downloaded successfully.';
          previewStatus.className = 'text-sm text-green-600';
        }
      }

      setTimeout(() => {
        if (this.downloadBtn && this.downloadBtn.textContent?.startsWith('✅')) {
          this.downloadBtn.textContent = 'Download Image';
          if (previewStatus) {
            previewStatus.textContent = 'Preview loaded successfully';
          }
        }
      }, 3000); // 3-second feedback message

    } else {
      this.downloadBtn.textContent = 'Download Image';
      if (previewStatus) {
        previewStatus.textContent = 'Preview loaded successfully';
        previewStatus.className = 'text-sm text-green-600';
      }
    }
  }

  private showError(message: string): void {
    console.error(message);
    alert(message);
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
