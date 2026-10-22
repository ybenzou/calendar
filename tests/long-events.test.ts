import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { Event } from '../src/shared/protocol'
import { compareLongEvents, deadlineUrgency, isLongEvent, longEventLabel, milestonesInRange, upcomingMilestones } from '../src/renderer/longEvents'
import { monthWeeks } from '../src/renderer/monthSpans'

const zone = 'Asia/Hong_Kong'
const event = (values: Partial<Event>): Event => ({ id: 'sample', calendarId: 'local', title: 'Course', notes: '', start: '2026-10-21', end: '2026-12-11', allDay: true, timezone: zone, version: 1, deleted: false, createdAt: '', updatedAt: '', ...values })
const deadline = (day: string, values: Partial<Event> = {}) => event({ start: day, end: DateTime.fromISO(day).plus({ days: 1 }).toISODate()!, ...values })
const group = (id: string, days: string[]) => event({ id, title: id, items: [event({ id: 'preparation', end: '2026-10-29' }), ...days.map(day => deadline(day))] })

describe('long reminder urgency', () => {
  it('marks actual milestone dates once per day, retaining history and excluding preparation and deleted children', () => {
    const value = event({ items: [event({ id: 'prep' }), deadline('2026-11-13', { id: 'a' }), deadline('2026-11-13', { id: 'b' }), deadline('2026-11-14', { deleted: true }), deadline('2026-11-20', { id: 'c' })] })
    const before = JSON.stringify(value)
    expect(milestonesInRange(value, '2026-11-09', '2026-11-15', zone).map(mark => ({ day: mark.day, ids: mark.events.map(e => e.id) }))).toEqual([{ day: '2026-11-13', ids: ['a', 'b'] }])
    expect(milestonesInRange(value, '2026-11-16', '2026-11-22', zone).map(mark => mark.day)).toEqual(['2026-11-20'])
    expect(milestonesInRange(value, '2026-10-26', '2026-11-01', zone)).toEqual([])
    expect(JSON.stringify(value)).toBe(before)
  })
  it('places timed nodes in the display timezone and marks standalone final days with exclusive ends', () => {
    const value = event({ items: [event({ id: 'prep' }), event({ id: 'point', start: '2026-11-12T16:00:00Z', end: '2026-11-12T16:00:00Z', allDay: false, pointInTime: true }), event({ id: 'midnight', start: '2026-11-13T10:00:00+08:00', end: '2026-11-14T00:00:00+08:00', allDay: false })] })
    expect(milestonesInRange(value, '2026-11-13', '2026-11-13', zone)[0].events.map(e => e.id)).toEqual(['point', 'midnight'])
    expect(milestonesInRange(event({ end: '2026-11-27' }), '2026-11-23', '2026-11-29', zone)[0].day).toBe('2026-11-26')
  })
  it('uses upcoming milestones rather than preparation or the last group end, and advances after each date', () => {
    const entries = [group('URBP8002', ['2026-12-10']), group('GRSC6108', ['2026-11-26']), group('RECO7097', ['2026-11-13', '2026-11-20', '2026-11-27']), group('RECO6022', ['2026-11-13', '2026-11-30'])]
    const before = JSON.stringify(entries)
    const ordered = (day: string) => [...entries].sort((a, b) => compareLongEvents(a, b, day, zone)).map(entry => entry.id)
    expect(ordered('2026-10-21')).toEqual(['RECO6022', 'RECO7097', 'GRSC6108', 'URBP8002'])
    expect(ordered('2026-11-14')).toEqual(['RECO7097', 'GRSC6108', 'RECO6022', 'URBP8002'])
    expect(ordered('2026-11-21')).toEqual(['GRSC6108', 'RECO7097', 'RECO6022', 'URBP8002'])
    expect(upcomingMilestones(entries[2], '2026-11-21', zone).map(next => next.end)).toEqual(['2026-11-27'])
    expect(JSON.stringify(entries)).toBe(before)
  })
  it('keeps today, excludes deleted and past milestones, respects display timezone and leaves history intact', () => {
    const value = event({ items: [deadline('2026-10-20'), deadline('2026-10-21', { title: 'Check submission' }), deadline('2026-10-22', { deleted: true }), event({ allDay: false, start: '2026-10-22T16:00:00Z', end: '2026-10-22T17:00:00Z' })] })
    expect(upcomingMilestones(value, '2026-10-21', zone).map(next => next.end)).toEqual(['2026-10-21', '2026-10-23'])
    expect(upcomingMilestones(value, '2026-10-24', zone)).toEqual([])
    expect(value.items).toHaveLength(4)
    expect(value.items![0].deleted).toBe(false)
    expect(upcomingMilestones(event({ start: '2026-10-21', end: '2026-11-02' }), '2026-10-21', zone)[0].end).toBe('2026-11-01')
  })
  it('distinguishes two-week windows from short events and shortens only a display label', () => {
    const long = event({ title: 'RECO7097 作业 · 11/13、11/20、11/27', end: '2026-11-04' })
    expect(isLongEvent(long, zone)).toBe(true)
    expect(isLongEvent(event({ end: '2026-11-03' }), zone)).toBe(false)
    expect(longEventLabel(long)).toBe('RECO7097 作业')
    expect(long.title).toContain('11/13')
  })
  it('keeps continuation order traceable and reserves less space after the first labels', () => {
    const entries = [group('Later', ['2026-11-30']), group('Soon', ['2026-11-13', '2026-12-10']), group('Middle', ['2026-11-20'])]
    const days = Array.from({ length: 35 }, (_, index) => DateTime.fromISO('2026-10-19').plus({ days: index }).toISODate()!)
    const weeks = monthWeeks(days, entries, zone, '2026-10-21')
    expect(weeks[0].spans.map(span => span.event.id)).toEqual(['Soon', 'Middle', 'Later'])
    expect(weeks[4].spans.map(span => span.event.id)).toEqual(['Soon', 'Middle', 'Later'])
    expect(weeks[4].spans.map(span => span.lane)).toEqual([0, 1, 2])
    expect(weeks[0].height).toBeCloseTo(3 * 1.85)
    expect(weeks[0].reserved[2]).toBeCloseTo(3 * 1.85)
    expect(weeks[4].height).toBeCloseTo(3 * .8)
    expect(weeks[0].spans.every(span => span.labelled)).toBe(true)
    expect(weeks.slice(1).flatMap(week => week.spans).every(span => !span.labelled)).toBe(true)
  })
  it('makes remaining time explicit and distinguishes today, three days, a week and later dates', () => {
    expect(deadlineUrgency('2026-10-20', '2026-10-21')).toMatchObject({ days: -1, label: '已过1天', level: 'past' })
    expect(deadlineUrgency('2026-10-21', '2026-10-21')).toMatchObject({ days: 0, label: '今天', level: 'today' })
    expect(deadlineUrgency('2026-10-22', '2026-10-21')).toMatchObject({ label: '明天', level: 'critical' })
    expect(deadlineUrgency('2026-10-24', '2026-10-21')).toMatchObject({ days: 3, label: '剩3天', level: 'critical' })
    expect(deadlineUrgency('2026-10-28', '2026-10-21')).toMatchObject({ days: 7, level: 'soon' })
    expect(deadlineUrgency('2026-10-29', '2026-10-21')).toMatchObject({ days: 8, level: 'normal' })
    expect(deadlineUrgency('2026-11-13', '2026-10-21')).toMatchObject({ days: 23, label: '剩23天', level: 'normal' })
  })
})
