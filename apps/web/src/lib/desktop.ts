/**
 * Weft in its desktop app: what the app tells its pages about this computer,
 * and what it can do for them. The app's copy is apps/desktop/src/api.ts.
 */

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

export interface DesktopApi {
  info(): Promise<DesktopInfo | null>
  openDataFolder(): Promise<void>
  openLog(): Promise<void>
  /** Asks for another data folder: true if Weft is restarting with it. */
  chooseDataFolder(): Promise<boolean>
  /** True if Weft is restarting to open itself to the network (or close itself to it). */
  shareWithTeam(on: boolean): Promise<boolean>
}

/** The desktop app, when Weft runs in it; null in a browser. */
export const desktop: DesktopApi | null = (window as Window & { weftDesktop?: DesktopApi }).weftDesktop ?? null
