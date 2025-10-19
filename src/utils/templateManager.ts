/**
 * Template management class with state and functionality
 */

import { TEMPLATES } from '../data/templates';
import { TEMPLATE_NAMES, IMAGE_CONFIG } from '../constants';
import { domCache } from './domCache';

export interface TemplateState {
  currentTemplate: string;
  isModalOpen: boolean;
  selectedTemplateId: string;
}

export class TemplateManager {
  private state: TemplateState;
  private eventListeners: Map<string, Function[]> = new Map();

  constructor() {
    this.state = {
      currentTemplate: 'classic',
      isModalOpen: false,
      selectedTemplateId: 'classic',
    };
    this.bindEvents();
  }

  /**
   * Get current template ID
   */
  getCurrentTemplate(): string {
    return this.state.currentTemplate;
  }

  /**
   * Get template configuration
   */
  getTemplate(id: string) {
    return TEMPLATES.find(template => template.id === id);
  }

  /**
   * Get all templates
   */
  getAllTemplates() {
    return TEMPLATES;
  }

  /**
   * Switch to a template
   */
  switchTemplate(templateId: string): void {
    if (templateId === this.state.currentTemplate) return;

    const oldTemplate = this.state.currentTemplate;
    this.state.currentTemplate = templateId;
    this.state.selectedTemplateId = templateId;

    // Update UI
    this.updateTemplateName(templateId);
    this.updatePreviewCard(templateId);
    this.updateModalSelection(templateId);

    // Emit event
    this.emit('templateChanged', {
      oldTemplate,
      newTemplate: templateId,
    });

    // Dispatch custom event for compatibility
    const event = new CustomEvent('templateSelected', {
      detail: { templateId }
    });
    document.dispatchEvent(event);
  }

  /**
   * Update template name display
   */
  private updateTemplateName(templateId: string): void {
    const nameElement = domCache.getElement('current-template-name');
    if (nameElement) {
      nameElement.textContent = TEMPLATE_NAMES[templateId as keyof typeof TEMPLATE_NAMES] || 'Classic';
      nameElement.setAttribute('data-template-id', templateId);
    }
  }

  /**
   * Update preview card class
   */
  private updatePreviewCard(templateId: string): void {
    const previewCard = domCache.querySelector('.preview-card');
    if (!previewCard) return;

    // Remove all template classes
    previewCard.classList.remove('template-classic', 'template-magazine', 'template-dark');

    // Add new template class
    previewCard.classList.add(`template-${templateId}`);
  }

  /**
   * Update modal selection state
   */
  private updateModalSelection(templateId: string): void {
    const templateOptions = domCache.querySelectorAll('.template-option');

    templateOptions.forEach(option => {
      const optionTemplateId = option.getAttribute('data-template-id');
      const indicator = option.querySelector('.template-selected-indicator');

      if (optionTemplateId === templateId) {
        option.classList.add('template-option-selected');
        option.setAttribute('aria-pressed', 'true');
        if (indicator) {
          (indicator as HTMLElement).style.display = 'flex';
        }
      } else {
        option.classList.remove('template-option-selected');
        option.setAttribute('aria-pressed', 'false');
        if (indicator) {
          (indicator as HTMLElement).style.display = 'none';
        }
      }
    });
  }

  /**
   * Open modal
   */
  openModal(): void {
    this.state.isModalOpen = true;
    const modal = domCache.getElement('template-modal');

    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';

      // Update selection and focus
      this.updateModalSelection(this.state.currentTemplate);
      const firstOption = modal.querySelector('.template-option');
      if (firstOption) {
        (firstOption as HTMLElement).focus();
      }
    }

    this.emit('modalOpened');
  }

  /**
   * Close modal
   */
  closeModal(): void {
    this.state.isModalOpen = false;
    const modal = domCache.getElement('template-modal');

    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }

    this.emit('modalClosed');
  }

  /**
   * Get template background color
   */
  getTemplateBackgroundColor(templateId?: string): string {
    const id = templateId || this.state.currentTemplate;
    return IMAGE_CONFIG.TEMPLATE_BACKGROUNDS[id as keyof typeof IMAGE_CONFIG.TEMPLATE_BACKGROUNDS] || IMAGE_CONFIG.DEFAULT_BACKGROUND;
  }

  /**
   * Event management
   */
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  /**
   * Bind global events
   */
  private bindEvents(): void {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.isModalOpen) {
        this.closeModal();
      }
    });

    // Click outside modal
    document.addEventListener('click', (e) => {
      const modal = domCache.getElement('template-modal');
      const target = e.target as HTMLElement;

      if (this.state.isModalOpen && modal) {
        if (target === modal || target.classList.contains('modal-backdrop')) {
          this.closeModal();
        }
      }
    });

    // Custom event for modal opening
    document.addEventListener('openTemplateModalEvent', () => {
      this.openModal();
    });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Clear event listeners
    this.eventListeners.clear();

    // Clear DOM cache
    domCache.destroy();
  }
}

// Expose functions globally for onclick handlers
declare global {
  interface Window {
    selectTemplate: (templateId: string) => void;
    closeTemplateModal: () => void;
  }
}

// Expose functions globally for onclick handlers (minimal global pollution)
// Use Object.defineProperty to control the global property and prevent pollution
Object.defineProperty(window, 'selectTemplate', {
  value: (templateId: string): void => {
    templateManager.switchTemplate(templateId);
  },
  writable: false,
  configurable: false,
  enumerable: false
});

Object.defineProperty(window, 'closeTemplateModal', {
  value: (): void => {
    templateManager.closeModal();
  },
  writable: false,
  configurable: false,
  enumerable: false
});

// Singleton instance
export const templateManager = new TemplateManager();