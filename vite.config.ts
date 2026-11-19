import { cloudflare } from '@cloudflare/vite-plugin';
import solid from '@solidjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { fileRoutes } from 'filesystem-routing/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const isTest = Boolean(process.env.VITEST);
const isNodeRuntime = process.env.RETROCKS_RUNTIME === 'node';
const useCloudflare = !isTest && !isNodeRuntime;

export default defineConfig({
  define: { 'import.meta.env.RETROCKS_LIVE_SSE': isTest || isNodeRuntime },
  // Turnkey streaming SSR around src/App.tsx + src/Document.tsx.
  // Default dev/build runs in Cloudflare Workers (workerd) with SQLite Durable Objects.
  // Set RETROCKS_RUNTIME=node (pnpm dev:node / pnpm build:node) for standalone Node.
  plugins: [
    ...(useCloudflare
      ? [cloudflare({ viteEnvironment: { name: 'ssr' } })]
      : []),
    solid({
      start: {
        middleware: './src/middleware.ts',
        ...(isNodeRuntime ? { nodeServer: true } : {}),
      },
      ssr: true,
      diagnostics: true,
      serverFunctions: { serverSetup: './src/server-config.ts' },
      extensions: ['.jsx', '.tsx'],
    }),
    fileRoutes({ httpMethods: true, types: true }),
    tailwindcss(),
  ],
  server: {
    port: 3000,
  },
  test: {
    globals: false,
    setupFiles: ['./vitest-setup.ts'],
    // Two projects because they need different halves of the framework:
    // component tests run in a DOM against the browser build, server-runtime
    // tests (the session suite) run in node against the real server build.
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          // environment:'node' projects get the server posture from the
          // plugin automatically (server conditions, framework inlined).
          environment: 'node',
          include: ['src/server/**/*.test.ts'],
          alias: [
            // Tests run outside the turnkey server: the plugin's env module
            // is stubbed with the same contract (live process.env reads).
            {
              find: 'virtual:solid-env/server',
              replacement: fileURLToPath(
                new URL('./vitest-env-server-stub.ts', import.meta.url),
              ),
            },
          ],
        },
      },
    ],
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
});
