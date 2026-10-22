import { useState } from 'react'
import { workTimeLabel, type AgentActivityDay, type AgentActivityProject } from '../shared/activity'

export function activityTitle(day?: AgentActivityDay): string {
  if (!day?.known) return 'Agent 活跃度：无采集数据'
  return `Agent 工作时长：${day.workKnown ? workTimeLabel(day.workMs) : '未采集'}；${day.toolCalls} 次工具调用，${day.completedTasks} 个完成任务${day.partial ? '（部分记录）' : ''}`
}
export function activityBadge(day: AgentActivityDay | undefined): string {
  if (!day?.known) return ''
  if (!day.workKnown || !day.workMs) return ''
  return day.workMs >= 3600_000 ? `${Math.floor(day.workMs / 3600_000)}h` : day.workMs >= 60_000 ? `${Math.floor(day.workMs / 60_000)}m` : '<1m'
}

function compactTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000), hours = Math.floor(minutes / 60)
  return ms > 0 && !minutes ? '<1m' : hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`
}

function MetricIcon({ kind }: { kind: 'tools' | 'start' | 'done' | 'failed' }) {
  const paths = { tools: 'M3 3h5v5H3z M12 3h5v5h-5z M3 12h5v5H3z M12 12h5v5h-5z', start: 'm7 4 9 6-9 6Z', done: 'm4 10 4 4 8-8', failed: 'm5 5 10 10 M15 5 5 15' }
  return <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={paths[kind]}/></svg>
}

function ProjectBar({ project, max }: { project: AgentActivityProject; max: number }) {
  const description = `${project.project} · ${project.client} · ${project.workKnown ? workTimeLabel(project.workMs) : '时长未采集'} · ${project.toolCalls} 次工具调用 · ${project.startedTasks} 个开始 · ${project.completedTasks} 个完成 · ${project.failedTools} 次工具失败`
  return <div className="agent-project" title={description} aria-label={description} tabIndex={0}>
    <span className="agent-project-name">{project.project}</span>
    <span className={`agent-project-track ${project.workKnown ? '' : 'unknown'}`} role="img" aria-label={project.workKnown ? `${workTimeLabel(project.workMs)}，最长项目的 ${Math.round(project.workMs / max * 100)}%` : '时长未采集'}>{project.workKnown && <i style={{ width: `${project.workMs / max * 100}%` }}/>}</span>
    <span className="agent-project-time">{project.workKnown ? compactTime(project.workMs) : '—'}</span>
  </div>
}

export function AgentDayDetails({ day, available }: { day?: AgentActivityDay; available: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const projects = [...(day?.projects || [])].sort((a, b) => Number(b.workKnown) - Number(a.workKnown) || b.workMs - a.workMs || b.toolCalls - a.toolCalls || a.id.localeCompare(b.id))
  const max = Math.max(1, ...projects.filter(project => project.workKnown).map(project => project.workMs))
  const metrics = day ? [
    { kind: 'tools' as const, label: '工具调用', value: day.toolCalls },
    { kind: 'start' as const, label: '开始任务', value: day.startedTasks },
    { kind: 'done' as const, label: '完成任务', value: day.completedTasks },
    { kind: 'failed' as const, label: '工具失败', value: day.failedTools }
  ] : []
  return <section className="agent-day-details" aria-label="当日 Agent 活动">
    <div className="agent-details-heading"><h3>Agent 活动</h3><div className="agent-heading-meta">
      {day?.known && <strong className="agent-work-total" aria-label={`累计工作时长：${day.workKnown ? workTimeLabel(day.workMs) : '未采集'}`} title="累计工作时长；并行会话分别累计，扣除已记录的等待确认。">{day.workKnown ? compactTime(day.workMs) : '—'}</strong>}
      {day?.partial && <span className="agent-partial" tabIndex={0} aria-label="部分记录：仅统计已收到的记录，实际活动可能更多" title="部分记录：仅统计已收到的记录，实际活动可能更多">◐</span>}
    </div></div>
    {!day?.known ? <p className="agent-no-data">{available ? '这一天还没有采集数据。' : '暂无采集数据，后续活动会自动记录。'}</p> : <>
      {!!projects.length && <div className="agent-project-chart" role="group" aria-label="项目工作时长比较；横条共用比例尺，悬停或聚焦查看明细">{(expanded ? projects : projects.slice(0, 4)).map(project => <ProjectBar key={project.id} project={project} max={max}/>)}</div>}
      {projects.length > 4 && <button className="agent-project-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `另 ${projects.length - 4} 个项目`}</button>}
      <dl className="agent-totals">{metrics.map(metric => <div key={metric.kind} className={metric.kind === 'failed' && metric.value ? 'agent-failures' : ''} title={`${metric.label}：${metric.value}`} tabIndex={0} aria-label={`${metric.label}：${metric.value}`}><dt><MetricIcon kind={metric.kind}/><span className="visually-hidden">{metric.label}</span></dt><dd>{metric.value}</dd></div>)}</dl>
    </>}
    {!available && day?.known && <p className="agent-data-note">采集暂不可用，显示已保存的记录。</p>}
  </section>
}

export function AgentHeatLegend() {
  const title = '按累计工作时长：0、少于15分钟、15–59分钟、1–4小时、4小时以上。并行会话分别累计。'
  return <div className="agent-heat-legend" aria-label="Agent 活跃度颜色图例" title={title}><span>工作时长</span><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-heat={level}/>)}<span>多</span></div>
}
