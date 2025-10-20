/**
 * Template configuration data
 */

import type { TemplateConfig } from '../types/template';

export const TEMPLATES: TemplateConfig[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Classic card style with elegant and clean presentation',
    theme: 'light',
  },
  {
    id: 'magazine',
    name: 'Magazine',
    description: 'Professional magazine layout with featured articles',
    theme: 'light',
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Professional dark theme with eye-friendly design',
    theme: 'dark',
  },
  {
    id: 'magazine-dark',
    name: 'Magazine (Dark)',
    description: 'Professional magazine layout with featured articles in dark mode',
    theme: 'dark',
  },
];
