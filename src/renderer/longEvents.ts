import { DateTime } from 'luxon'
import type { Event } from '../shared/protocol'
import { eventDates } from './eventTime'

export function isLongEvent(event: Event, timezone: string): boolean {
  const range = eventDates(event, timezone)
  return !!range && DateTime.fromISO(range.end).diff(DateTime.fromISO(range.start), 'days').days >= 13
}

function leaves(event: Event): Event[] {
  return event.deleted ? [] : event.items ? event.items.flatMap(leaves) : [event]
}

/** Dated milestones take precedence over broad preparation/participation windows. */
export function upcomingMilestones(event: Event, referenceDate: string, timezone: string) {
  const entries = leaves(event).flatMap(item => {
    const range = eventDates(item, timezone)
    return range ? [{ event: item, ...range }] : []
  })
  const milestones = entries.filter(item => item.start === item.end)
  return (milestones.length ? milestones : entries).filter(item => item.end >= referenceDate)
    .sort((a, b) => a.end.localeCompare(b.end) || a.event.end.localeCompare(b.event.end) || a.event.title.localeCompare(b.event.title))
}

export function compareLongEvents(a: Event, b: Event, referenceDate: string, timezone: string): number {
  const nextA = upcomingMilestones(a, referenceDate, timezone)[0]?.end || '9999-12-31'
  const nextB = upcomingMilestones(b, referenceDate, timezone)[0]?.end || '9999-12-31'
  return nextA.localeCompare(nextB) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

/** Keep historical nodes visible and put same-day tasks on one marker. */
export function milestonesInRange(event: Event, from: string, to: string, timezone: string) {
  const dates = new Map<string, Event[]>()
  for (const item of upcomingMilestones(event, from, timezone)) {
    if (item.end > to) continue
    dates.set(item.end, [...(dates.get(item.end) || []), item.event])
  }
  return [...dates].map(([day, events]) => ({ day, events }))
}

export function longEventLabel(event: Event): string {
  return event.title.split(/\s+·\s+/)[0]
}

export function deadlineLabel(day: string): string {
  return DateTime.fromISO(day).toFormat('MM.dd')
}

export function deadlineUrgency(day: string, today: string) {
  const days = Math.round(DateTime.fromISO(day).diff(DateTime.fromISO(today), 'days').days)
  const level = days < 0 ? 'past' : days === 0 ? 'today' : days <= 3 ? 'critical' : days <= 7 ? 'soon' : 'normal'
  const label = days < 0 ? `已过${-days}天` : days === 0 ? '今天' : days === 1 ? '明天' : `剩${days}天`
  return { days, level, label }
}
