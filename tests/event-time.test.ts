import { describe, expect, it } from 'vitest'
import type { Event } from '../src/shared/protocol'
import { compareDayEvents, groupDayTime, groupTimeRange, occursOnDay } from '../src/renderer/eventTime'

const zone = 'Asia/Hong_Kong'
const item = (values: Partial<Event>): Event => ({ id: 'sample', calendarId: 'local', title: 'Synthetic appointment', notes: '', start: '2026-10-13T08:00:00Z', end: '2026-10-13T10:00:00Z', timezone: zone, allDay: false, createdAt: '', updatedAt: '', version: 1, deleted: false, ...values })
const group = (items: Event[]) => item({ allDay: true, start: '2026-10-13', end: '2026-10-15', items })

describe('daily appointment order', () => {
  it('orders timed groups by today’s live children, keeping genuine all-day events first', () => {
    const meeting = { ...group([
      item({ start: '2026-10-13T09:00:00Z', end: '2026-10-13T09:00:00Z', pointInTime: true }),
      item({ start: '2026-10-14T01:00:00Z', end: '2026-10-14T02:00:00Z' }),
      item({ deleted: true, allDay: true, start: '2026-10-13', end: '2026-10-14' })
    ]), id: 'meeting' }
    const course = item({ id: 'course', start: '2026-10-13T10:00:00+08:00', end: '2026-10-13T12:20:00+08:00' })
    const holiday = item({ id: 'holiday', allDay: true, start: '2026-10-13', end: '2026-10-14' })
    const original = JSON.stringify([meeting, course, holiday])
    expect([meeting, course, holiday].sort((a, b) => compareDayEvents(a, b, '2026-10-13', zone)).map(event => event.id)).toEqual(['holiday', 'course', 'meeting'])
    expect(compareDayEvents(meeting, item({ start: '2026-10-14T02:00:00Z', end: '2026-10-14T03:00:00Z' }), '2026-10-14', zone)).toBeLessThan(0)
    expect(JSON.stringify([meeting, course, holiday])).toBe(original)
  })
  it('places overnight continuations before later appointments on the new date', () => {
    const overnight = item({ start: '2026-10-12T15:00:00Z', end: '2026-10-12T17:00:00Z' })
    const morning = item({ start: '2026-10-13T01:00:00Z', end: '2026-10-13T02:00:00Z' })
    expect(compareDayEvents(overnight, morning, '2026-10-13', zone)).toBeLessThan(0)
  })
})

describe('itinerary display times', () => {
  it('uses this date’s children, ignoring deleted appointments and the all-day parent envelope', () => {
    const event = group([item({}), item({ start: '2026-10-14T00:00:00Z', end: '2026-10-14T10:00:00Z' }), item({ deleted: true, start: '2026-10-13T00:00:00Z', end: '2026-10-13T12:00:00Z' })])
    const original = JSON.stringify(event)
    expect(groupDayTime(event, '2026-10-13', zone)).toEqual({ time: '16:00–18:00', count: 1 })
    expect(groupDayTime(event, '2026-10-14', zone)).toEqual({ time: '08:00–18:00', count: 1 })
    expect(groupDayTime(event, '2026-10-15', zone)).toEqual({ time: '', count: 0 })
    expect(groupTimeRange(event, zone)).toBe('10.13 16:00 — 10.14 18:00')
    expect(JSON.stringify(event)).toBe(original)
  })
  it('clips overnight events to each date and treats midnight as an exclusive end', () => {
    const event = item({ start: '2026-10-13T15:30:00Z', end: '2026-10-13T17:00:00Z' })
    expect(groupDayTime(group([event]), '2026-10-13', zone).time).toBe('23:30–24:00')
    expect(groupDayTime(group([event]), '2026-10-14', zone).time).toBe('00:00–01:00')
    expect(occursOnDay(item({ end: '2026-10-13T16:00:00Z' }), '2026-10-14', zone)).toBe(false)
  })
  it('keeps a time point as a single time, including a point at midnight', () => {
    const event = item({ start: '2026-10-13T16:00:00Z', end: '2026-10-13T16:00:00Z', pointInTime: true })
    expect(groupDayTime(group([event]), '2026-10-13', zone).count).toBe(0)
    expect(groupDayTime(group([event]), '2026-10-14', zone)).toEqual({ time: '00:00', count: 1 })
  })
  it('displays all-day items without invented hours and preserves exclusive end dates', () => {
    const event = group([item({ allDay: true, start: '2026-10-13', end: '2026-10-15' })])
    expect(groupDayTime(event, '2026-10-14', zone)).toEqual({ time: '全天', count: 1 })
    expect(groupDayTime(event, '2026-10-15', zone).count).toBe(0)
    expect(groupTimeRange(event, zone)).toBe('10.13 — 10.14')
  })
  it('uses the display timezone and correct day boundaries through DST', () => {
    const event = item({ start: '2026-11-01T04:30:00Z', end: '2026-11-02T04:30:00Z' })
    expect(groupDayTime(group([event]), '2026-11-01', 'America/New_York').time).toBe('00:30–23:30')
    expect(groupDayTime(group([event]), '2026-11-02', 'America/New_York').count).toBe(0)
    expect(groupDayTime(group([item({})]), '2026-10-13', 'UTC').time).toBe('08:00–10:00')
  })
})
