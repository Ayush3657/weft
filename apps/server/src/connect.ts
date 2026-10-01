import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Connecting Claude on the computer this server runs on, in one click: a key
 * file the Weft connector reads (so no settings ever hold the key), and Weft
 * added to Claude Desktop's MCP settings.
 */

export const LOCAL_KEY_NAME = 'Claude on this computer'

/** Where the connector looks for the server and its key. */
export const connectorFile = (): string => process.env.WEFT_CONNECTOR_FILE || path.join(os.homedir(), '.weft', 'connector.json')

/** Claude Desktop's settings files here. The Microsoft Store app keeps its own copy, so there can be two. */
export function claudeDesktopConfigs(): string[] {
  if (process.env.CLAUDE_DESKTOP_CONFIG) return [process.env.CLAUDE_DESKTOP_CONFIG]
  const files: string[] = []
  if (process.platform === 'win32') {
    if (process.env.APPDATA) files.push(path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json'))
    if (process.env.LOCALAPPDATA) {
      const packages = path.join(process.env.LOCALAPPDATA, 'Packages')
      try {
        for (const name of readdirSync(packages)) {
          if (/^Claude_/i.test(name)) files.push(path.join(packages, name, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'))
        }
      } catch {
        // No Store apps here.
      }
    }
  } else if (process.platform === 'darwin') {
    files.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'))
  } else {
    files.push(path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'))
  }
  // Only where Claude Desktop is installed (its folder exists).
  return files.filter((file) => existsSync(path.dirname(file)))
}

export function writeConnectorFile(url: string, token: string): string {
  const file = connectorFile()
  mkdirSync(path.dirname(file), { recursive: true })
  // Readable only by this account (Windows keeps the user folder private anyway).
  writeFileSync(file, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 })
  return file
}

export function readConnectorFile(): { url: string; token: string } | null {
  try {
    const data = JSON.parse(readFileSync(connectorFile(), 'utf8')) as { url?: unknown; token?: unknown }
    return typeof data.url === 'string' && typeof data.token === 'string' ? { url: data.url, token: data.token } : null
  } catch {
    return null
  }
}

export function removeConnectorFile(): void {
  rmSync(connectorFile(), { force: true })
}

export interface ConfigChange {
  updated: string[]
  failed: Array<{ file: string; reason: string }>
}

/** Rewrites each settings file with `change` applied to its MCP servers, keeping everything else and a backup. */
function editConfigs(change: (servers: Record<string, unknown>) => void): ConfigChange {
  const result: ConfigChange = { updated: [], failed: [] }
  for (const file of claudeDesktopConfigs()) {
    try {
      let data: Record<string, unknown> = {}
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        // A file Weft can't read is left alone rather than replaced.
        data = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
        if (!existsSync(`${file}.before-weft`)) copyFileSync(file, `${file}.before-weft`)
      }
      const servers = data.mcpServers && typeof data.mcpServers === 'object' ? { ...(data.mcpServers as Record<string, unknown>) } : {}
      change(servers)
      data.mcpServers = servers
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
      result.updated.push(file)
    } catch (error) {
      result.failed.push({ file, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

/** Adds Weft to Claude Desktop's MCP servers: it runs the connector with this Node. */
export const addToClaudeDesktop = (command: string, connector: string): ConfigChange =>
  editConfigs((servers) => {
    servers.weft = { command, args: [connector] }
  })

export const removeFromClaudeDesktop = (): ConfigChange =>
  editConfigs((servers) => {
    delete servers.weft
  })

/** Whether Claude Desktop's settings here already include Weft. */
export function claudeDesktopHasWeft(): boolean {
  return claudeDesktopConfigs().some((file) => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, unknown> }
      return !!data.mcpServers?.weft
    } catch {
      return false
    }
  })
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const isLoopback = (address: string | undefined): boolean => !!address && LOOPBACK.has(address)
