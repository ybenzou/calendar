import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { CalendarError, dateSchema } from '../shared/protocol'
import { activityLevel, type AgentActivityCounts, type AgentActivityDay, type AgentActivityRange } from '../shared/activity'
import { createWorkTables, applyWorkEvent, interruptWorkForGap, STALE_WORK_MS } from './work-time'

const eventSchema = z.object({
  schema_version: z.number().int().min(1).max(3).default(1),
  seq: z.number().int().positive(), source: z.enum(['cursor', 'codex', 'demo']),
  session_id: z.string().min(1).max(160), turn_id: z.string().max(160).default(''),
  tool_call_id: z.string().max(160).default(''), event: z.string().max(80),
  ts: z.string().max(48), origin: z.string().max(80).default(''),
  workspace_name: z.string().max(100).default(''), workspace_id: z.string().max(160).default('')
})
const tracked = new Set(['turn_start', 'turn_done', 'tool_start', 'tool_fail'])
const counts = (): AgentActivityCounts => ({ workMs: 0, toolCalls: 0, startedTasks: 0, completedTasks: 0, failedTools: 0 })
const fields: Record<string, keyof AgentActivityCounts> = { turn_start: 'startedTasks', turn_done: 'completedTasks', tool_start: 'toolCalls', tool_fail: 'failedTools' }
type Row = { ts: number; event: string; client: string; project: string; project_id: string }

