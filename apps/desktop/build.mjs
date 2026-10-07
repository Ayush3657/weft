// Builds Weft's desktop app into build/app: the web app and Claude's connector,
// the server bundled into one file, Electron's main process, and the server's
// two native modules. With --installer, also makes the Windows installer in release/.
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const out = path.join(here, 'build', 'app')
const resources = path.join(here, 'build', 'resources')
const run = (command, cwd = root) => execSync(command, { cwd, stdio: 'inherit' })
const versionOf = (dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version
const step = (what) => console.log(`\n» ${what}`)

// The native modules the server needs, at the versions it's tested with.
const NATIVE = ['better-sqlite3', 'sharp']

step('Building the web app and the connector')
run('npm run build -w @weft/web')
run('npm run build -w @weft/mcp')

step('Gathering the app')
mkdirSync(out, { recursive: true })
// Start clean, but keep the installed native modules: they only change with their versions.
for (const name of readdirSync(out)) if (name !== 'node_modules') rmSync(path.join(out, name), { recursive: true, force: true })

await build({
  entryPoints: [path.join(root, 'apps/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(out, 'server', 'index.mjs'),
  // Native code stays in its packages; ws's optional speed-ups aren't installed.
  external: [...NATIVE, 'bufferutil', 'utf-8-validate'],
  banner: {
    // Some bundled dependencies are CommonJS and use require() and __dirname.
    js: [
      "import { createRequire as __weftRequire } from 'node:module'",
      "import { fileURLToPath as __weftPath } from 'node:url'",
      "import { dirname as __weftDir } from 'node:path'",
      'const require = __weftRequire(import.meta.url)',
      'const __filename = __weftPath(import.meta.url)',
      'const __dirname = __weftDir(__filename)',
    ].join('; '),
  },
  logLevel: 'warning',
})
for (const [entry, file] of [
  ['main.ts', 'main.cjs'],
  ['preload.ts', 'preload.cjs'],
]) {
  await build({
    entryPoints: [path.join(here, 'src', entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(out, file),
    external: ['electron'],
    logLevel: 'warning',
  })
}
cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'web'), { recursive: true })
mkdirSync(path.join(out, 'mcp'), { recursive: true })
cpSync(path.join(root, 'apps/mcp/dist/weft-mcp.mjs'), path.join(out, 'mcp', 'weft-mcp.mjs'))

step('Drawing the icon')
const require = createRequire(path.join(root, 'apps/server/package.json'))
const sharp = (await import(pathToFileURL(require.resolve('sharp')).href)).default
const logo = readFileSync(path.join(root, 'apps/web/public/weft.svg'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map(async (size) => ({ size, data: await sharp(logo, { density: (72 * size) / 32 }).resize(size, size).png().toBuffer() })))
mkdirSync(resources, { recursive: true })
writeFileSync(path.join(resources, 'icon.ico'), ico(pngs))
writeFileSync(path.join(out, 'icon.png'), pngs.at(-1).data)

step('Installing the native modules')
const installed = path.join(out, 'node_modules')
const wanted = Object.fromEntries(NATIVE.map((name) => [name, versionOf(path.join(root, 'node_modules', name))]))
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'weft',
      productName: 'Weft',
      version: versionOf(here),
      description: 'Storyboards for ads and films.',
      author: 'Weft',
      main: 'main.cjs',
      dependencies: wanted,
    },
    null,
    2,
  )}\n`,
)
const current = NATIVE.every((name) => existsSync(path.join(installed, name)) && versionOf(path.join(installed, name)) === wanted[name])
if (current) console.log('Already there.')
else run('npm install --omit=dev --no-audit --no-fund --no-package-lock', out)
// SQLite comes with its code for every system; this app needs only this one's.
const prebuilds = path.join(installed, 'better-sqlite3', 'prebuilds')
for (const file of readdirSync(prebuilds)) if (file !== `${process.platform}-${process.arch}.node`) rmSync(path.join(prebuilds, file))

if (process.argv.includes('--installer')) {
  step('Making the installer')
  run('npx electron-builder --win --config electron-builder.yml --publish never', here)
  console.log(`\nThe installer is in ${path.join(here, 'release')}`)
}

/** A Windows icon file holding PNGs at each size. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, at)
    head.writeUInt8(size >= 256 ? 0 : size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((image) => image.data)])
}
