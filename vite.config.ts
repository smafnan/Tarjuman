import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import { loadEnvFile } from './src/server/env';

const WEB_ROOT = path.resolve(import.meta.dirname, 'src/web');

// The same .env the server reads (UTF-16 files from PowerShell included), so a changed PORT moves the proxy with it.
loadEnvFile(path.join(import.meta.dirname, '.env'));
const SERVER = `http://127.0.0.1:${process.env.PORT || '8787'}`;

/**
 * The web app lives in src/web and is built into dist/web, which the Node server serves.
 * In development Vite serves the app on :5173 and proxies /api and /ws to the server.
 */
export default defineConfig({
  root: WEB_ROOT,
  plugins: [
    react(),
    // The voice-activity-detection model, its audio worklet and the ONNX runtime are loaded
    // at run time by URL, so they are shipped as plain files under /vad/ (never from a CDN).
    viteStaticCopy({
      targets: [
        'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
        'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
      ].map((file) => ({
        // The plugin globs its sources, so an absolute path breaks when the project folder name contains
        // ( ) [ ] or { } (a ZIP unpacked to "Tarjuman-main (1)"). Relative to the Vite root there is no such folder
        // name in the pattern; globs also need forward slashes, hence normalizePath.
        src: normalizePath(path.relative(WEB_ROOT, path.resolve(import.meta.dirname, file))),
        dest: 'vad',
        // Copy the files themselves, not their node_modules/... directory structure.
        rename: { stripBase: true },
      })),
    }),
  ],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.* in a parent folder.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // Fonts always ship as files: the server's Content-Security-Policy allows fonts only from
    // 'self', and a small subset would otherwise be inlined as a blocked data: URL.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/ws': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
});
