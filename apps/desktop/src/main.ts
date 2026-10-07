import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
  type UtilityProcess,
  type WebContents,
} from 'electron'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, type WriteStream } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { DesktopInfo } from './api'

/**
 * Weft as a desktop app: the same server and web app as in the browser, run
 * here with the projects kept on this computer, so it works with no network.
 * The server runs in a process of its own and the window shows what it serves.
 */

const APP_DIR = __dirname
/** The usual port, so addresses teammates and Claude know keep working when Weft moves into the app. */
const DEFAULT_PORT = 8787
/** How the server exits when another Weft has the data folder open. */
const DATA_IN_USE = 3
const BACKGROUND = '#0d0e10'
const ICON = path.join(APP_DIR, 'icon.png')
const PRELOAD = path.join(APP_DIR, 'preload.cjs')

// ------------------------------------------------------------------ settings

interface Settings {
  dataDir?: string
  port?: number
  shareWithTeam?: boolean
  bounds?: Rectangle
  maximized?: boolean
}

// Settings and data somewhere else for this run, to try things without touching the real ones.
if (process.env.WEFT_USER_DATA) app.setPath('userData', path.resolve(process.env.WEFT_USER_DATA))
const userDir = app.getPath('userData')
const settingsFile = path.join(userDir, 'settings.json')
const logFile = path.join(userDir, 'logs', 'server.log')
const defaultDataDir = path.join(userDir, 'data')

let settings: Settings = (() => {
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8')) as Settings
  } catch {
    return {}
  }
})()

function saveSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch }
  mkdirSync(userDir, { recursive: true })
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
}

const dataDir = () => settings.dataDir ?? defaultDataDir

/** The Weft data folder in what someone picked: it, or the one inside it (as when they pick the Weft folder itself). */
function dataFolderIn(picked: string): string {
  for (const folder of [picked, path.join(picked, 'data'), path.join(picked, 'apps', 'server', 'data')]) {
    if (existsSync(path.join(folder, 'weft.db'))) return folder
  }
  return picked
}

// ------------------------------------------------------------------ the server

interface Running {
  process: UtilityProcess
  url: string
  teamUrl: string | null
}

let running: Running | null = null
let log: WriteStream | null = null

function openLog(): WriteStream {
  if (log) return log
  mkdirSync(path.dirname(logFile), { recursive: true })
  try {
    // Start a fresh log when it's grown big, keeping the last one.
    if (statSync(logFile).size > 5_000_000) renameSync(logFile, logFile.replace(/\.log$/, '.old.log'))
  } catch {
    // No log yet.
  }
  log = createWriteStream(logFile, { flags: 'a' })
  return log
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

type Started = { ok: true; running: Running } | { ok: false; inUse: boolean; said: string }

async function startServer(folder: string): Promise<Started> {
  const host = settings.shareWithTeam ? '0.0.0.0' : '127.0.0.1'
  let port = settings.port ?? DEFAULT_PORT
  // Something else on the usual port (say, Weft run another way): take the next free one.
  for (let tries = 0; tries < 50 && !(await portFree(port, host)); tries++) port++
  const out = openLog()
  out.write(`\n--- ${new Date().toISOString()}  Weft ${app.getVersion()}, port ${port}, data in ${folder}\n`)
  const child = utilityProcess.fork(path.join(APP_DIR, 'server', 'index.mjs'), [], {
    serviceName: 'Weft server',
    stdio: 'pipe',
    env: {
      ...process.env,
      WEFT_PORT: String(port),
      HOST: host,
      DATA_DIR: folder,
      WEB_DIST: path.join(APP_DIR, 'web'),
      WEFT_CONNECTOR: path.join(APP_DIR, 'mcp', 'weft-mcp.mjs'),
      APP_URL: `http://localhost:${port}`,
    },
  })
  let said = ''
  const keep = (chunk: Buffer) => {
    out.write(chunk)
    said = (said + chunk.toString()).slice(-4000)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  return new Promise((resolve) => {
    child.on('message', (message: { ready?: boolean; port?: number; teamUrl?: string | null }) => {
      if (message?.ready) resolve({ ok: true, running: { process: child, url: `http://localhost:${message.port ?? port}`, teamUrl: message.teamUrl ?? null } })
    })
    child.once('exit', (code) => {
      resolve({ ok: false, inUse: code === DATA_IN_USE, said: said.trim().split('\n').slice(-8).join('\n') })
      // Stopping on its own, not because the app asked.
      if (running?.process === child) {
        running = null
        void serverStopped(code)
      }
    })
  })
}

/** Asks the server to save and stop, and waits (a while) for it to. */
function stopServer(): Promise<void> {
  const current = running
  running = null
  if (!current) return Promise.resolve()
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => {
      current.process.kill()
      resolve()
    }, 10_000)
    current.process.once('exit', () => {
      clearTimeout(giveUp)
      resolve()
    })
    current.process.postMessage('stop')
  })
}

