import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'

export function nativePath() { return app.isPackaged ? path.join(process.resourcesPath, 'desktop-bridge.exe') : path.join(app.getAppPath(), 'native/bin/desktop-bridge.exe') }
const executeFile = promisify(execFile)
export async function native(command: string, ...args: string[]): Promise<any> {
  if (!fs.existsSync(nativePath())) throw new Error('Native bridge missing; run pnpm native:build')
  const { stdout } = await executeFile(nativePath(), [command, ...args], { windowsHide: true, encoding: 'utf8', timeout: 8000 })
  return JSON.parse(stdout)
}
export class DesktopHost {
  state: any = { attached: false, reason: 'Not attached' }
  private hwnd(window: BrowserWindow) {
    const handle = window.getNativeWindowHandle()
    return (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString()
  }
  async attach(window: BrowserWindow) {
    try { this.state = await native('attach', this.hwnd(window)) } catch (error) { this.state = { attached: false, reason: String(error) } }
    return this.state
  }
  async detach(window: BrowserWindow) {
    try { this.state = await native('detach', this.hwnd(window)) } catch (error) { this.state = { attached: false, reason: String(error) } }
    return this.state
  }
  async position(window: BrowserWindow, display: number, bounds?: { x: number; y: number; width: number; height: number }) {
    try { this.state = await native('position', this.hwnd(window), String(display), ...(bounds ? [bounds.x, bounds.y, bounds.width, bounds.height].map(String) : [])) } catch (error) { this.state = { attached: false, reason: String(error) } }
    return this.state
  }
  async check(window: BrowserWindow) {
    try { const status = await native('status', this.hwnd(window)); if (!status.attached) return this.attach(window); this.state = status } catch (error) { this.state = { attached: false, reason: String(error) } }
    return this.state
  }
}
