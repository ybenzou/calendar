import { DateTime } from 'luxon'
import type { Event } from '../shared/protocol'

/** Inclusive display dates; midnight and all-day ends remain exclusive. */
export function eventDates(event: Event, timezone: string): { start: string; end: string } | null {
  if (event.deleted) return null
  if (event.items) {
    const ranges = event.items.map(item => eventDates(item, timezone)).filter(range => range !== null)
    if (!ranges.length) return null
    return { start: ranges.map(range => range.start).sort()[0], end: ranges.map(range => range.end).sort().at(-1)! }
  }
  const start = event.allDay ? DateTime.fromISO(event.start, { zone: timezone }) : DateTime.fromISO(event.start).setZone(timezone)
  const until = event.allDay ? DateTime.fromISO(event.end, { zone: timezone }) : DateTime.fromISO(event.end).setZone(timezone)
  const end = event.pointInTime ? start : until.minus({ milliseconds: 1 })
  if (!start.isValid || !end.isValid) return null
  return { start: start.toISODate()!, end: end.toISODate()! }
}

export function occursOnDay(event: Event, day: string, timezone: string): boolean {
  if (event.deleted) return false
  if (event.allDay) return event.start <= day && event.end > day
  const start = DateTime.fromISO(day, { zone: timezone }).startOf('day').toMillis()
  const end = DateTime.fromISO(day, { zone: timezone }).plus({ days: 1 }).startOf('day').toMillis()
  const from = DateTime.fromISO(event.start).toMillis(), to = DateTime.fromISO(event.end).toMillis()
  return event.pointInTime ? from >= start && from < end : from < end && to > start
}

/** Sort the appointments visible today, not an activity group's storage envelope. */
export function compareDayEvents(a: Event, b: Event, day: string, timezone: string): number {
  const midnight = DateTime.fromISO(day, { zone: timezone }).startOf('day').toMillis()
  const order = (event: Event) => {
    const items = (event.items || [event]).filter(item => occursOnDay(item, day, timezone))
    const allDay = items.some(item => item.allDay)
    const start = allDay ? midnight : Math.max(midnight, Math.min(...items.map(item => DateTime.fromISO(item.start).toMillis())))
    return { allDay, start }
  }
  const left = order(a), right = order(b)
  return Number(right.allDay) - Number(left.allDay) || left.start - right.start || a.id.localeCompare(b.id)
}

/** Actual children on this date, rather than the parent's all-day storage envelope. */
export function groupDayTime(group: Event, day: string, timezone: string): { time: string; count: number } {
  const items = (group.items || []).filter(item => occursOnDay(item, day, timezone))
  if (!items.length) return { time: '', count: 0 }
  if (items.some(item => item.allDay)) return { time: '全天', count: items.length }
  const start = DateTime.fromISO(day, { zone: timezone }).startOf('day')
  const end = start.plus({ days: 1 })
  const from = Math.max(start.toMillis(), Math.min(...items.map(item => DateTime.fromISO(item.start).toMillis())))
  const to = Math.min(end.toMillis(), Math.max(...items.map(item => DateTime.fromISO(item.end).toMillis())))
  const clock = (ms: number) => ms === end.toMillis() ? '24:00' : DateTime.fromMillis(ms, { zone: timezone }).toFormat('HH:mm')
  return { time: from === to ? clock(from) : `${clock(from)}–${clock(to)}`, count: items.length }
}

/** The full itinerary's real first and last appointments, in the display timezone. */
export function groupTimeRange(group: Event, timezone: string): string {
  const items = (group.items || []).filter(item => !item.deleted)
  if (!items.length) return ''
  const instant = (value: string, allDay: boolean) => allDay ? DateTime.fromISO(value, { zone: timezone }) : DateTime.fromISO(value).setZone(timezone)
  const first = [...items].sort((a, b) => instant(a.start, a.allDay).toMillis() - instant(b.start, b.allDay).toMillis())[0]
  const last = [...items].sort((a, b) => instant(b.end, b.allDay).toMillis() - instant(a.end, a.allDay).toMillis())[0]
  const from = instant(first.start, first.allDay)
  const until = instant(last.end, last.allDay)
  const to = last.allDay ? until.minus({ days: 1 }) : until
  return `${from.toFormat(first.allDay ? 'MM.dd' : 'MM.dd HH:mm')} — ${to.toFormat(last.allDay ? 'MM.dd' : 'MM.dd HH:mm')}`
}