// ------------------------------------------------------------------ the window

let win: BrowserWindow | null = null
let quitting = false
let restarting = false

const LOGO = `<svg width="56" height="56" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16161a"/><path d="M6 11h20M6 16h20M6 21h20" stroke="#4a4a55" stroke-width="2" stroke-linecap="round"/><path d="M9 7c2 3 2 5 0 9s-2 6 0 9M16 7c2 3 2 5 0 9s-2 6 0 9M23 7c2 3 2 5 0 9s-2 6 0 9" fill="none" stroke="#8e7dff" stroke-width="2.2" stroke-linecap="round"/></svg>`

/** A page to show while the server starts. */
const waiting = (message: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Weft</title><style>html,body{margin:0;height:100%;background:${BACKGROUND};color:#a4a5ae;font:14px system-ui,sans-serif}body{display:flex;align-items:center;justify-content:center}div{display:flex;flex-direction:column;align-items:center;gap:16px}</style></head><body><div>${LOGO}<span>${message}</span></div></body></html>`,
  )}`

/** Where the window was, if that's still on a screen. */
function savedBounds(): Partial<Rectangle> {
  const bounds = settings.bounds
  if (!bounds) return {}
  const area = screen.getDisplayMatching(bounds).workArea
  const visible = bounds.x < area.x + area.width - 100 && bounds.x + bounds.width > area.x + 100 && bounds.y >= area.y - 10 && bounds.y < area.y + area.height - 100
  return visible ? bounds : { width: bounds.width, height: bounds.height }
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    ...savedBounds(),
    minWidth: 960,
    minHeight: 600,
    title: 'Weft',
    backgroundColor: BACKGROUND,
    icon: ICON,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, spellcheck: true },
  })
  if (settings.maximized) w.maximize()
  w.once('ready-to-show', () => w.show())
  w.on('close', () => saveSettings({ bounds: w.getNormalBounds(), maximized: w.isMaximized() }))
  wire(w.webContents)
  return w
}

const isWeft = (url: string) => !!running && (url === running.url || url.startsWith(`${running.url}/`))

/** Links out open in the browser; Weft's own windows (a popped-out moodboard) stay in the app. */
function wire(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isWeft(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { backgroundColor: BACKGROUND, icon: ICON, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } } }
    }
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) => wire(child.webContents))
  contents.on('will-navigate', (event, url) => {
    if (isWeft(url)) return
    event.preventDefault()
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
  })

  // There's no menu bar (Alt+drag on the board would keep showing it), so the usual keys are here.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const owner = BrowserWindow.fromWebContents(contents)
    const ctrl = input.control || input.meta
    const key = input.key.toLowerCase()
    const zoom = contents.getZoomLevel()
    if (key === 'f11') owner?.setFullScreen(!owner.isFullScreen())
    else if (key === 'f12' || (ctrl && input.shift && key === 'i')) contents.toggleDevTools()
    else if (ctrl && key === 'r') (input.shift ? contents.reloadIgnoringCache() : contents.reload())
    else if (ctrl && (key === '=' || key === '+')) contents.setZoomLevel(Math.min(zoom + 0.5, 4))
    else if (ctrl && key === '-') contents.setZoomLevel(Math.max(zoom - 0.5, -4))
    else if (ctrl && key === '0') contents.setZoomLevel(0)
    else return
    event.preventDefault()
  })

  // What a browser offers on text: spelling, cut, copy, paste. (Weft's own right-click menus come first.)
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    for (const word of params.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => contents.replaceMisspelling(word) })
    if (params.misspelledWord) {
      items.push({ label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      )
    } else if (params.selectionText.trim()) items.push({ role: 'copy' })
    else if (params.linkURL) items.push({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) })
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
}

async function pickDataFolder(): Promise<string | null> {
  const options = { title: "Folder for Weft's projects", defaultPath: dataDir(), properties: ['openDirectory' as const, 'createDirectory' as const] }
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return canceled || !filePaths[0] ? null : dataFolderIn(filePaths[0])
}

/** The first time: where to keep the projects. */
async function firstRun(w: BrowserWindow): Promise<void> {
  if (settings.dataDir || existsSync(path.join(defaultDataDir, 'weft.db'))) return
  const { response } = await dialog.showMessageBox(w, {
    type: 'question',
    title: 'Welcome to Weft',
    message: 'Where should Weft keep your projects?',
    detail: `Weft keeps your projects, pictures and clips in a folder on this computer, and works without a network.\n\nIf you've used Weft on this computer before, choose its data folder to carry on with those projects. You can change this later from your account menu, under This computer.`,
    buttons: ['In my user folder', 'Choose a folder…'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  const picked = response === 1 ? await pickDataFolder() : null
  saveSettings({ dataDir: picked ?? defaultDataDir })
}

