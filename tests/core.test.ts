import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CalendarCore } from '../src/core/calendar'
import { AIService } from '../src/core/ai'

let core: CalendarCore, directory: string
const input = { title: '论文讨论', start: '2026-10-14T15:00:00+08:00', end: '2026-10-14T16:00:00+08:00', timezone: 'Asia/Shanghai' }
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-test-')); core = new CalendarCore(directory) })
afterEach(() => {
  core.close()
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-test-'))) throw new Error('Unsafe test cleanup path')
  fs.rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks()
})
describe('Local calendar commands', () => {
  it('persists normalized events across restart and queries local dates', () => {
    const added = core.execute({ command: 'add', args: input })
    expect(added.event.start).toBe('2026-10-14T07:00:00.000Z')
    core.close(); core = new CalendarCore(directory)
    expect(core.execute({ command: 'get', args: { id: added.eventId } }).event.title).toBe('论文讨论')
    expect(core.execute({ command: 'list', args: { date: '2026-10-14' } }).events).toHaveLength(1)
    expect(core.execute({ command: 'list', args: { date: '2026-10-15' } }).events).toHaveLength(0)
  })
  it('dry-run is nonmutating; request replay returns original result', () => {
    core.execute({ command: 'add', args: input, dryRun: true })
    expect(core.list({})).toHaveLength(0)
    const request = { command: 'add', args: input, requestId: 'stable-id' }
    expect(core.execute(request)).toEqual(core.execute(request))
    expect(core.execute({ ...request, args: { timezone: input.timezone, end: input.end, start: input.start, title: input.title } })).toEqual(core.execute(request))
    expect(core.list({})).toHaveLength(1)
    expect(() => core.execute({ ...request, args: { ...input, title: 'Different' } })).toThrow('Request ID')
  })
  it('enforces versions and safe undo without overwriting subsequent edits', () => {
    const added = core.execute({ command: 'add', args: input })
    const edited = core.execute({ command: 'update', args: { id: added.eventId, title: '已修改', expectedVersion: 1 } })
    expect(() => core.execute({ command: 'update', args: { id: added.eventId, title: '过期', expectedVersion: 1 } })).toThrow('changed')
    expect(() => core.execute({ command: 'undo', args: { operationId: added.operationId } })).toThrow('changed')
    core.execute({ command: 'undo', args: { operationId: edited.operationId } })
    expect(core.list({})[0]).toMatchObject({ title: '论文讨论', version: 3 })
    expect(() => core.execute({ command: 'undo', args: { operationId: edited.operationId } })).toThrow('already undone')
  })
  it('preserves local time and duration through DST moves', () => {
    const event = core.execute({ command: 'add', args: { ...input, start: '2026-03-07T15:00:00-05:00', end: '2026-03-07T16:00:00-05:00', timezone: 'America/New_York' } })
    const moved = core.execute({ command: 'move', args: { id: event.eventId, date: '2026-03-09', expectedVersion: 1 } })
    expect(moved.event.start).toBe('2026-03-09T19:00:00.000Z')
    expect(moved.event.end).toBe('2026-03-09T20:00:00.000Z')
  })
  it('rejects nonexistent DST wall times', () => {
    const event = core.execute({ command: 'add', args: { ...input, start: '2026-03-07T02:30:00-05:00', end: '2026-03-07T03:30:00-05:00', timezone: 'America/New_York' } })
    expect(() => core.execute({ command: 'move', args: { id: event.eventId, date: '2026-03-08' } })).toThrow('does not exist')
  })
  it('handles all-day exclusive ends and multiday moves', () => {
    const added = core.execute({ command: 'add', args: { title: '出差', start: '2026-10-14', end: '2026-10-17', allDay: true } })
    expect(core.list({ date: '2026-10-16' })).toHaveLength(1)
    expect(core.list({ date: '2026-10-17' })).toHaveLength(0)
    const moved = core.execute({ command: 'move', args: { id: added.eventId, date: '2026-10-20' } })
    expect(moved.event.end).toBe('2026-10-23')
  })
  it('soft-deletes and restores an event using undo', () => {
    const added = core.execute({ command: 'add', args: input })
    const deleted = core.execute({ command: 'delete', args: { id: added.eventId } })
    expect(core.list({})).toHaveLength(0)
    core.execute({ command: 'undo', args: { operationId: deleted.operationId } })
    expect(core.list({})).toHaveLength(1)
  })
  it('requires confirmation for nonempty calendar deletion and undoes the cascade', () => {
    const { calendar } = core.execute({ command: 'calendars.add', args: { name: '工作' } })
    core.execute({ command: 'add', args: { ...input, calendarId: calendar.id } })
    expect(() => core.execute({ command: 'calendars.delete', args: { id: calendar.id } })).toThrow('--include-events')
    const result = core.execute({ command: 'calendars.delete', args: { id: calendar.id, includeEvents: true } })
    expect(core.list({})).toHaveLength(0)
    core.execute({ command: 'undo', args: { operationId: result.operationId } })
    expect(core.list({})).toHaveLength(1)
  })
  it('creates consistent backups and safety-backups before restoring', () => {
    core.execute({ command: 'add', args: input }); const backup = core.backupCreate()
    core.execute({ command: 'add', args: { ...input, title: 'later' } })
    expect(() => core.backupRestore({ id: backup.id })).toThrow('--confirm')
    const result = core.backupRestore({ id: backup.id, confirm: true })
    expect(core.list({})).toHaveLength(1); expect(fs.existsSync(result.safetyBackup.path)).toBe(true)
  })
  it('rejects invalid dates, missing offsets, unknown settings and invalid ranges', () => {
    expect(() => core.execute({ command: 'add', args: { ...input, end: input.start } })).toThrow('End must')
    expect(() => core.execute({ command: 'add', args: { ...input, start: '2026-10-14T15:00' } })).toThrow('offset')
    expect(() => core.execute({ command: 'list', args: { date: '2026-02-31' } })).toThrow('date')
    expect(() => core.execute({ command: 'settings.set', args: { executeSql: 'drop' } })).toThrow()
  })
  it('recovers the old complete database after an interrupted restore', () => {
    core.execute({ command: 'add', args: input }); core.close()
    const target = path.join(directory, 'calendar.sqlite')
    fs.renameSync(target, `${target}.restore-old`); fs.writeFileSync(target, 'interrupted copy')
    core = new CalendarCore(directory)
    expect(core.list({})).toHaveLength(1)
  })
})
describe('AI previews', () => {
  it('previews a synthetic batch, cancels without writing, and applies once', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '测试批量', command: 'batch.add', args: { title: '模拟批量', events: [{ title: '节点A', start: '2026-10-14T09:10:00+08:00' }, { title: '节点B', start: '2026-10-14T10:00:00+08:00', end: '2026-10-14T11:00:00+08:00' }] } }) } }] })))
    const ai = new AIService(core, () => 'test-key')
    const first = await ai.preview({ text: '测试批量' }); expect(core.list({})).toHaveLength(0)
    ai.cancel({ id: first.preview.id }); expect(core.list({})).toHaveLength(0)
    const second = await ai.preview({ text: '测试批量' }); expect(second.preview.validated.event.items).toHaveLength(2)
    expect(ai.apply({ id: second.preview.id })).toEqual(ai.apply({ id: second.preview.id }))
    expect(core.list({})).toHaveLength(1)
  })
  function mockAI() {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '安排论文讨论', command: 'add', args: input }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    return new AIService(core, () => 'test-key')
  }
  it('does not write events until apply and repeated apply is idempotent', async () => {
    const ai = mockAI(), { preview } = await ai.preview({ text: '安排论文讨论' })
    expect(core.list({})).toHaveLength(0)
    expect(ai.apply({ id: preview.id })).toEqual(ai.apply({ id: preview.id }))
    expect(core.list({})).toHaveLength(1)
  })
  it('cancel leaves no event and blocks later apply', async () => {
    const ai = mockAI(), { preview } = await ai.preview({ text: '安排论文讨论' })
    ai.cancel({ id: preview.id }); expect(core.list({})).toHaveLength(0)
    expect(() => ai.apply({ id: preview.id })).toThrow('cancelled')
  })
  it('missing key and model failures leave the local calendar usable', async () => {
    await expect(new AIService(core, () => undefined).preview({ text: '添加' })).rejects.toThrow('API key')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }))
    await expect(new AIService(core, () => 'key').preview({ text: '添加' })).rejects.toThrow('429')
    expect(core.execute({ command: 'add', args: input }).event.title).toBe('论文讨论')
  })
})
