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
  private copyBtn: HTMLButtonElement | null = null;

  constructor() {
    this.downloadBtn = domCache.getElement('download-btn');
    this.copyBtn = domCache.getElement('copy-btn');
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

      this.setDownloadButtonState('Generating...');

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
      console.error('Image generation failed:', error);

      // Provide more specific error messages
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('Preview container not found')) {
        this.showError('Preview area not found. Please try loading a post first.');
      } else if (errorMessage.includes('Download button not found')) {
        this.showError('Download button not found. Please refresh the page.');
      } else if (errorMessage.includes('snapdom')) {
        this.showError('Image generation failed. The post content might be too large or contains unsupported elements.');
      } else {
        this.showError(`Image generation failed: ${errorMessage}`);
      }
    } finally {
      this.resetDownloadButton(generationSuccess, copySuccess);
      this.cleanup();
    }
  }

  /**
   * Generate image and copy to clipboard
   */
  async generateAndCopy(): Promise<void> {
    const originalNode = domCache.getElement('style-a-container');
    if (!originalNode) {
      throw new Error('Preview container not found');
    }

    if (!this.copyBtn) {
      throw new Error('Copy button not found');
    }

    // Check browser Clipboard API support
    if (!navigator.clipboard || !ClipboardItem) {
      this.showError('Your browser does not support copying images. Please use the Download button instead.');
      return;
    }

    let copySuccess = false;

    try {
      this.setCopyButtonState('Preparing...');

      const clone = this.createPreviewClone(originalNode);
      const container = this.createTempContainer(clone);

      this.setCopyButtonState('Generating...');

      const dataUrl = await this.generateImage(clone, {
        quality: API_CONFIG.IMAGE_QUALITY,
        pixelRatio: API_CONFIG.IMAGE_PIXEL_RATIO,
        backgroundColor: templateManager.getTemplateBackgroundColor(),
      });

      this.setCopyButtonState('Copying...');

      // Convert dataURL to Blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Write to clipboard
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      copySuccess = true;
      this.showCopySuccess();

    } catch (error) {
      console.error('Copy to clipboard failed:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('NotAllowedError') || (error as any)?.name === 'NotAllowedError') {
        this.showError('Clipboard access denied. Please allow clipboard permissions in your browser settings.');
      } else if (errorMessage.includes('ClipboardItem')) {
        this.showError('Your browser does not support copying images. Please use the Download button instead.');
      } else if (errorMessage.includes('Preview container not found')) {
        this.showError('Preview area not found. Please try loading a post first.');
      } else if (errorMessage.includes('snapdom')) {
        this.showError('Image generation failed. The post content might be too large or contains unsupported elements.');
      } else {
        this.showError(`Failed to copy image: ${errorMessage}`);
      }
    } finally {
      this.resetCopyButton(copySuccess);
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

    // Handle avatar and media loading states for image generation
    this.handleMediaLoadingStatesInImage(clone);

    // Clean up potentially problematic images before snapdom processing
    this.cleanupProblematicImages(clone);

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

  /**
   * Handle avatar and media loading states for clean image generation
   */
  private handleMediaLoadingStatesInImage(clone: HTMLElement): void {
    // Handle avatar loading states
    const avatarContainer = clone.querySelector('#style-a-avatar-container') as HTMLElement;
    if (avatarContainer) {
      // Replace shimmer placeholders with proper avatar images
      const shimmerElements = avatarContainer.querySelectorAll('.shimmer');
      shimmerElements.forEach(shimmer => {
        // Replace shimmer with a default avatar placeholder
        shimmer.innerHTML = `<div class="w-12 h-12 rounded-lg bg-gray-300 flex items-center justify-center text-gray-600 text-sm font-medium">?</div>`;
        shimmer.classList.remove('shimmer');
      });

      // Ensure avatar container is visible and properly sized
      avatarContainer.style.display = 'flex';
      avatarContainer.style.visibility = 'visible';
      avatarContainer.style.opacity = '1';
      avatarContainer.style.width = '48px';
      avatarContainer.style.height = '48px';
      avatarContainer.style.minWidth = '48px';
      avatarContainer.style.minHeight = '48px';
    }

    // Handle custom emoji loading states in content and display name
    const emojiLoadingElements = clone.querySelectorAll('.custom-emoji-loading');
    emojiLoadingElements.forEach(emoji => {
      // Replace loading emoji with a simple text placeholder
      const title = emoji.getAttribute('title') || '';
      const shortcode = title.replace(/:/g, '');
      emoji.innerHTML = `<span class="text-gray-500">:${shortcode}:</span>`;
      emoji.classList.remove('custom-emoji-loading', 'animate-pulse');
      emoji.classList.add('text-sm');
    });

    // Handle media attachment loading states
    const attachmentContainer = clone.querySelector('#style-a-attachment') as HTMLElement;
    if (attachmentContainer) {
      // Check if there are videos and adjust aspect ratio
      const hasVideos = Array.from(attachmentContainer.children).some(child => {
        const childHTML = child.innerHTML;
        return childHTML.includes('Video</div>') || childHTML.includes('GIF</div>');
      });

      // If there are videos, remove the 3/2 aspect ratio constraint
      if (hasVideos) {
        attachmentContainer.style.aspectRatio = 'auto';
      }

      // Replace shimmer placeholders with better loading indicators
      const shimmerElements = attachmentContainer.querySelectorAll('.shimmer');
      shimmerElements.forEach((shimmer, index) => {
        // Create a more elegant loading placeholder for images
        const placeholder = document.createElement('div');
        placeholder.className = 'w-full h-full bg-gray-200 flex items-center justify-center text-gray-400';
        placeholder.innerHTML = `
          <div class="text-center">
            <svg class="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            <p class="text-xs">Loading image...</p>
          </div>
        `;

        shimmer.parentNode?.replaceChild(placeholder, shimmer);
      });

      // Ensure attachment container has proper styling
      attachmentContainer.style.display = 'grid';
      attachmentContainer.style.visibility = 'visible';
      attachmentContainer.style.opacity = '1';

      // If container is empty (no attachments), hide it completely
      if (attachmentContainer.children.length === 0) {
        attachmentContainer.style.display = 'none';
      }
    }

    // Ensure all images in the clone are properly sized and loaded
    const images = clone.querySelectorAll('img');
    images.forEach(img => {
      // Ensure images have proper fallback behavior
      if (!img.src || img.src === '') {
        img.style.display = 'none';
        const placeholder = document.createElement('div');
        placeholder.className = 'w-full h-full bg-gray-200 flex items-center justify-center text-gray-400';
        placeholder.innerHTML = `
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        `;
        img.parentNode?.replaceChild(placeholder, img);
      }
    });

    // Ensure all content is properly visible for image generation
    const contentContainer = clone.querySelector('#style-a-content') as HTMLElement;
    if (contentContainer) {
      contentContainer.style.visibility = 'visible';
      contentContainer.style.opacity = '1';
      // Ensure content doesn't flow behind avatar
      contentContainer.style.marginLeft = '0';
      contentContainer.style.overflow = 'visible';
    }

    const displayNameContainer = clone.querySelector('#style-a-display-name') as HTMLElement;
    if (displayNameContainer) {
      displayNameContainer.style.visibility = 'visible';
      displayNameContainer.style.opacity = '1';
    }

    const usernameContainer = clone.querySelector('#style-a-username') as HTMLElement;
    if (usernameContainer) {
      usernameContainer.style.visibility = 'visible';
      usernameContainer.style.opacity = '1';
    }

    // Ensure the avatar row is properly structured and visible
    const avatarRow = avatarContainer?.parentElement as HTMLElement;
    if (avatarRow) {
      avatarRow.style.display = 'flex';
      avatarRow.style.alignItems = 'center';
      avatarRow.style.marginBottom = '1rem';
      avatarRow.style.visibility = 'visible';
      avatarRow.style.opacity = '1';
    }

    // Ensure proper layout flow - avatar and user info should appear together
    const userInfoSection = clone.querySelector('.flex.items-center.mb-4') as HTMLElement;
    if (userInfoSection) {
      userInfoSection.style.display = 'flex';
      userInfoSection.style.alignItems = 'center';
      userInfoSection.style.visibility = 'visible';
      userInfoSection.style.opacity = '1';
    }
  }

  /**
   * Clean up potentially problematic images that might cause snapdom decoding errors
   */
  private cleanupProblematicImages(clone: HTMLElement): void {

    // Find all images in the clone
    const images = clone.querySelectorAll('img');
    let problematicCount = 0;

    images.forEach((img, index) => {
      const src = img.src || img.getAttribute('src') || '';
      let shouldRemove = false;
      let replacementContent = '';

      // Check for problematic image URLs
      if (!src || src === '' || src === 'about:blank') {
        shouldRemove = true;
        replacementContent = '<div class="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">No Image</div>';
      } else if (src.startsWith('data:image/svg+xml') && !src.includes('<svg')) {
        // Malformed SVG data URLs
        shouldRemove = true;
        replacementContent = '<div class="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-xs">Invalid SVG</div>';
      } else if (src.includes('favicon.svg') && !src.startsWith('data:')) {
        // External favicon that might cause CORS issues
        shouldRemove = true;
        replacementContent = '<div class="w-full h-12 bg-gray-300 flex items-center justify-center text-gray-600 text-xs">Avatar</div>';
      } else if (src.includes('mstdn') || src.includes('mastodon')) {
        // Check if the image URL is from Mastodon and might be blocked
        // Keep these as they should work
      }

      // Replace problematic images
      if (shouldRemove) {
        // Create replacement element
        const replacement = document.createElement('div');
        replacement.innerHTML = replacementContent;

        // Copy attributes from original image
        Array.from(img.attributes).forEach(attr => {
          if (attr.name !== 'src' && attr.name !== 'onerror') {
            replacement.setAttribute(attr.name, attr.value);
          }
        });

        // Replace the problematic image
        img.parentNode?.replaceChild(replacement, img);
        problematicCount++;
      }
    });

  
    // Also check for any images with invalid dimensions
    const allImages = clone.querySelectorAll('img');
    allImages.forEach((img) => {
      // Add error handling to all remaining images
      if (!img.hasAttribute('onerror')) {
        img.setAttribute('onerror', `
          this.replaceWithPlaceholder(this);
        `);
      }
    });
  }

  /**
   * Replace an image with a placeholder
   */
  private replaceWithPlaceholder(img: HTMLImageElement): void {
    const replacement = document.createElement('div');
    replacement.className = img.className || 'w-full h-full bg-gray-200 flex items-center justify-center text-gray-400';
    replacement.innerHTML = `
      <div class="text-center">
        <svg class="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
        </svg>
        <p class="text-xs mt-1">Failed to load</p>
      </div>
    `;

    // Copy size classes
    if (img.className) {
      replacement.className = img.className;
    }

    img.parentNode?.replaceChild(replacement, img);
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

  /**
   * Create a simplified version of the clone for fallback image generation
   * Removes problematic elements that might cause snapdom decoding failures
   */
  private createSimplifiedClone(originalClone: HTMLElement): HTMLElement {
    const simplifiedClone = originalClone.cloneNode(true) as HTMLElement;

    // CONSERVATIVE APPROACH: Replace ALL images with text placeholders for simplified clone
    const images = simplifiedClone.querySelectorAll('img');
    images.forEach((img, index) => {
      const htmlImg = img as HTMLImageElement;
      const alt = htmlImg.alt || htmlImg.getAttribute('alt') || 'Image';

      // Replace with text placeholder instead of div placeholder
      const textPlaceholder = document.createElement('div');
      textPlaceholder.className = 'image-placeholder';
      textPlaceholder.textContent = `[${alt}]`;
      textPlaceholder.style.cssText = `
        padding: 8px;
        background-color: #f3f4f6;
        border: 1px dashed #d1d5db;
        border-radius: 4px;
        color: #6b7280;
        font-size: 12px;
        text-align: center;
        font-style: italic;
        margin: 4px 0;
      `;

      // Copy basic styling
      if (htmlImg.className) {
        textPlaceholder.className += ' ' + htmlImg.className;
      }

      htmlImg.parentNode?.replaceChild(textPlaceholder, htmlImg);
    });

    // Remove problematic CSS properties that might cause rendering issues
    const allElements = simplifiedClone.querySelectorAll('*');
    allElements.forEach(element => {
      const htmlElement = element as HTMLElement;

      // Remove only the most problematic CSS properties
      const problematicProperties = [
        'filter', 'backdrop-filter', 'transform', 'perspective',
        'box-shadow', 'text-shadow', 'animation', 'transition'
      ];

      problematicProperties.forEach(prop => {
        htmlElement.style.removeProperty(prop);
      });

      // Remove data attributes that might cause issues
      Array.from(htmlElement.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          htmlElement.removeAttribute(attr.name);
        }
      });
    });

    // Simplify the clone structure by removing only truly problematic elements
    const problematicSelectors = [
      'script', 'style', 'link', 'meta', 'iframe', 'object', 'embed',
      'video', 'audio', 'canvas', 'map', 'area'
    ];

    problematicSelectors.forEach(selector => {
      const elements = simplifiedClone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    // Ensure all images have proper dimensions
    const remainingImages = simplifiedClone.querySelectorAll('img');
    remainingImages.forEach(img => {
      const htmlImg = img as HTMLImageElement;
      if (!htmlImg.style.width) {
        htmlImg.style.width = '100%';
      }
      if (!htmlImg.style.height) {
        htmlImg.style.height = 'auto';
      }
      htmlImg.style.display = 'block';
      htmlImg.style.objectFit = 'cover';
    });

    // Clean up any remaining problematic content
    this.cleanupProblematicImages(simplifiedClone);

    return simplifiedClone;
  }

  private async generateImage(
    clone: HTMLElement,
    options: {
      quality: number;
      pixelRatio: number;
      backgroundColor: string;
    }
  ): Promise<string> {
    // Note: Button state updates are handled by the caller
    try {

      // Validate clone before processing
      if (!clone || clone.children.length === 0) {
        throw new Error('Empty or invalid preview content');
      }

      // First attempt: try with full content
      try {
        const imgElement = await snapdom.toPng(clone, {
          quality: options.quality,
          dpr: options.pixelRatio,
          backgroundColor: options.backgroundColor,
          width: IMAGE_CONFIG.MAX_WIDTH,
          filter: (node: Node) => node.nodeName !== 'SCRIPT',
        });

        if (!imgElement || !imgElement.src) {
          throw new Error('snapdom.toPng failed to generate image');
        }

        return imgElement.src;
      } catch (snapdomError) {
        const errorMsg = snapdomError instanceof Error ? snapdomError.message : 'Unknown error';
        console.warn('Image generation attempt failed, trying fallback:', errorMsg);

        // Second attempt: create a simplified version of the clone
        const simplifiedClone = this.createSimplifiedClone(clone);

        try {
          const imgElement = await snapdom.toPng(simplifiedClone, {
            quality: options.quality,
            dpr: options.pixelRatio,
            backgroundColor: options.backgroundColor,
            width: IMAGE_CONFIG.MAX_WIDTH,
            filter: (node: Node) => node.nodeName !== 'SCRIPT',
          });

          if (!imgElement || !imgElement.src) {
            throw new Error('Simplified snapdom attempt also failed');
          }

          return imgElement.src;
        } catch (simplifiedError) {
          console.error('All image generation attempts failed');
          throw new Error(`Image generation failed: Unable to generate image. This might be due to corrupted images or unsupported content format.`);
        }
      }
    } catch (error) {
      console.error('Error in generateImage:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Image generation failed: ${errorMsg}`);
    }
  }

  private downloadImage(dataUrl: string): void {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('Invalid image data URL');
      }

      
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
      link.download = `tootpic-${timestamp}.png`;
      link.href = dataUrl;

      // Add event listeners to track download success/failure
      link.addEventListener('error', () => {
        throw new Error('Failed to download image');
      });

      // Trigger download
      document.body.appendChild(link);
      link.click();

      // Clean up after a short delay
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Download failed: ${errorMsg}`);
    }
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

  private setCopyButtonState(text: string): void {
    if (this.copyBtn) {
      this.copyBtn.disabled = true;
      this.copyBtn.innerHTML = `
        <svg class="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${text}
      `;
    }
  }

  private showCopySuccess(): void {
    if (this.copyBtn) {
      this.copyBtn.disabled = false;
      this.copyBtn.innerHTML = `
        <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Copied!
      `;
      this.copyBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
      this.copyBtn.classList.add('bg-green-600');
    }
  }

  private resetCopyButton(copySuccess: boolean = false): void {
    if (!this.copyBtn) return;

    setTimeout(() => {
      if (this.copyBtn) {
        this.copyBtn.disabled = false;
        this.copyBtn.classList.remove('bg-green-600');
        this.copyBtn.classList.add('bg-green-500', 'hover:bg-green-600');
        this.copyBtn.innerHTML = `
          <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy Image
        `;
      }
    }, copySuccess ? 2000 : 0);
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
    this.copyBtn = null;
  }
}

export const imageGenerator = new ImageGenerator();