/** Starts the server and shows Weft, asking what to do if it can't start. */
async function bringUp(w: BrowserWindow): Promise<void> {
  for (;;) {
    const folder = dataDir()
    const started = await startServer(folder)
    if (started.ok) {
      running = started.running
      await w.loadURL(started.running.url)
      return
    }
    const { response } = await dialog.showMessageBox(
      w,
      started.inUse
        ? {
            type: 'warning',
            title: 'Weft',
            message: 'Another copy of Weft is using this data folder',
            detail: `${folder}\n\nIt may be Weft started another way, like Start Weft.cmd. Close it and try again, or use a different folder.`,
            buttons: ['Try again', 'Use a different folder…', 'Quit'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          }
        : {
            type: 'error',
            title: 'Weft',
            message: "Weft couldn't start",
            detail: `${started.said || 'It stopped without saying why.'}\n\nThe whole log is in ${logFile}.`,
            buttons: ['Try again', 'Use a different folder…', 'Quit'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          },
    )
    if (response === 1) {
      const picked = await pickDataFolder()
      if (picked) saveSettings({ dataDir: picked })
    } else if (response === 2) {
      quitting = true
      app.quit()
      return
    }
  }
}

async function restart(message: string): Promise<void> {
  if (!win || restarting) return
  restarting = true
  try {
    await stopServer()
    await win.loadURL(waiting(message))
    await bringUp(win)
  } finally {
    restarting = false
  }
}

async function serverStopped(code: number | null): Promise<void> {
  if (quitting || restarting || !win) return
  const { response } = await dialog.showMessageBox(win, {
    type: 'error',
    title: 'Weft',
    message: "Weft's server stopped",
    detail: `It stopped unexpectedly (code ${code ?? 'none'}). Everything up to then is saved. The log may say why: ${logFile}`,
    buttons: ['Start it again', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) await restart('Starting Weft again…')
  else app.quit()
}

// ------------------------------------------------------------------ what the app asks of us

function info(): DesktopInfo {
  return {
    version: app.getVersion(),
    dataDir: dataDir(),
    usualDataDir: defaultDataDir,
    shareWithTeam: !!settings.shareWithTeam,
    address: running?.url ?? null,
    teamUrl: running?.teamUrl ?? null,
    logFile,
  }
}

/** Only Weft's own pages may ask. */
const fromWeft = (event: IpcMainInvokeEvent) => isWeft(event.senderFrame?.url ?? '')

function listen(): void {
  ipcMain.handle('weft:info', (event) => (fromWeft(event) ? info() : null))
  ipcMain.handle('weft:open-data-folder', (event) => {
    if (fromWeft(event)) void shell.openPath(dataDir())
  })
  ipcMain.handle('weft:open-log', (event) => {
    if (fromWeft(event)) void shell.openPath(logFile)
  })
  ipcMain.handle('weft:choose-data-folder', async (event) => {
    if (!fromWeft(event)) return false
    const picked = await pickDataFolder()
    if (!picked || path.resolve(picked) === path.resolve(dataDir())) return false
    saveSettings({ dataDir: picked })
    // Answer first: the page goes when Weft restarts.
    setImmediate(() => void restart('Opening the projects in the new folder…'))
    return true
  })
  ipcMain.handle('weft:share-with-team', (event, on: unknown) => {
    if (!fromWeft(event) || typeof on !== 'boolean' || on === !!settings.shareWithTeam) return false
    saveSettings({ shareWithTeam: on })
    setImmediate(() => void restart(on ? 'Opening Weft to your network…' : 'Making Weft private to this computer…'))
    return true
  })
}

// ------------------------------------------------------------------ starting and stopping

if (!app.requestSingleInstanceLock()) {
  // Weft's already open: that one comes to the front instead.
  app.quit()
} else {
  app.setAppUserModelId('app.weft.desktop')
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    quitting = true
    if (!running) return
    // Let the server save open projects first.
    event.preventDefault()
    void stopServer().then(() => app.quit())
  })
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    listen()
    win = createWindow()
    win.on('closed', () => (win = null))
    await win.loadURL(waiting('Starting Weft…'))
    await firstRun(win)
    await bringUp(win)
  })
}
