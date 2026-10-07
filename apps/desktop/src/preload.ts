import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from './api'

/** What Weft's pages can ask of the desktop app; the app answers only its own pages. */
const api: DesktopApi = {
  info: () => ipcRenderer.invoke('weft:info'),
  openDataFolder: () => ipcRenderer.invoke('weft:open-data-folder'),
  openLog: () => ipcRenderer.invoke('weft:open-log'),
  chooseDataFolder: () => ipcRenderer.invoke('weft:choose-data-folder'),
  shareWithTeam: (on) => ipcRenderer.invoke('weft:share-with-team', on),
}

contextBridge.exposeInMainWorld('weftDesktop', api)
