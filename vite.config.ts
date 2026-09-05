/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути — сборка работает с GitHub Pages (/layered-life/).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
