import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Event } from '../src/shared/protocol'
import { eventDates, monthWeeks } from '../src/renderer/monthSpans'

const zone = 'Asia/Hong_Kong'
const event = (values: Partial<Event>): Event => ({ id: 'sample', calendarId: 'local', title: 'Workshop', notes: '', start: '2026-10-13', end: '2026-10-15', allDay: true, timezone: zone, version: 1, deleted: false, createdAt: '', updatedAt: '', ...values })
const days = (start: string, count: number) => Array.from({ length: count }, (_, index) => DateTime.fromISO(start).plus({ days: index }).toISODate()!)

describe('continuous month strips', () => {
  it('keeps a Monday tail compact when it is the first visible segment of the next month', () => {
    const value = event({ id: 'course', start: '2026-10-21', end: '2026-12-01' })
    const weeks = monthWeeks(days('2026-11-30', 35), [value], zone, '2026-12-01')
    expect(weeks[0].spans[0]).toMatchObject({ start: 0, end: 0, labelled: false, continuesBefore: true, continuesAfter: false })
    expect(weeks[0].height).toBe(.8)
    expect(weeks.slice(1).every(week => !week.spans.length)).toBe(true)
  })
  it('defers a Sunday start label until a wider following week', () => {
    const value = event({ id: 'course', start: '2026-11-01', end: '2026-12-01' })
    const weeks = monthWeeks(days('2026-10-26', 42), [value], zone, '2026-11-01')
    expect(weeks[0].spans[0]).toMatchObject({ start: 6, end: 6, labelled: false, continuesAfter: true })
    expect(weeks[1].spans[0]).toMatchObject({ start: 0, end: 6, labelled: true })
    expect(weeks.flatMap(week => week.spans).filter(span => span.labelled)).toHaveLength(1)
  })
  it('labels each long event at its first visible week, including a newly started event, while short spans retain labels', () => {
    const entries = [event({ id: 'earlier', start: '2026-09-01', end: '2026-12-01' }), event({ id: 'new', start: '2026-11-12', end: '2026-12-01' }), event({ id: 'short', start: '2026-11-01', end: '2026-11-03' })]
    const before = JSON.stringify(entries)
    const weeks = monthWeeks(days('2026-10-26', 42), entries, zone, '2026-11-01')
    for (const id of ['earlier', 'new']) {
      const spans = weeks.flatMap(week => week.spans).filter(span => span.event.id === id)
      expect(spans.filter(span => span.labelled)).toHaveLength(1)
      expect(spans[0].labelled).toBe(true)
      expect(spans.slice(1).every(span => !span.labelled)).toBe(true)
    }
    expect(weeks.flatMap(week => week.spans).filter(span => span.event.id === 'short').every(span => span.labelled)).toBe(true)
    expect(JSON.stringify(entries)).toBe(before)
  })
  it('uses active group children, including the gap between appointments, without changing stored events', () => {
    const group = event({ start: '2026-01-01', end: '2027-01-01', items: [
      event({ start: '2026-10-13T01:00:00Z', end: '2026-10-13T02:00:00Z', allDay: false }),
      event({ start: '2026-10-15T09:00:00Z', end: '2026-10-15T10:00:00Z', allDay: false }),
      event({ start: '2026-10-19', end: '2026-10-20', deleted: true })
    ] })
    const before = JSON.stringify(group)
    const [week] = monthWeeks(days('2026-10-12', 7), [group], zone)
    expect(eventDates(group, zone)).toEqual({ start: '2026-10-13', end: '2026-10-15' })
    expect(week.spans).toHaveLength(1)
    expect(week.spans[0]).toMatchObject({ start: 1, end: 3, lane: 0 })
    expect(week.lanes).toEqual([0, 1, 1, 1, 0, 0, 0])
    expect(JSON.stringify(group)).toBe(before)
  })
  it('respects local midnight, exclusive all-day ends, point events and display timezone', () => {
    expect(eventDates(event({}), zone)).toEqual({ start: '2026-10-13', end: '2026-10-14' })
    expect(eventDates(event({ allDay: false, start: '2026-10-13T15:00:00Z', end: '2026-10-13T16:00:00Z' }), zone)).toEqual({ start: '2026-10-13', end: '2026-10-13' })
    expect(eventDates(event({ allDay: false, start: '2026-10-13T16:00:00Z', end: '2026-10-13T16:00:00Z', pointInTime: true }), zone)).toEqual({ start: '2026-10-14', end: '2026-10-14' })
    expect(monthWeeks(days('2026-10-12', 7), [event({ deleted: true }), event({ items: [] }), event({ end: '2026-10-14', start: '2026-10-13' })], zone)[0].spans).toEqual([])
  })
  it('continues across weeks and month edges, and keeps overlapping strips in distinct stable lanes', () => {
    const entries = [event({ id: 'long', start: '2026-10-01', end: '2026-10-13' }), event({ id: 'overlap', start: '2026-10-03', end: '2026-10-07' }), event({ id: 'later', start: '2026-10-07', end: '2026-10-10' })]
    const weeks = monthWeeks(days('2026-10-05', 14), entries, zone)
    expect(weeks[0].spans.find(span => span.event.id === 'long')).toMatchObject({ start: 0, end: 6, lane: 0, continuesBefore: true, continuesAfter: true })
    expect(weeks[1].spans[0]).toMatchObject({ start: 0, end: 0, lane: 0, continuesBefore: true, continuesAfter: false })
    expect(weeks[0].spans.find(span => span.event.id === 'overlap')!.lane).toBe(1)
    expect(weeks[0].spans.find(span => span.event.id === 'later')!.lane).toBe(1)
    for (const week of weeks) for (const a of week.spans) for (const b of week.spans) {
      if (a !== b && a.start <= b.end && b.start <= a.end) expect(a.lane).not.toBe(b.lane)
    }
  })
})
