import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CalendarError, placeSchema, routeSchema, type Settings } from '../shared/protocol'

const userAgent = 'DesktopCalendar/0.1.0 (local Windows calendar)'
export class MapService {
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequest = 0
  private pendingTiles = new Map<string, Promise<Buffer>>()
  constructor(private directory: string, private settings: () => Settings) {
    fs.mkdirSync(path.join(directory, 'maps'), { recursive: true })
  }
  private file(url: string) { return path.join(this.directory, 'maps', createHash('sha256').update(url).digest('hex')) }
  async tile(z: number, x: number, y: number): Promise<Buffer> {
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new CalendarError('INVALID_TILE', 'Invalid tile coordinates')
    const url = this.settings().mapTileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), file = this.file(url)
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400000) return fs.readFileSync(file)
    const existing = this.pendingTiles.get(url)
    if (existing) return existing
    const task = (async () => {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000), redirect: 'error' })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Tile unavailable')
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length > 2 * 1024 * 1024) throw new Error('Tile too large')
        fs.writeFileSync(file, bytes); return bytes
      } catch (error) { if (fs.existsSync(file)) return fs.readFileSync(file); throw error }
    })()
    this.pendingTiles.set(url, task)
    try { return await task } finally { this.pendingTiles.delete(url) }
  }
  async route(args: unknown, dryRun = false) {
    const input = z.object({ mode: z.enum(['foot', 'bike', 'car']), waypoints: z.array(placeSchema).min(2).max(16) }).strict().parse(args)
    if (dryRun) return { dryRun: true, ...input }
    const coordinates = input.waypoints.map(p => `${p.longitude},${p.latitude}`).join(';')
    const url = `${this.settings().mapRoutingUrl.replace(/\/$/, '')}/routed-${input.mode}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, file = this.file(url)
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400000) return { route: routeSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))), cached: true }
    const task = this.queue.catch(() => {}).then(async () => {
      const wait = this.lastRequest + 1100 - Date.now()
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      this.lastRequest = Date.now()
      try {
        const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(12000), redirect: 'error' })
        if (!response.ok) throw new Error('HTTP error')
        const body = await response.json() as any, result = body.routes?.[0]
        if (body.code !== 'Ok' || !result) throw new Error('No route')
        const route = routeSchema.parse({ mode: input.mode, waypoints: input.waypoints, geometry: result.geometry.coordinates.map(([lon, lat]: number[]) => [lat, lon]), distanceMeters: result.distance, durationSeconds: result.duration, source: 'osrm' })
        fs.writeFileSync(file, JSON.stringify(route)); return { route, cached: false }
      } catch { throw new CalendarError('ROUTE_UNAVAILABLE', '路线服务暂不可用；已保存的路线仍可查看。请稍后重试，不会用直线冒充道路路线。') }
    })
    this.queue = task
    return task
  }
}
