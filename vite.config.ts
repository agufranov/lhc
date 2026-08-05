import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any URL depth — in particular from
  // a GitHub Pages project subpath (user.github.io/<repo>/) without hard-coding the
  // repo name here. There is no client-side routing to break.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
});
