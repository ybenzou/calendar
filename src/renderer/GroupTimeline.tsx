import { DateTime } from 'luxon'
import { useState } from 'react'
import type { Event } from '../shared/protocol'
import { RouteMap, routeSummary } from './RouteMap'

export function GroupTimeline({ group, timezone, onEdit, onDelete }: { group: Event; timezone: string; onEdit?: (item: Event) => void; onDelete?: (item: Event) => void }) {
  const [selectedId, setSelectedId] = useState<string>()
  const items = [...(group.items || [])].filter(item => !item.deleted).sort((a, b) => a.start.localeCompare(b.start))
  const located = items.filter(item => item.location || item.route)
  const days = new Map<string, Event[]>()
  for (const item of items) {
    const day = item.allDay ? item.start : DateTime.fromISO(item.start).setZone(timezone).toISODate()!
    days.set(day, [...(days.get(day) || []), item])
  }
  return <div className="group-timeline">
    {!!located.length && <RouteMap events={items} selectedId={selectedId} onSelect={setSelectedId}/>}
    <div className="timeline-scroll">{[...days].map(([day, items]) => <details className="timeline-day" key={day} open><summary><span>{DateTime.fromISO(day).setLocale('zh').toFormat('MM月dd日 cccc')}</span><small>{items.length} 项</small></summary><ol>{items.map(item => <li className={item.id === selectedId ? 'route-selected' : ''} key={item.id} data-item-id={item.id}><div className="timeline-time">{item.allDay ? '全天' : DateTime.fromISO(item.start).setZone(timezone).toFormat('HH:mm')}{!item.allDay && !item.pointInTime && <> — {DateTime.fromISO(item.end).setZone(timezone).toFormat('HH:mm')}</>}{item.pointInTime && <span>时间点</span>}</div><h3>{item.location || item.route ? <button className="timeline-place" onClick={() => { setSelectedId(item.id) }}>{item.title}</button> : item.title}</h3>{(item.location || item.route) && <p className="route-summary">{routeSummary(item)}</p>}{item.notes && <p>{item.notes}</p>}{onEdit && <div className="timeline-actions"><button onClick={() => onEdit(item)}>编辑</button>{onDelete && <button onClick={() => onDelete(item)}>删除</button>}</div>}</li>)}</ol></details>)}</div></div>
}
