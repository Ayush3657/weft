import { config } from './config'
import { db } from './db'
import { log } from './log'
import { startServer } from './server'

const running = await startServer({ port: config.port, host: config.host })
log.info(`Weft server on http://${config.host}:${running.port}`)
log.info(`Data: ${config.dataDir}`)
if (config.devLogin) log.warn('Dev sign-in is on (name + email, no password). Turn it off before sharing the server.')

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info(`${signal}: saving open projects and stopping`)
  await running.close()
  // Give pending stores a moment to finish before closing the database.
  await new Promise((resolve) => setTimeout(resolve, 500))
  db.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
