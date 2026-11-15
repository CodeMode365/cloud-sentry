// Bundles the container server (src/container/server.ts) and all workspace/npm dependencies into one ESM file.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/container/server.ts'],
  outfile: 'dist/container/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  legalComments: 'none',
  // Bundled CommonJS dependencies may call require(); provide it in the ESM output.
  banner: {
    js: "import { createRequire as __csCreateRequire } from 'node:module'; const require = __csCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
