/**
 * Manages template selection and application, including layout and appearance modes.
 */

import { TEMPLATE_NAMES, IMAGE_CONFIG } from '../constants';

export interface TemplateState {
  currentTemplate: string;
  isModalOpen: boolean;
  selectedTemplateId: string;
  selectedLayout: string;
  selectedAppearance: string;
}

export class TemplateManager {
  private state: TemplateState;

  constructor() {
    this.state = {
      currentTemplate: 'classic',
      isModalOpen: false,
      selectedTemplateId: 'classic',
      selectedLayout: 'classic',
      selectedAppearance: 'light',
    };
    this.bindEvents();
  }

  getCurrentTemplate(): string {
    return this.state.currentTemplate;
  }

  switchTemplate(templateId: string): void {
    if (templateId === this.state.currentTemplate) {
      return;
    }
    const oldTemplate = this.state.currentTemplate;
    this.state.currentTemplate = templateId;
    this.state.selectedTemplateId = templateId;

    // Add transition effects
    this.addTransitionEffects();

    // Update UI with transitions
    this.updateTemplateName(templateId);
    this.updatePreviewCard(templateId);
    this.updateSelectionUI();

    // Remove transition effects after animation completes
    setTimeout(() => {
      this.removeTransitionEffects();
    }, 700); // Match the longest CSS transition duration

    // Dispatch unified template change event
    const event = new CustomEvent('templateChanged', {
      detail: {
        oldTemplate,
        newTemplate: templateId,
        layout: this.state.selectedLayout,
        appearance: this.state.selectedAppearance
      }
    });
    document.dispatchEvent(event);
  }

  private updateTemplateName(templateId: string): void {
    const nameElement = document.getElementById('current-template-name');
    if (nameElement) {
      nameElement.textContent = TEMPLATE_NAMES[templateId as keyof typeof TEMPLATE_NAMES] || 'Classic';
      nameElement.setAttribute('data-template-id', templateId);
    }
  }