/** Read Naiwa's metadata journals only. Persist counts across journal rotation. */
export class AgentActivityService {
  private db: Database.Database
  private signature = ''
  private sourceAvailable = false
  constructor(directory: string, private source = process.env.CALENDAR_AGENT_DATA_DIR || process.env.NAIWA_HOME || path.join(os.homedir(), '.agent-pet'), private clock = () => Date.now()) {
    fs.mkdirSync(directory, { recursive: true })
    this.db = new Database(path.join(directory, 'agent-activity.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, event TEXT NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL, project_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_time ON records(ts);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gaps (start INTEGER NOT NULL, end INTEGER NOT NULL);`)
    createWorkTables(this.db)
  }
  private meta(key: string): string | undefined { return (this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined)?.value }
  private setMeta(key: string, value: string) { this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run(key, value) }
  sync(): boolean {
    const files = ['events.prev.jsonl', 'events.jsonl'].map(name => path.join(this.source, name))
    let signature: string
    try {
      signature = files.map(file => { try { const stat = fs.statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}` } catch (error: any) { if (error.code === 'ENOENT') return 'missing'; throw error } }).join('|')
      this.sourceAvailable = signature !== 'missing|missing'
      if (!this.sourceAvailable || signature === this.signature) return false
      const events = files.flatMap(file => {
        if (!fs.existsSync(file)) return []
        // Both journals are bounded to 256 KiB by Naiwa; tolerate one large batch.
        if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Oversized agent journal')
        const body = fs.readFileSync(file, 'utf8')
        return body.slice(0, body.lastIndexOf('\n') + 1).split('\n').flatMap(line => {
          try { const parsed = eventSchema.safeParse(JSON.parse(line)); return parsed.success ? [parsed.data] : [] } catch { return [] }
        })
      }).sort((a, b) => a.seq - b.seq)
      const now = this.clock(), watermark = Number(this.meta('last_seq') || 0), workWatermark = Number(this.meta('work_last_seq') || 0)
      const fresh = events.filter(event => event.seq > Math.min(watermark, workWatermark))
      if (!fresh.length) { this.signature = signature; return false }
      const insert = this.db.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?, ?, ?, ?)')
      this.db.transaction(() => {
        if (!this.meta('captured_since')) this.setMeta('captured_since', String(now))
        if (!this.meta('work_captured_since')) this.setMeta('work_captured_since', String(now))
        // A missing interval is marked incomplete instead of inventing zeroes.
        let previous = watermark, previousWork = workWatermark
        for (const event of fresh) {
          let stamp = DateTime.fromISO(event.ts, { setZone: true }).toMillis()
          if (!Number.isFinite(stamp)) stamp = now
          // Old SSH receivers can carry a remote clock. Count live arrivals locally.
          if (stamp > now + 2000) stamp = now
          if (event.seq > watermark && previous && event.seq > previous + 1) {
            const last = Number(this.meta('last_ts') || stamp)
            this.db.prepare('INSERT INTO gaps VALUES (?, ?)').run(Math.min(last, stamp), Math.max(last, stamp))
          }
          if (event.seq > watermark) { previous = event.seq; this.setMeta('last_ts', String(stamp)) }
          if (event.seq > workWatermark && previousWork && event.seq > previousWork + 1) interruptWorkForGap(this.db, stamp)
          if (event.seq > workWatermark) previousWork = event.seq
          if (event.source === 'demo' || event.session_id === 'pending-cursor') continue
          const remote = event.session_id.startsWith('ssh-')
          const client = event.source === 'cursor' ? remote ? 'Cursor · SSH' : 'Cursor' : event.origin === 'desktop' || event.session_id.startsWith('desktop:') ? 'Codex App' : remote ? 'Codex · SSH' : 'Codex · VS Code'
          const project = [...event.workspace_name].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').trim() || '未标记项目'
          if (event.seq > workWatermark) applyWorkEvent(this.db, { seq: event.seq, event: event.event, source: event.source, session: createHash('sha256').update(`${event.source}:${client}:${event.session_id}`).digest('hex'), turn: event.turn_id, call: event.tool_call_id, ts: Math.round(stamp), client, project, projectId: event.workspace_id || project })
          if (event.seq <= watermark || !tracked.has(event.event)) continue
          const identity = [event.source, client, event.session_id, event.turn_id, event.event, event.event.startsWith('tool_') ? event.tool_call_id : '']
          // Anonymous tools cannot be deduplicated by an absent call id.
          if (!event.turn_id || (event.event.startsWith('tool_') && !event.tool_call_id)) identity.push(String(event.seq))
          const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
          insert.run(key, Math.round(stamp), event.event, client, project, event.workspace_id || project)
        }
        this.setMeta('last_seq', String(Math.max(watermark, fresh[fresh.length - 1].seq)))
        this.setMeta('work_last_seq', String(Math.max(workWatermark, fresh[fresh.length - 1].seq)))
      })()
      this.signature = signature
      return true
    } catch {
      // A transient rotation race is retried next poll; calendar events stay usable.
      this.sourceAvailable = false
      return false
    }
  }
  range(raw: unknown, timezone: string): AgentActivityRange {
    const input = z.object({ from: dateSchema, to: dateSchema }).strict().parse(raw)
    const from = DateTime.fromISO(input.from, { zone: timezone }).startOf('day'), to = DateTime.fromISO(input.to, { zone: timezone }).startOf('day')
    if (!from.isValid || !to.isValid || to <= from || to.diff(from, 'days').days > 370) throw new CalendarError('INVALID_RANGE', 'Invalid activity date range')
    this.sync()
    const captured = Number(this.meta('captured_since') || 0), since = captured ? DateTime.fromMillis(captured, { zone: timezone }).toISODate()! : null
    const today = DateTime.fromMillis(this.clock(), { zone: timezone }).toISODate()!
    const workCaptured = Number(this.meta('work_captured_since') || 0), workSince = workCaptured ? DateTime.fromMillis(workCaptured, { zone: timezone }).toISODate()! : null
    const days: Record<string, AgentActivityDay> = {}
    for (let day = from; day < to; day = day.plus({ days: 1 })) {
      const date = day.toISODate()!
      days[date] = { ...counts(), date, known: !!since && date >= since && date <= today, workKnown: !!workSince && date >= workSince && date <= today, partial: date === since || date === workSince, level: 0, projects: [] }
    }
    const projects = new Map<string, Map<string, AgentActivityDay['projects'][number]>>()
    const rows = this.db.prepare('SELECT ts, event, client, project, project_id FROM records WHERE ts >= ? AND ts < ? ORDER BY ts').all(from.toMillis(), to.toMillis()) as Row[]
    for (const row of rows) {
      const date = DateTime.fromMillis(row.ts, { zone: timezone }).toISODate()!, day = days[date], field = fields[row.event]
      if (!day || !field) continue
      day[field]++; day.known = true
      if (!since || date <= since) day.partial = true
      const items = projects.get(date) || new Map(), key = `${row.client}:${row.project_id}`
      const project = items.get(key) || { ...counts(), id: createHash('sha256').update(key).digest('hex').slice(0, 16), workKnown: false, client: row.client, project: row.project }
      project[field]++; items.set(key, project); projects.set(date, items)
    }
    const spans = this.db.prepare('SELECT start, end, last, client, project, project_id, partial FROM work_spans WHERE start < ? AND (end IS NULL OR end >= ?)').all(to.toMillis(), from.toMillis()) as { start: number; end: number | null; last: number; client: string; project: string; project_id: string; partial: number }[]
    for (const span of spans) {
      const until = span.end ?? Math.min(this.clock(), span.last + STALE_WORK_MS)
      let cursor = Math.max(span.start, from.toMillis())
      while (cursor < Math.min(until, to.toMillis())) {
        const dayStart = DateTime.fromMillis(cursor, { zone: timezone }).startOf('day'), date = dayStart.toISODate()!, day = days[date]
        const end = Math.min(until, dayStart.plus({ days: 1 }).toMillis(), to.toMillis()), ms = end - cursor
        day.workMs += ms; day.known = true; day.workKnown = true
        if (span.partial || span.end === null && this.clock() > span.last + STALE_WORK_MS || workSince && date <= workSince) day.partial = true
        const items = projects.get(date) || new Map(), key = `${span.client}:${span.project_id}`
        const project = items.get(key) || { ...counts(), id: createHash('sha256').update(key).digest('hex').slice(0, 16), workKnown: true, client: span.client, project: span.project }
        project.workMs += ms; project.workKnown = true; items.set(key, project); projects.set(date, items)
        cursor = end
      }
    }
    const gaps = this.db.prepare('SELECT start, end FROM gaps WHERE start < ? AND end >= ?').all(to.toMillis(), from.toMillis()) as { start: number; end: number }[]
    for (const day of Object.values(days)) {
      const start = DateTime.fromISO(day.date, { zone: timezone }).toMillis(), end = DateTime.fromMillis(start, { zone: timezone }).plus({ days: 1 }).toMillis()
      if (gaps.some(gap => gap.start < end && gap.end >= start)) { day.partial = true; day.known = !!projects.get(day.date)?.size; day.workKnown = day.workMs > 0 }
      if (!this.sourceAvailable && day.date === today) { day.partial = true; day.known = !!projects.get(day.date)?.size; day.workKnown = day.workMs > 0 }
      day.level = activityLevel(day)
      day.projects = [...(projects.get(day.date)?.values() || [])].sort((a, b) => b.workMs - a.workMs || b.toolCalls - a.toolCalls)
    }
    return { available: this.sourceAvailable, capturedSince: captured ? new Date(captured).toISOString() : null, days }
  }
  hasLiveWork() { return !!this.db.prepare('SELECT 1 FROM work_spans WHERE end IS NULL AND last >= ? LIMIT 1').get(this.clock() - STALE_WORK_MS - 5000) }
  close() { this.db.close() }
}
