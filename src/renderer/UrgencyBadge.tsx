import type { deadlineUrgency } from './longEvents'

export function UrgencyBadge({ urgency }: { urgency?: ReturnType<typeof deadlineUrgency> }) {
  if (!urgency) return null
  return <span className="urgency-badge" data-urgency={urgency.level} aria-label={`距下一项日期：${urgency.label}`} title="相对今天的剩余天数">{urgency.label}</span>
}
