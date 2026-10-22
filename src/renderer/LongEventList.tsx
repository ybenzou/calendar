import type { CSSProperties } from 'react'
import type { Event } from '../shared/protocol'
import { deadlineLabel, deadlineUrgency, longEventLabel, upcomingMilestones } from './longEvents'
import { RouteMap, routeSummary } from './RouteMap'
import { UrgencyBadge } from './UrgencyBadge'
import { subjectColor } from './subjectColor'

type Props = {
  events: Event[]; referenceDate: string; timezone: string; today?: string
  onOpen: (event: Event) => void; onEdit: (event: Event) => void; onDelete: (event: Event) => void
}
export function LongEventList({ events, referenceDate, timezone, today, onOpen, onEdit, onDelete }: Props) {
  if (!events.length) return null
  return <section className="long-reminders" aria-label="长期提醒">
    <div className="long-reminders-heading"><h3>长期提醒</h3><span>按下一截止日</span></div>
    {events.map(event => {
      const milestones = upcomingMilestones(event, referenceDate, timezone), next = milestones[0]
      const urgency = next ? deadlineUrgency(next.end, today || referenceDate) : undefined
      const row = <><span className="long-reminder-name">{longEventLabel(event)}</span><UrgencyBadge urgency={urgency}/><span className="long-reminder-next">{next?.event.title || '暂无后续日期事项'}</span><span className="long-reminder-meta"><span className="long-reminder-date">{next ? deadlineLabel(next.end) : '—'}</span><span className="long-reminder-count">{milestones.length} 项</span></span></>
      return <article className="long-reminder" key={event.id} data-event-id={event.id} data-urgency={urgency?.level} style={{ '--subject-color': subjectColor(event.title) } as CSSProperties}>
        {event.items ? <button className="long-reminder-row" onClick={() => onOpen(event)} title={event.notes || event.title} aria-label={`${event.title}${next ? `，下一项 ${deadlineLabel(next.end)}` : ''}`}>{row}</button> : <details><summary className="long-reminder-row">{row}</summary><div className="long-reminder-detail">{event.notes && <p>{event.notes}</p>}{(event.location || event.route) && <><RouteMap events={[event]}/><p>{routeSummary(event)}</p></>}{!event.readOnly && <div className="event-actions"><button onClick={() => onEdit(event)}>编辑</button><button onClick={() => onDelete(event)}>删除</button></div>}</div></details>}
      </article>
    })}
  </section>
}
