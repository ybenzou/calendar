import { Fragment, type CSSProperties, type DragEvent } from 'react'
import { DateTime } from 'luxon'
import type { Event } from '../shared/protocol'
import { activityLevel, type AgentActivityRange } from '../shared/activity'
import { activityTitle } from './AgentActivity'
import { DayEvents } from './DayEvents'
import { compareDayEvents, groupDayTime, groupTimeRange, occursOnDay } from './eventTime'
import { monthWeeks } from './monthSpans'
import { deadlineLabel, deadlineUrgency, longEventLabel, milestonesInRange, upcomingMilestones } from './longEvents'
import { UrgencyBadge } from './UrgencyBadge'
import { subjectColor } from './subjectColor'

type Props = {
  days: DateTime[]; events: Event[]; timezone: string; month: number; today: string | null; selectedDate: string; groupId?: string; referenceDate?: string
  activity: AgentActivityRange; color: (event: Event) => string | undefined
  onView: (date: string, groupId?: string) => void; onMove: (id: string, date: string) => void; onEdit: (event: Event) => void
}
function spanTime(event: Event, timezone: string) {
  if (event.items) return groupTimeRange(event, timezone)
  if (event.allDay) return `${DateTime.fromISO(event.start).toFormat('MM.dd')} — ${DateTime.fromISO(event.end).minus({ days: 1 }).toFormat('MM.dd')}`
  return `${DateTime.fromISO(event.start).setZone(timezone).toFormat('MM.dd HH:mm')} — ${DateTime.fromISO(event.end).setZone(timezone).toFormat('MM.dd HH:mm')}`
}
export function MonthGrid(props: Props) {
  const { days, events, timezone, activity, onView, onEdit } = props
  const reference = props.referenceDate || props.today || undefined
  const weeks = monthWeeks(days.map(day => day.toISODate()!), events, timezone, reference)
  const spanning = new Set(weeks.flatMap(week => week.spans.map(span => span.event.id)))
  function drag(event: DragEvent, entry: Event) {
    event.stopPropagation(); event.dataTransfer.setData('calendar/event', entry.id); event.dataTransfer.effectAllowed = 'move'
  }
  return <div className="grid month-grid" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(min-content,1fr))` }}>
    {weeks.map(week => <div className={`month-week ${week.spans.length ? 'has-spans' : ''} ${week.spans.some(span => span.long) ? 'has-long-spans' : ''}`} key={week.days[0]} style={{ '--week-span-height': `${week.height}em` } as CSSProperties}>
      {week.days.map((iso, col) => {
        const date = DateTime.fromISO(iso)
        const heat = activity.days[iso] ? activityLevel(activity.days[iso]) : 0
        const entries = events.filter(event => !spanning.has(event.id) && (event.items ? event.items.some(item => occursOnDay(item, iso, timezone)) : occursOnDay(event, iso, timezone))).sort((a, b) => compareDayEvents(a, b, iso, timezone))
        return <div key={iso} data-date={iso} data-heat={activity.days[iso] ? activityLevel(activity.days[iso]) : 0} title={activityTitle(activity.days[iso])} tabIndex={0} role="button" aria-label={iso} aria-current={iso === props.today ? 'date' : undefined} className={`day ${date.month !== props.month ? 'outside' : ''} ${iso === props.selectedDate ? 'selected' : ''} ${iso === props.today ? 'today' : ''}`} style={{ gridColumn: col + 1, gridRow: 1 }} onClick={() => onView(iso)} onKeyDown={event => { if (event.key === 'Enter') onView(iso) }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('calendar/event'); if (id) props.onMove(id, iso) }}>
          <div className="day-number"><span className="day-date" title={iso === props.today ? '今天' : undefined}>{date.day}</span>{iso === props.today && <span className="today-label">TODAY</span>}{heat > 0 && <span className="day-activity-indicator" role="img" aria-label={activityTitle(activity.days[iso])} title={activityTitle(activity.days[iso])}/>}</div>
          {week.lanes[col] > 0 && <div className="day-span-space" aria-hidden="true" style={{ height: `${week.reserved[col]}em` }}/>}<DayEvents total={entries.length} onMore={() => onView(iso)}>{entries.slice(0, 3).map(entry => <div key={entry.id} className={`event-chip ${entry.items ? 'group-chip' : ''}`} role="button" tabIndex={0} aria-label={entry.title} onClick={event => { event.stopPropagation(); onView(iso, entry.items ? entry.id : undefined) }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); onView(iso, entry.items ? entry.id : undefined) } }} draggable={!entry.readOnly} title={entry.items ? `${entry.title} · ${groupDayTime(entry, iso, timezone).time} · 当天 ${groupDayTime(entry, iso, timezone).count} 项` : entry.title} onDragStart={event => drag(event, entry)} onDoubleClick={event => { event.stopPropagation(); if (!entry.readOnly) onEdit(entry) }} style={{ borderColor: props.color(entry) }}><span className="event-clock">{entry.items ? groupDayTime(entry, iso, timezone).time : entry.allDay ? '全天' : DateTime.fromISO(entry.start).setZone(timezone).toFormat('HH:mm')}</span><span className="event-title">{entry.title}</span></div>)}</DayEvents>
        </div>
      })}
      {week.spans.map(span => {
        const referenceDate = reference && reference > week.days[0] ? reference : week.days[0]
        const next = span.long ? upcomingMilestones(span.event, referenceDate, timezone)[0] : undefined
        const urgency = next ? deadlineUrgency(next.end, props.today || referenceDate) : undefined
        const markers = span.long ? milestonesInRange(span.event, week.days[span.start], week.days[span.end], timezone) : []
        const ink = subjectColor(span.event.title)
        return <Fragment key={span.event.id}><button type="button" className={`month-span ${span.long ? 'long-range' : ''} ${!span.labelled ? 'continuation-track' : ''} ${span.event.items ? 'group-chip' : ''} ${span.continuesBefore ? 'continues-before' : ''} ${span.continuesAfter ? 'continues-after' : ''} ${props.groupId === span.event.id ? 'active' : ''}`} data-event-id={span.event.id} data-start={week.days[span.start]} data-end={week.days[span.end]} data-lane={span.lane} data-next-date={next?.end} data-urgency={urgency?.level} aria-label={`${span.event.title} · ${spanTime(span.event, timezone)}${urgency ? ` · ${urgency.label}` : ''}`} title={`${span.event.title} · ${spanTime(span.event, timezone)}${span.event.items ? ` · ${span.event.items.filter(item => !item.deleted).length} 项安排` : ''}`} style={{ gridColumn: `${span.start + 1} / ${span.end + 2}`, gridRow: 1, marginTop: `calc(var(--span-top) + ${week.offsets[span.lane]}em)`, '--event-color': props.color(span.event) || 'var(--accent)', '--subject-color': ink } as CSSProperties} onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const offset = event.detail ? Math.min(span.end - span.start, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * (span.end - span.start + 1)))) : 0
        onView(week.days[span.start + offset], span.event.items ? span.event.id : undefined)
      }} draggable={!span.event.readOnly} onDragStart={event => drag(event, span.event)} onDoubleClick={() => { if (!span.event.readOnly) onEdit(span.event) }}>
        {span.labelled && <>{span.continuesBefore && <span className="span-continuation" aria-hidden="true">‹</span>}<span className="span-title">{span.long ? longEventLabel(span.event) : span.event.title}</span><UrgencyBadge urgency={urgency}/><span className="span-time">{span.long ? (next ? deadlineLabel(next.end) : '—') : spanTime(span.event, timezone)}</span>{span.continuesAfter && <span className="span-continuation" aria-hidden="true">›</span>}</>}
      </button>{markers.map(marker => {
        const state = deadlineUrgency(marker.day, props.today || referenceDate)
        const label = `${longEventLabel(span.event)} · ${deadlineLabel(marker.day)} · ${marker.events.map(item => item.title).join('；')}`
        return <button key={marker.day} type="button" className={`month-milestone ${!span.labelled ? 'continuation-track' : ''}`} data-event-id={span.event.id} data-milestone-date={marker.day} data-urgency={state.level} aria-label={label} title={label} style={{ gridColumn: week.days.indexOf(marker.day) + 1, gridRow: 1, marginTop: `calc(var(--span-top) + ${week.offsets[span.lane]}em)`, '--subject-color': ink } as CSSProperties} onClick={() => onView(marker.day, span.event.items ? span.event.id : undefined)}><span className="milestone-diamond" aria-hidden="true"/></button>
      })}</Fragment>})}
    </div>)}
  </div>
}
