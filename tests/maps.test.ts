import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MapService } from '../src/main/maps'
import { CalendarCore } from '../src/core/calendar'
import { settingsSchema } from '../src/shared/protocol'

let directory: string
const from = { name: '合成起点', latitude: 22.28, longitude: 114.13 }, to = { name: '合成终点', latitude: 22.281, longitude: 114.131 }
const route = { mode: 'foot', waypoints: [from, to], geometry: [[22.28, 114.13], [22.281, 114.131]], source: 'osrm', distanceMeters: 200, durationSeconds: 160 }
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-maps-')) })
afterEach(() => { vi.unstubAllGlobals(); if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-maps-'))) throw new Error('Unsafe cleanup'); fs.rmSync(directory, { recursive: true, force: true }) })
describe('Saved itinerary maps', () => {
  it('persists child coordinates/routes, versions edits, and restores them with undo', () => {
    const core = new CalendarCore(directory)
    try {
      const group = core.execute({ command: 'batch.add', args: { title: '地图测试', events: [{ title: '起点', start: '2026-10-17T10:00:00+08:00', location: from }, { title: '终点', start: '2026-10-17T11:00:00+08:00', location: to, route }] } })
      const changed = core.execute({ command: 'update', args: { id: group.eventId, itemId: group.event.items[1].id, expectedVersion: 1, location: from } })
      expect(changed.event.items[1].route).toBeNull()
      core.execute({ command: 'undo', args: { operationId: changed.operationId } })
      expect(core.execute({ command: 'get', args: { id: group.eventId } }).event.items[1].route).toEqual(route)
      expect(() => core.execute({ command: 'update', args: { id: group.eventId, itemId: group.event.items[1].id, expectedVersion: 1, route } })).toThrow('changed')
    } finally { core.close() }
  })
  it('rejects bad coordinates before writing', () => {
    const core = new CalendarCore(directory)
    try {
      expect(() => core.execute({ command: 'add', args: { title: 'Bad location', start: '2026-10-17T10:00:00+08:00', end: '2026-10-17T11:00:00+08:00', location: { ...from, latitude: 100 } } })).toThrow()
      expect(core.list({})).toHaveLength(0)
    } finally { core.close() }
  })
  it('uses foot graph, converts GeoJSON order, caches results, and dry-run sends no request', async () => {
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 200, duration: 160, geometry: { coordinates: [[114.13, 22.28], [114.131, 22.281]] } }] }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const maps = new MapService(directory, () => settingsSchema.parse({})), args = { mode: 'foot', waypoints: [from, to] }
    await maps.route(args, true); expect(fetcher).not.toHaveBeenCalled()
    expect((await maps.route(args)).route).toEqual(route)
    expect(fetcher.mock.calls[0][0]).toContain('/routed-foot/')
    expect((await maps.route(args)).cached).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('reports unavailable routes instead of drawing fabricated roads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const maps = new MapService(directory, () => settingsSchema.parse({}))
    await expect(maps.route({ mode: 'foot', waypoints: [from, to] })).rejects.toThrow('不会用直线')
    await expect(maps.route({ mode: 'tram', waypoints: [from, to] })).rejects.toThrow()
  })
  it('loads only requested tiles, caches for offline reuse, and rejects traversal/invalid coordinates', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const maps = new MapService(directory, () => settingsSchema.parse({}))
    expect(await maps.tile(1, 0, 0)).toEqual(Buffer.from([1, 2, 3]))
    expect(await maps.tile(1, 0, 0)).toEqual(Buffer.from([1, 2, 3])); expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(maps.tile(1, 9, 0)).rejects.toThrow('Invalid tile')
  })
})
