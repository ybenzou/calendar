import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CalendarCore } from '../src/core/calendar'
import { SubscriptionService, parseSubscriptionICS } from '../src/core/subscriptions'
let core: CalendarCore, service: SubscriptionService, directory: string
const makeICS = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//School//Calendar//EN\r\n${events}\r\nEND:VCALENDAR`
const timed = (summary = '学校讲座') => `BEGIN:VEVENT\r\nUID:lecture@school\r\nDTSTART;TZID=Asia/Hong_Kong:20261014T150000\r\nDTEND;TZID=Asia/Hong_Kong:20261014T160000\r\nSUMMARY:${summary}\r\nLOCATION:Campus\r\nEND:VEVENT`
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-subscription-'))
  core = new CalendarCore(directory)
  service = new SubscriptionService(core, value => Buffer.from(value).toString('base64'), value => Buffer.from(value, 'base64').toString())
})
afterEach(() => {
  core.close(); vi.restoreAllMocks()
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-subscription-'))) throw new Error('Unsafe cleanup')
  fs.rmSync(directory, { recursive: true, force: true })
})
describe('Read-only calendar subscriptions', () => {
  it('uses one-time imports and preserves cached data on service construction without a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(makeICS(timed())))
    const { subscription } = await service.add({ name: 'School', url: 'https://example.test/calendar' })
    const stored = core.subscriptions()[0]
    core.saveSubscription({ ...stored, refreshMode: undefined, refreshMinutes: 30, state: 'error', errorCode: 'SUBSCRIPTION_NETWORK_ERROR', message: 'Old auto-refresh failed' })
    const restarted = new SubscriptionService(core, value => value, value => value)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(restarted.list().subscriptions[0]).toMatchObject({ id: subscription.id, refreshMode: 'manual', state: 'cached', message: '', eventCount: 1 })
    expect(restarted.list().subscriptions[0]).not.toHaveProperty('refreshMinutes')
    expect(core.list({})).toHaveLength(1)
  })
  it('parses HKT timed and exclusive all-day dates correctly', async () => {
    const events = await parseSubscriptionICS(makeICS(timed() + '\r\nBEGIN:VEVENT\r\nUID:holiday@school\r\nDTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261017\r\nSUMMARY:学校假期\r\nEND:VEVENT'), 'school')
    expect(events[0]).toMatchObject({ start: '2026-10-14T07:00:00.000Z', end: '2026-10-14T08:00:00.000Z', timezone: 'Asia/Hong_Kong' })
    expect(events[1]).toMatchObject({ start: '2026-10-15', end: '2026-10-17', allDay: true })
  })
  it('expands recurring classes and honors exclusions', async () => {
    const rule = timed().replace('END:VEVENT', 'RRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Asia/Hong_Kong:20261021T150000\r\nEND:VEVENT')
    const events = await parseSubscriptionICS(makeICS(rule), 'school')
    expect(events).toHaveLength(2); expect(events[1].start).toBe('2026-10-28T07:00:00.000Z')
  })
  it('displays a UTC school feed in HKT without shifting its instant', async () => {
    const utc = timed().replace('DTSTART;TZID=Asia/Hong_Kong:20261014T150000', 'DTSTART:20261014T070000Z').replace('DTEND;TZID=Asia/Hong_Kong:20261014T160000', 'DTEND:20261014T080000Z')
    const events = await parseSubscriptionICS(makeICS(utc), 'school')
    expect(events[0]).toMatchObject({ start: '2026-10-14T07:00:00.000Z', end: '2026-10-14T08:00:00.000Z', timezone: 'Asia/Hong_Kong' })
  })
  it('refreshes without duplicates, preserves local IDs and enforces read-only edits', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(makeICS(timed()), { headers: { 'Content-Type': 'text/calendar' } }))
    const { subscription } = await service.add({ name: 'School', url: 'https://example.test/calendar?token=secret' })
    const event = core.list({})[0]
    expect(event.readOnly).toBe(true); expect(service.list().subscriptions[0]).not.toHaveProperty('encryptedUrl')
    await service.refresh({ id: subscription.id }); expect(core.list({})).toHaveLength(1); expect(core.list({})[0].id).toBe(event.id); expect(core.list({})[0].version).toBe(event.version)
    fetchMock.mockImplementation(async () => new Response(makeICS(timed('已更新讲座'))))
    await service.refresh({ id: subscription.id }); expect(core.list({})[0]).toMatchObject({ id: event.id, title: '已更新讲座', version: 2 })
    expect(() => core.execute({ command: 'move', args: { id: event.id, date: '2026-10-15' } })).toThrow('source')
    expect(() => core.execute({ command: 'add', args: { title: '非法写入', calendarId: subscription.calendarId, start: '2026-10-14T15:00:00+08:00', end: '2026-10-14T16:00:00+08:00' } })).toThrow('source')
    expect(await service.add({ name: 'Again', url: 'https://example.test/calendar?token=secret' })).toMatchObject({ duplicate: true })
  })
  it('retains cache on 401, malformed feeds and network failures', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(makeICS(timed())))
    const { subscription } = await service.add({ name: 'School', url: 'https://example.test/calendar?token=secret' })
    mock.mockResolvedValue(new Response('', { status: 401 }))
    const result = await service.refresh({ id: subscription.id })
    expect(result.subscription).toMatchObject({ state: 'error', errorCode: 'SUBSCRIPTION_HTTP_401', eventCount: 1 }); expect(core.list({})).toHaveLength(1)
    mock.mockResolvedValue(new Response('<html>login</html>'))
    await service.refresh({ id: subscription.id }); expect(core.list({})).toHaveLength(1)
    mock.mockRejectedValue(new Error('Network failed https://example.test?token=secret'))
    const failure = await service.refresh({ id: subscription.id }); expect(JSON.stringify(failure)).not.toContain('secret'); expect(core.list({})).toHaveLength(1)
  })
  it('keeps HKU schedule identities stable when the server regenerates UIDs', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(makeICS(timed())))
    const { subscription } = await service.add({ name: 'HKU', url: 'https://hkuesd.hku.hk/calendar?token=test' })
    const original = core.list({})[0]
    mock.mockResolvedValue(new Response(makeICS(timed().replace('lecture@school', 'different-random-uid@school'))))
    const refreshed = await service.refresh({ id: subscription.id })
    expect(refreshed.subscription.changes).toMatchObject({ added: 0, updated: 0, removed: 0 })
    expect(core.list({})).toHaveLength(1); expect(core.list({})[0].id).toBe(original.id)
  })
  it('handles source removal, confirmed unsubscription, and dry-run', async () => {
    await service.add({ name: 'School', url: 'https://example.test/calendar' }, true)
    expect(service.list().subscriptions).toHaveLength(0)
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(makeICS(timed())))
    const { subscription } = await service.add({ name: 'School', url: 'https://example.test/calendar' })
    mock.mockResolvedValue(new Response(makeICS('')))
    await service.refresh({ id: subscription.id }); expect(core.list({})).toHaveLength(0)
    expect(() => service.remove({ id: subscription.id })).toThrow()
    service.remove({ id: subscription.id, confirm: true }); expect(service.list().subscriptions).toHaveLength(0)
  })
})
