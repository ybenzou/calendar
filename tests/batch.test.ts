import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CalendarCore } from '../src/core/calendar'
let core: CalendarCore, directory: string
// Synthetic fixtures, not the user's personal checklist.
const batch = { title: '测试活动组', key: 'synthetic-batch', timezone: 'Asia/Hong_Kong', events: [
  { title: '准备', start: '2026-10-13T16:00:00+08:00', end: '2026-10-13T18:00:00+08:00' },
  { title: '开幕提醒', start: '2026-10-14T09:10:00+08:00' },
  { title: '展览', start: '2026-10-14T09:00:00+08:00', end: '2026-10-14T18:00:00+08:00' }
] }
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-batch-')); core = new CalendarCore(directory) })
afterEach(() => { core.close(); if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-batch-'))) throw new Error('Unsafe cleanup'); fs.rmSync(directory, { recursive: true, force: true }) })
describe('Atomic grouped batch', () => {
  it('upgrades an existing event in place with version checks, dry-run, retry and undo', () => {
    const old = core.execute({ command: 'add', args: { title: '合成单条', start: '2026-10-13T10:00:00+08:00', end: '2026-10-13T18:00:00+08:00' } })
    const args = { ...batch, replaceId: old.eventId, expectedVersion: 1 }
    expect(() => core.execute({ command: 'batch.add', args: { ...args, expectedVersion: undefined } })).toThrow('expectedVersion')
    expect(() => core.execute({ command: 'batch.add', args: { ...args, expectedVersion: 99 } })).toThrow('changed')
    core.execute({ command: 'batch.add', args, dryRun: true })
    expect(core.list({})[0].items).toBeUndefined()
    const converted = core.execute({ command: 'batch.add', args })
    expect(converted.eventId).toBe(old.eventId); expect(converted.version).toBe(2)
    expect(core.list({})).toHaveLength(1)
    expect(core.execute({ command: 'batch.add', args }).duplicate).toBe(true)
    core.execute({ command: 'undo', args: { operationId: converted.operationId } })
    expect(core.list({})[0].items).toBeUndefined(); expect(core.list({})[0].title).toBe('合成单条')
  })
  it('stores one parent with distinct child IDs, time points, and restart persistence', () => {
    const result = core.execute({ command: 'batch.add', args: batch })
    expect(core.list({ date: '2026-10-14' })).toHaveLength(1)
    expect(result.event).toMatchObject({ start: '2026-10-13', end: '2026-10-15', allDay: true })
    expect(result.event.items[1].pointInTime).toBe(true)
    expect(new Set(result.event.items.map((e: any) => e.id)).size).toBe(3)
    core.close(); core = new CalendarCore(directory)
    expect(core.execute({ command: 'get', args: { id: result.eventId } }).event.items).toHaveLength(3)
  })
  it('validates the entire batch before writing and supports dry-run', () => {
    expect(() => core.execute({ command: 'batch.add', args: { ...batch, events: [...batch.events, { title: '', start: 'invalid' }] } })).toThrow()
    expect(core.list({})).toHaveLength(0)
    core.execute({ command: 'batch.add', args: batch, dryRun: true }); expect(core.list({})).toHaveLength(0)
  })
  it('deduplicates pasted commands by key and enforces conflicting content', () => {
    const first = core.execute({ command: 'batch.add', args: batch })
    const second = core.execute({ command: 'batch.add', args: batch })
    expect(second).toMatchObject({ eventId: first.eventId, duplicate: true }); expect(core.list({})).toHaveLength(1)
    expect(() => core.execute({ command: 'batch.add', args: { ...batch, title: 'Different' } })).toThrow('key')
    const request = { command: 'batch.add', args: { ...batch, key: 'request-key' }, requestId: 'batch-request' }
    expect(core.execute(request)).toEqual(core.execute(request))
  })
  it('undoes a whole batch in one operation', () => {
    const result = core.execute({ command: 'batch.add', args: batch })
    core.execute({ command: 'undo', args: { operationId: result.operationId } }); expect(core.list({})).toHaveLength(0)
  })
  it('edits and deletes children with parent versions and recalculates dates', () => {
    const result = core.execute({ command: 'batch.add', args: batch }), itemId = result.event.items[0].id
    const edited = core.execute({ command: 'update', args: { id: result.eventId, itemId, title: '准备更新', expectedVersion: 1 } })
    expect(edited.event.items[0].title).toBe('准备更新')
    expect(() => core.execute({ command: 'delete', args: { id: result.eventId, itemId, expectedVersion: 1 } })).toThrow('changed')
    const removed = core.execute({ command: 'delete', args: { id: result.eventId, itemId, expectedVersion: 2 } })
    expect(removed.event.start).toBe('2026-10-14'); expect(removed.itemCount).toBe(2)
    core.execute({ command: 'undo', args: { operationId: removed.operationId } }); expect(core.list({ date: '2026-10-13' })).toHaveLength(1)
  })
  it('moves a group while preserving child durations and offsets between days', () => {
    const result = core.execute({ command: 'batch.add', args: batch })
    const moved = core.execute({ command: 'move', args: { id: result.eventId, date: '2026-10-20' } })
    expect(moved.event.start).toBe('2026-10-20'); expect(moved.event.end).toBe('2026-10-22')
    expect(moved.event.items[0].start).toBe('2026-10-20T08:00:00.000Z')
    expect(moved.event.items[1].start).toBe('2026-10-21T01:10:00.000Z')
  })
  it('supports searching child titles and does not fill dates between unrelated items', () => {
    core.execute({ command: 'batch.add', args: { ...batch, events: [batch.events[0], { title: '远期节点', start: '2026-10-20T12:00:00+08:00' }] } })
    expect(core.list({ search: '远期节点' })).toHaveLength(1); expect(core.list({ date: '2026-10-16' })).toHaveLength(0)
  })
})
