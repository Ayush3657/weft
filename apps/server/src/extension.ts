import { strToU8, zipSync } from 'fflate'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config'

const ICON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/icons/weft-512.png')

/**
 * "Weft for Claude": a Claude Desktop extension (an .mcpb file) holding the
 * Weft connector. Opening it in Claude installs it, and Claude asks for the
 * Weft address (filled in with `url`) and the person's key, which it keeps in
 * the system's secure storage. Claude runs it with its own Node, so the other
 * computer needs nothing else installed.
 */
export function claudeExtension(url: string): Uint8Array {
  const built = statSync(config.connectorPath).mtimeMs
  const manifest = {
    manifest_version: '0.3',
    name: 'weft',
    display_name: 'Weft',
    // A new build is a new version, so installing it again updates Claude's copy.
    version: `0.1.${Math.floor(built / 60_000)}`,
    description: 'Storyboards in Weft: Claude reads your projects, and boards, writes and retimes them with you.',
    long_description:
      "Connects Claude to your team's Weft server. Claude can list and read projects, see the frames' pictures, board a script, rewrite VO to fit a length, make cutdowns and attach pictures from this computer. Its edits show up live in Weft as change sets you can keep or undo.",
    author: { name: 'Weft' },
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/weft-mcp.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/weft-mcp.mjs'],
        env: { WEFT_URL: '${user_config.weft_url}', WEFT_TOKEN: '${user_config.weft_key}' },
      },
    },
    user_config: {
      weft_url: {
        type: 'string',
        title: 'Weft address',
        description: 'Where Weft runs on your network. Leave it as it is unless Weft has moved.',
        default: url,
        required: true,
      },
      weft_key: {
        type: 'string',
        title: 'Your Weft key',
        description: 'In Weft, open your account menu, choose Connect Claude, then On another computer, and create a key. Paste it here.',
        sensitive: true,
        required: true,
      },
    },
    compatibility: { platforms: ['win32', 'darwin'], runtimes: { node: '>=20.0.0' } },
  }
  return zipSync(
    {
      'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      'server/weft-mcp.mjs': readFileSync(config.connectorPath),
      'icon.png': [readFileSync(ICON), { level: 0 }],
    },
    { level: 6 },
  )
}
