import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { PetAction, PetMessage } from '../shared/pet'

export function petEndpoint(root: string) {
  const key = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\naiwa-calendar-${key}` : path.join(root, 'calendar.sock')
}

/** Local frames from the running Naiwa actor; disconnection restores desktop mode. */
export class PetBridge {
  private socket?: net.Socket
  private retry?: NodeJS.Timeout
  private enabled = false
  private viewport?: Extract<PetAction, { action: 'viewport' }>
  constructor(private emit: (message: PetMessage) => void, private root = process.env.CALENDAR_AGENT_DATA_DIR || process.env.NAIWA_HOME || path.join(os.homedir(), '.agent-pet')) {}
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) { clearTimeout(this.retry); this.socket?.destroy(); this.socket = undefined; return }
    if (!this.socket) this.connect()
  }
  private connect() {
    if (!this.enabled || this.socket) return
    const socket = this.socket = net.connect(petEndpoint(this.root))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => { socket.write('{"action":"host"}\n'); if (this.viewport) socket.write(JSON.stringify(this.viewport) + '\n'); this.emit({ type: 'status', connected: true }) })
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 4_000_000) { socket.destroy(); return }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        try {
          const frame = JSON.parse(line)
          if (frame.type === 'frame' && typeof frame.png === 'string' && frame.width > 0 && frame.width <= 4096 && frame.height > 0 && frame.height <= 4096) this.emit(frame)
        } catch { socket.destroy(); return }
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.emit({ type: 'status', connected: false })
      if (this.enabled) this.retry = setTimeout(() => this.connect(), 2000)
    })
  }
  interact(action: Extract<PetAction, { action: 'click' | 'focus' | 'interact' }>) {
    if (this.enabled && this.socket?.writable) this.socket.write(JSON.stringify(action) + '\n')
  }
  resize(action: Extract<PetAction, { action: 'viewport' }>) {
    this.viewport = action
    if (this.enabled && this.socket?.writable) this.socket.write(JSON.stringify(action) + '\n')
  }
  close() { this.setEnabled(false) }
}
