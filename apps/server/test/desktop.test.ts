import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(path.join(os.tmpdir(), 'weft-desktop-test-'))
const desktopConfig = path.join(dir, 'Claude', 'claude_desktop_config.json')
process.env.DATA_DIR = path.join(dir, 'data')
process.env.CLAUDE_DESKTOP_CONFIG = desktopConfig

const { db, DATA_IN_USE } = await import('../src/db')
const { addToClaudeDesktop } = await import('../src/connect')

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('more than one Weft on a computer', () => {
  it("won't open a data folder another Weft has open", async () => {
    // This test has the folder open; a second server on it stops straight away and says why.
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const child = spawn(process.execPath, ['--import', 'tsx', entry], { cwd: path.dirname(entry), env: { ...process.env, WEFT_PORT: '0' }, stdio: 'pipe' })
    let said = ''
    child.stdout.on('data', (chunk) => (said += chunk))
    child.stderr.on('data', (chunk) => (said += chunk))
    const code = await new Promise((resolve) => child.on('exit', resolve))
    expect(code).toBe(DATA_IN_USE)
    expect(said).toContain('Another copy of Weft is using the data folder')
  }, 30000)
})

describe('Claude with the desktop app', () => {
  it('runs the connector with the app acting as Node', () => {
    mkdirSync(path.dirname(desktopConfig), { recursive: true })
    writeFileSync(desktopConfig, JSON.stringify({ mcpServers: { blender: { command: 'blender-mcp' } } }))
    const change = addToClaudeDesktop('C:/Apps/Weft/Weft.exe', 'C:/Apps/Weft/resources/app/mcp/weft-mcp.mjs', { ELECTRON_RUN_AS_NODE: '1' })
    expect(change.failed).toEqual([])
    const saved = JSON.parse(readFileSync(desktopConfig, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(saved.mcpServers.weft).toEqual({ command: 'C:/Apps/Weft/Weft.exe', args: ['C:/Apps/Weft/resources/app/mcp/weft-mcp.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(saved.mcpServers.blender).toEqual({ command: 'blender-mcp' })
  })
})
