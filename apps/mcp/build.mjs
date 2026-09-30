import { build } from 'esbuild'

// One self-contained file that Claude Desktop can run with plain `node`, from any folder.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/weft-mcp.mjs',
  logLevel: 'warning',
  banner: {
    // Some bundled dependencies are CommonJS and call require().
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})
