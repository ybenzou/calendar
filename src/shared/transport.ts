import net from 'node:net'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { Command, Result } from './protocol'

export function dataDirectory(): string {
  // MSIX parents can virtualize AppData differently from a detached CLI child.
  // A home-directory path gives every launch the same database and pipe identity.
  return process.env.CALENDAR_DATA_DIR || path.join(os.homedir(), '.desktop-calendar', process.env.CALENDAR_PACKAGED === '1' ? 'main' : 'dev')
}
export function pipeAddress(directory: string): string {
  const key = createHash('sha256').update(`${os.userInfo().username}:${path.resolve(directory).toLowerCase()}`).digest('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\desktop-calendar-${key}` : path.join(directory, 'calendar.sock')
}
export function request(directory: string, command: Command): Promise<Result> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipeAddress(directory))
    let buffer = ''
    socket.setTimeout(35000, () => socket.destroy(new Error('Calendar request timed out')))
    socket.on('connect', () => socket.write(JSON.stringify(command) + '\n'))
    socket.on('data', chunk => {
      buffer += chunk.toString()
      if (buffer.length > 4 * 1024 * 1024) return socket.destroy(new Error('Response too large'))
      const newline = buffer.indexOf('\n')
      if (newline >= 0) { try { resolve(JSON.parse(buffer.slice(0, newline))) } catch (e) { reject(e) }; socket.end() }
    })
    socket.on('error', reject)
    socket.on('end', () => { if (!buffer.includes('\n')) reject(new Error('Service closed without response')) })
  })
}