  private updatePreviewCard(templateId: string): void {
    const previewCard = document.querySelector('.preview-card');
    if (!previewCard) return;

    // Remove all template classes
    previewCard.classList.remove('template-classic', 'template-magazine', 'template-dark', 'template-magazine-dark');

    // Add new template class
    previewCard.classList.add(`template-${templateId}`);
  }

  
  openModal(): void {
    this.state.isModalOpen = true;
    const modal = document.getElementById('template-modal');

    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';

    // Update selection and focus
    const firstOption = modal.querySelector('.layout-option');
    if (firstOption) {
      (firstOption as HTMLElement).focus();
    }
    }

  }

  closeModal(): void {
    const modal = document.getElementById('template-modal');

    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }

  }

  getTemplateBackgroundColor(templateId?: string): string {
    const id = templateId || this.state.currentTemplate;
    return IMAGE_CONFIG.TEMPLATE_BACKGROUNDS[id as keyof typeof IMAGE_CONFIG.TEMPLATE_BACKGROUNDS] || IMAGE_CONFIG.DEFAULT_BACKGROUND;
  }



  private bindEvents(): void {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.isModalOpen) {
        this.closeModal();
      }
    });

    // Click outside modal
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('template-modal');
      const target = e.target as HTMLElement;

      if (this.state.isModalOpen && modal) {
        if (target === modal || target.classList.contains('modal-backdrop')) {
          this.closeModal();
        }
      }

      // Handle layout selection clicks via event delegation
      const layoutOption = target.closest('.layout-option');
      if (layoutOption) {
        const layout = layoutOption.getAttribute('data-layout');
        if (layout) {
          e.preventDefault();
          this.selectLayout(layout);
        }
      }

      // Handle appearance selection clicks via event delegation
      const appearanceOption = target.closest('.appearance-option');
      if (appearanceOption) {
        const radio = appearanceOption.querySelector('input[type="radio"]');
        if (radio) {
          const appearance = radio.getAttribute('value');
          if (appearance) {
            e.preventDefault();
            this.selectAppearance(appearance);
          }
        }
      }

      // Handle modal close button clicks via event delegation
      if (target.closest('.modal-close')) {
        e.preventDefault();
        this.closeModal();
      }
    });

    // Custom event for modal opening
    document.addEventListener('openTemplateModalEvent', () => {
      this.openModal();
    });
  }

  /**
   * Add enhanced transition effects for template switching
   */
  private addTransitionEffects(): void {
    const previewCard = document.querySelector('.preview-card');
    const templateName = document.getElementById('current-template-name');
    const templateContent = document.querySelector('.template-content');

    if (previewCard) {
      previewCard.classList.add('changing', 'switching');
    }

    if (templateName) {
      templateName.classList.add('updating');
    }

    if (templateContent) {
      templateContent.classList.add('changing');
    }
  }

  private removeTransitionEffects(): void {
    const previewCard = document.querySelector('.preview-card');
    const templateName = document.getElementById('current-template-name');
    const templateContent = document.querySelector('.template-content');

    if (previewCard) {
      previewCard.classList.remove('changing', 'switching');
    }

    if (templateName) {
      templateName.classList.remove('updating');
    }

    if (templateContent) {
      templateContent.classList.remove('changing');
    }
  }

  destroy(): void {}

  initializeSelections(): void {
    const currentTemplateId = this.getCurrentTemplate();
    // Determine layout and appearance from currentTemplateId
    if (currentTemplateId === 'dark') {
      this.state.selectedLayout = 'classic';
      this.state.selectedAppearance = 'dark';
    } else if (currentTemplateId === 'magazine') {
      this.state.selectedLayout = 'magazine';
      this.state.selectedAppearance = 'light';
    } else if (currentTemplateId === 'magazine-dark') { // Handle new magazine-dark template
      this.state.selectedLayout = 'magazine';
      this.state.selectedAppearance = 'dark';
    }
    else {
      this.state.selectedLayout = 'classic';
      this.state.selectedAppearance = 'light';
    }
    this.updateSelectionUI();
  }

  selectLayout(layout: string): void {
    if (!layout || typeof layout !== 'string') {
      throw new Error('Invalid layout parameter');
    }

    const validLayouts = ['classic', 'magazine'];
    if (!validLayouts.includes(layout)) {
      throw new Error(`Unsupported layout: ${layout}`);
    }

    this.state.selectedLayout = layout;
    this.updateSelectionUI();
    this.applySelectedTemplate(); // Apply immediately on layout change
  }

  selectAppearance(appearance: string): void {
    if (!appearance || typeof appearance !== 'string') {
      throw new Error('Invalid appearance parameter');
    }

    const validAppearances = ['light', 'dark'];
    if (!validAppearances.includes(appearance)) {
      throw new Error(`Unsupported appearance: ${appearance}`);
    }

    this.state.selectedAppearance = appearance;
    this.updateSelectionUI();
    this.applySelectedTemplate(); // Apply immediately on appearance change
  }

  private mapToTemplateId(layout: string, appearance: string): string {
    const templateMap: Record<string, Record<string, string>> = {
      'classic': {
        'light': 'classic',
        'dark': 'dark'
      },
      'magazine': {
        'light': 'magazine',
        'dark': 'magazine-dark'
      }
    };

    return templateMap[layout]?.[appearance] || 'classic';
  }

  applySelectedTemplate(): void {
    try {
      const templateId = this.mapToTemplateId(this.state.selectedLayout, this.state.selectedAppearance);
      this.switchTemplate(templateId);
    } catch (error) {
      console.error('Failed to apply selected template:', error);
      // Fallback to classic light template
      this.switchTemplate('classic');
    }
  }

  private updateSelectionUI(): void {
    const layoutOptions = document.querySelectorAll('.layout-option');
    layoutOptions.forEach(option => {
      const layout = option.getAttribute('data-layout');
      if (layout === this.state.selectedLayout) {
        option.classList.add('layout-option-selected');
        option.setAttribute('aria-pressed', 'true');
      } else {
        option.classList.remove('layout-option-selected');
        option.setAttribute('aria-pressed', 'false');
      }
    });

    const appearanceRadios = document.querySelectorAll<HTMLInputElement>('input[name="appearance"]');
    appearanceRadios.forEach(radio => {
      if (radio.value === this.state.selectedAppearance) {
        radio.checked = true;
      } else {
        radio.checked = false; // Ensure other radios are unchecked
      }
    });

    // Update schematic visibility based on selected appearance and layout
    const classicLight = document.querySelector('.layout-classic-light');
    const classicDark = document.querySelector('.layout-classic-dark');
    const magazineLight = document.querySelector('.layout-magazine-light');
    const magazineDark = document.querySelector('.layout-magazine-dark');

    // Always show light version for non-selected layouts, or if selected layout is light
    if (classicLight) classicLight.classList.remove('hidden');
    if (classicDark) classicDark.classList.add('hidden');
    if (magazineLight) magazineLight.classList.remove('hidden');
    if (magazineDark) magazineDark.classList.add('hidden');

    // Apply dark mode only to the currently selected layout
    if (this.state.selectedAppearance === 'dark') {
      if (this.state.selectedLayout === 'classic') {
        if (classicLight) classicLight.classList.add('hidden');
        if (classicDark) classicDark.classList.remove('hidden');
      } else if (this.state.selectedLayout === 'magazine') {
        if (magazineLight) magazineLight.classList.add('hidden');
        if (magazineDark) magazineDark.classList.remove('hidden');
      }
    }
  }
}


// Singleton instance
export const templateManager = new TemplateManager();
