/** What the desktop app tells Weft's pages about this computer. The web app has its copy in apps/web/src/lib/desktop.ts. */
export interface DesktopInfo {
  version: string
  dataDir: string
  usualDataDir: string
  shareWithTeam: boolean
  /** Where Weft is open on this computer. */
  address: string | null
  /** Where teammates open it, while it's open to the network. */
  teamUrl: string | null
  logFile: string
}

/** What Weft's pages can ask of the desktop app (window.weftDesktop). */
export interface DesktopApi {
  info(): Promise<DesktopInfo | null>
  openDataFolder(): Promise<void>
  openLog(): Promise<void>
  /** Asks for another data folder: true if Weft is restarting with it. */
  chooseDataFolder(): Promise<boolean>
  /** True if Weft is restarting to open itself to the network (or close itself to it). */
  shareWithTeam(on: boolean): Promise<boolean>
}
