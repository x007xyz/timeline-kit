import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// Peer dependencies are never bundled into the library output.
const externals = [/^react(\/.*)?$/, /^react-dom(\/.*)?$/, /^vue(\/.*)?$/]

export default defineConfig(({ command, mode }) => {
  // `vite` (dev) and `vite build --mode demo` serve/build the multi-scenario demo.
  // Served from the package root so `demo/main.ts` can import `../src/index`
  // and `/assets/*` maps cleanly to `demo/assets/*`.
  if (command === 'serve' || mode === 'demo') {
    return {
      publicDir: 'demo',
      server: {
        open: '/demo/index.html',
      },
      build: {
        outDir: 'dist-demo',
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(root, 'demo/index.html'),
        },
      },
    }
  }

  // `vite build`: ESM library build, one output file per package entry.
  return {
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      target: 'es2022',
      lib: {
        entry: {
          index: resolve(root, 'src/index.ts'),
          core: resolve(root, 'src/core-entry.ts'),
          otio: resolve(root, 'src/otio-entry.ts'),
          plugins: resolve(root, 'src/plugins-entry.ts'),
          react: resolve(root, 'adapters/react/index.ts'),
          vue: resolve(root, 'adapters/vue/index.ts'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: externals,
        output: {
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  }
})
