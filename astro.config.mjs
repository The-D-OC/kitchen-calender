import { defineConfig } from 'astro/config';

// Everything (CSS + JS) is inlined into a single index.html so the
// built site can be dropped onto any static host, or opened on the tablet.
export default defineConfig({
  build: { inlineStylesheets: 'always' },
  vite: { build: { assetsInlineLimit: 1_000_000 } },
});
