export interface AgentActivityCounts {
  workMs: number
  toolCalls: number
  startedTasks: number
  completedTasks: number
  failedTools: number
}
export interface AgentActivityProject extends AgentActivityCounts {
  id: string
  workKnown: boolean
  client: string
  project: string
}
export interface AgentActivityDay extends AgentActivityCounts {
  workKnown: boolean
  date: string
  known: boolean
  partial: boolean
  level: number
  projects: AgentActivityProject[]
}
export interface AgentActivityRange {
  available: boolean
  capturedSince: string | null
  days: Record<string, AgentActivityDay>
}
export type ActivityMetric = 'work' | 'tasks' | 'tools'
export function activityLevel(counts: AgentActivityCounts, metric: ActivityMetric = 'work'): number {
  if (metric === 'work') return counts.workMs >= 4 * 3600_000 ? 4 : counts.workMs >= 3600_000 ? 3 : counts.workMs >= 15 * 60_000 ? 2 : counts.workMs > 0 ? 1 : 0
  if (metric === 'tasks') return counts.completedTasks >= 20 ? 4 : counts.completedTasks >= 10 ? 3 : counts.completedTasks >= 3 ? 2 : counts.completedTasks > 0 ? 1 : 0
  if (counts.toolCalls >= 200) return 4
  if (counts.toolCalls >= 50) return 3
  if (counts.toolCalls >= 10) return 2
  return counts.toolCalls || counts.startedTasks || counts.completedTasks ? 1 : 0
}
export function workTimeLabel(ms: number): string {
  if (ms > 0 && ms < 60_000) return '<1 分钟'
  const minutes = Math.floor(ms / 60_000), hours = Math.floor(minutes / 60)
  return hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`
}
