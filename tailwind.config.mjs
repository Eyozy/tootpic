import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'brand-blue': {
          DEFAULT: '#3b82f6', // blue-500
          light: '#dbeafe',   // blue-100
          dark: '#2563eb',    // blue-600
        },
        'brand-gray': {
          50: '#f9fafb',   // gray-50
          100: '#f3f4f6',  // gray-100
          200: '#e5e7eb',  // gray-200
          300: '#d1d5db',  // gray-300
          400: '#9ca3af',  // gray-400
          500: '#6b7280',  // gray-500
          600: '#4b5563',  // gray-600
          700: '#374151',  // gray-700
          800: '#1f2937',  // gray-800
          900: '#111827',  // gray-900
        },
      }
    },
  },
  plugins: [
    forms,
  ],
}