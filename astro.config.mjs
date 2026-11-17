import { defineConfig } from 'astro/config';

// CSS is inlined into the page; fonts and scripts are separate hashed files
// under /_astro/ so the tablet caches them for good (see public/_headers).
export default defineConfig({
  build: { inlineStylesheets: 'always' },
});
