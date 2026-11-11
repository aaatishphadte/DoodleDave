import { defineConfig } from 'vite';

// `vite build --mode <platform>` builds for a specific store; plain `vite build` is the website.
const PLATFORMS = ['itch', 'poki', 'crazygames', 'exe'];

export default defineConfig(({ mode }) => {
  const platform = PLATFORMS.includes(mode) ? mode : 'web';
  return {
    // Relative URLs so the build works inside portal iframes, itch's CDN and the desktop app.
    base: './',
    define: { __PLATFORM__: JSON.stringify(platform) },
    build: {
      outDir: platform === 'web' ? 'dist' : `build/${platform}`,
      emptyOutDir: true,
      chunkSizeWarningLimit: 1500, // three.js is most of the bundle
    },
  };
});
