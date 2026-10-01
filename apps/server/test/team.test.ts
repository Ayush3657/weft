import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Weft opened to the network (as Start Weft for the team.cmd does), with no address set by hand.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'weft-team-test-'))
process.env.DATA_DIR = dataDir
process.env.NODE_ENV = 'test'
process.env.DEV_LOGIN = 'true'
process.env.HOST = '0.0.0.0'
delete process.env.PUBLIC_URL

const { config, isOriginAllowed } = await import('../src/config')
const { startServer } = await import('../src/server')
const { db } = await import('../src/db')

const lan = Object.entries(os.networkInterfaces())
  .filter(([name]) => !/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier/i.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .find((a) => a.family === 'IPv4' && !a.internal)

let server: Awaited<ReturnType<typeof startServer>>
let base = ''

beforeAll(async () => {
  // Listening on loopback only here, so the test never asks the firewall for anything.
  server = await startServer({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('Weft open to the team', () => {
  it("knows the address teammates use, and lets their browsers in", () => {
    if (!lan) return
    expect(config.teamUrl).toBe(`http://${lan.address}:${config.port}`)
    expect(isOriginAllowed(config.teamUrl)).toBe(true)
    expect(isOriginAllowed(`http://localhost:${config.port}`)).toBe(true)
    expect(isOriginAllowed('http://evil.example')).toBe(false)
  })

  it('signs in a teammate whose browser opened the network address', async () => {
    if (!config.teamUrl) return
    const login = await fetch(`${base}/api/auth/dev`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.teamUrl },
      body: JSON.stringify({ name: 'Teammate', email: 'teammate@example.com' }),
    })
    expect(login.status).toBe(200)
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    // Asked from this computer, the extension points other computers at the network address.
    const info = (await fetch(`${base}/api/connect`, { headers: { cookie } }).then((r) => r.json())) as { teamUrl: string; otherUrl: string }
    expect(info).toMatchObject({ teamUrl: config.teamUrl, otherUrl: config.teamUrl })
  })
})
