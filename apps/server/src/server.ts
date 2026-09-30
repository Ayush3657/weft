import { getRequestListener } from '@hono/node-server'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type RawData } from 'ws'
import { app } from './app'
import { log } from './log'
import { hocuspocus } from './sync'

const toBytes = (data: RawData): Uint8Array =>
  Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data

/** Headers the sync hooks need from the upgrade request. */
const FORWARDED_HEADERS = ['cookie', 'origin', 'user-agent', 'authorization']

export interface RunningServer {
  port: number
  close(): Promise<void>
}

/** HTTP API on /api, live sync over WebSocket on /sync. */
export function startServer(options: { port: number; host: string }): Promise<RunningServer> {
  const server = createServer(getRequestListener(app.fetch))
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/sync') {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const headers = new Headers()
      for (const name of FORWARDED_HEADERS) {
        const value = req.headers[name]
        if (typeof value === 'string') headers.set(name, value)
      }
      const request = new Request(`http://localhost${req.url ?? '/sync'}`, { headers })
      const connection = hocuspocus.handleConnection(ws, request)
      ws.on('message', (data) => connection.handleMessage(toBytes(data)))
      ws.on('close', (code, reason) => connection.handleClose({ code, reason: reason.toString() }))
      ws.on('error', (error) => log.warn(`sync socket error: ${error.message}`))
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        async close() {
          hocuspocus.flushPendingStores()
          hocuspocus.closeConnections()
          for (const client of sockets.clients) client.terminate()
          sockets.close()
          await new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
  })
}
