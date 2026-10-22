import { DateTime } from 'luxon'
import type { Event } from '../shared/protocol'
import { eventDates } from './eventTime'
import { compareLongEvents, isLongEvent } from './longEvents'
export { eventDates } from './eventTime'

export type MonthSpan = {
  event: Event; start: number; end: number; lane: number; long: boolean; labelled: boolean; continuesBefore: boolean; continuesAfter: boolean
}
export type MonthWeek = { days: string[]; spans: MonthSpan[]; lanes: number[]; sizes: number[]; offsets: number[]; reserved: number[]; height: number }

export function monthWeeks(days: string[], events: Event[], timezone: string, referenceDate = DateTime.now().setZone(timezone).toISODate()!): MonthWeek[] {
  const candidates = events.flatMap(event => {
    const range = eventDates(event, timezone)
    return range && range.start < range.end ? [{ event, long: isLongEvent(event, timezone), ...range }] : []
  })
  const weeks: MonthWeek[] = []
  const labelled = new Set<string>()
  for (let offset = 0; offset < days.length; offset += 7) {
    const dates = days.slice(offset, offset + 7), occupied: boolean[][] = [], spans: MonthSpan[] = [], lanes = dates.map(() => 0)
    const visible = candidates.filter(candidate => candidate.end >= dates[0] && candidate.start <= dates.at(-1)!)
      .sort((a, b) => a.long && b.long ? compareLongEvents(a.event, b.event, referenceDate, timezone) : Number(a.long) - Number(b.long) || a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.event.id.localeCompare(b.event.id))
    for (const candidate of visible) {
      const start = dates.findIndex(day => day >= candidate.start)
      const end = dates.reduce((last, day, index) => day <= candidate.end ? index : last, -1)
      const free = (lane: number) => !occupied[lane]?.slice(start, end + 1).some(Boolean)
      let lane = 0
      while (!free(lane)) lane++
      occupied[lane] ??= dates.map(() => false)
      for (let col = start; col <= end; col++) { occupied[lane][col] = true; lanes[col] = Math.max(lanes[col], lane + 1) }
      // A long event's Sunday start or Monday tail has only one date cell.
      // Defer its label to a wider visible segment; short itineraries keep
      // their labels even when all visible pieces are only one day wide.
      const showLabel = !candidate.long || start !== end && !labelled.has(candidate.event.id)
      spans.push({ event: candidate.event, start, end, lane, long: candidate.long, labelled: showLabel, continuesBefore: candidate.start < dates[0], continuesAfter: candidate.end > dates.at(-1)! })
      if (candidate.long && showLabel) labelled.add(candidate.event.id)
    }
    const sizes = occupied.map((_, lane) => spans.some(span => span.lane === lane && span.labelled) ? 1.85 : .8)
    const offsets = sizes.map((_, lane) => sizes.slice(0, lane).reduce((sum, size) => sum + size, 0))
    const reserved = lanes.map(count => sizes.slice(0, count).reduce((sum, size) => sum + size, 0))
    weeks.push({ days: dates, spans, lanes, sizes, offsets, reserved, height: sizes.reduce((sum, size) => sum + size, 0) })
  }
  return weeks
}
