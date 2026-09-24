import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'dev-csp',
    transformIndexHtml(html, context) {
      // React Fast Refresh injects a development-only inline preamble.
      return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
    },
  }],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
