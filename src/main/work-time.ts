import type Database from 'better-sqlite3'

export const STALE_WORK_MS = 180_000
export interface WorkEvent {
  seq: number; event: string; source: string; session: string; turn: string; call: string
  ts: number; client: string; project: string; projectId: string
}
interface State {
  turn: string; aliases: string[]; retired: string[]; waiting: string[]
  phase: 'working' | 'waiting' | 'closed' | 'disconnected'
  span: string | null; last: number; client: string; project: string; projectId: string
}
const evidence = new Set(['heartbeat', 'tool_start', 'tool_end', 'tool_fail', 'input_resume', 'compact_start', 'compact_end', 'subagent_start', 'subagent_stop'])
const ends = new Set(['turn_done', 'turn_interrupt', 'turn_error', 'turn_unconfirmed', 'session_end'])

export function createWorkTables(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS work_sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_spans (key TEXT PRIMARY KEY, start INTEGER NOT NULL, end INTEGER, last INTEGER NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL, project_id TEXT NOT NULL, partial INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS work_span_start ON work_spans(start);`)
}
function closeSpan(db: Database.Database, state: State, ts: number, conservative = false) {
  if (!state.span) return
  const until = conservative ? Math.min(ts, state.last + STALE_WORK_MS) : ts
  db.prepare('UPDATE work_spans SET end = max(start, ?), partial = max(partial, ?) WHERE key = ? AND end IS NULL').run(until, conservative && until < ts ? 1 : 0, state.span)
  state.span = null
}
function openSpan(db: Database.Database, state: State, event: WorkEvent, partial: boolean) {
  state.span = `${event.session}:${event.seq}`
  state.phase = 'working'
  db.prepare('INSERT OR IGNORE INTO work_spans VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(state.span, event.ts, event.ts, state.client, state.project, state.projectId, partial ? 1 : 0)
}
function save(db: Database.Database, key: string, state: State) {
  db.prepare('INSERT OR REPLACE INTO work_sessions VALUES (?, ?)').run(key, JSON.stringify(state))
}

/** Explicit completion confirms an interval; abandoned/stale sessions are capped. */
export function applyWorkEvent(db: Database.Database, event: WorkEvent) {
  const raw = db.prepare('SELECT value FROM work_sessions WHERE key = ?').get(event.session) as { value: string } | undefined
  let state: State | undefined = raw && JSON.parse(raw.value)
  if (state && event.ts < state.last) return
  if (state && event.turn && state.retired.includes(event.turn)) return
  if (event.event === 'turn_start') {
    if (state && state.turn === event.turn) return
    const retired = state ? [...state.retired, state.turn, ...state.aliases].filter(Boolean).slice(-32) : []
    if (state) closeSpan(db, state, event.ts, true)
    state = { turn: event.turn, aliases: [], retired, waiting: [], phase: 'working', span: null, last: event.ts, client: event.client, project: event.project, projectId: event.projectId }
    openSpan(db, state, event, false)
  } else {
    if (!state) {
      if (!evidence.has(event.event) && !['approval_wait', 'input_wait'].includes(event.event)) return
      state = { turn: event.turn, aliases: [], retired: [], waiting: [], phase: 'working', span: null, last: event.ts, client: event.client, project: event.project, projectId: event.projectId }
      openSpan(db, state, event, true)
    } else if (event.turn && state.turn && event.turn !== state.turn && !state.aliases.includes(event.turn)) {
      if (event.source === 'cursor' && event.event === 'heartbeat') {
        // Thought-generation ids are aliases, not a new user task.
        state.aliases = [...state.aliases, event.turn].slice(-16)
      } else if (evidence.has(event.event) && (event.source === 'cursor' || state.phase === 'closed')) {
        closeSpan(db, state, event.ts, true)
        state = { ...state, turn: event.turn, aliases: [], retired: [...state.retired, state.turn, ...state.aliases].filter(Boolean).slice(-32), waiting: [], span: null, last: event.ts, phase: 'working' }
        openSpan(db, state, event, true)
      } else return
    }
    if (state.phase === 'closed') return
    if (event.project !== '未标记项目' && state.project === '未标记项目') {
      state.project = event.project; state.projectId = event.projectId
      if (state.span) db.prepare('UPDATE work_spans SET project = ?, project_id = ? WHERE key = ?').run(state.project, state.projectId, state.span)
    }
    if (ends.has(event.event)) {
      // Window close/unconfirmed completion cannot turn a stuck session into hours.
      closeSpan(db, state, event.ts, ['session_end', 'turn_unconfirmed'].includes(event.event))
      state.phase = 'closed'; state.waiting = []
    } else if (event.event === 'connection_lost') {
      closeSpan(db, state, event.ts, true); state.phase = 'disconnected'
    } else if (event.event === 'input_wait' || event.event === 'approval_wait') {
      closeSpan(db, state, event.ts)
      state.waiting = [...new Set([...state.waiting, event.call || 'anonymous'])]
      state.phase = 'waiting'
    } else {
      if (event.event === 'input_resume' && !event.call) state.waiting = []
      else if (['input_resume', 'tool_start', 'tool_end', 'tool_fail'].includes(event.event)) state.waiting = state.waiting.filter(call => call !== (event.call || 'anonymous'))
      if (!state.waiting.length && !state.span && (evidence.has(event.event) || event.event === 'connection_restored')) openSpan(db, state, event, state.phase === 'disconnected')
      if (state.span && evidence.has(event.event)) db.prepare('UPDATE work_spans SET last = ? WHERE key = ?').run(event.ts, state.span)
    }
  }
  state.last = event.ts
  save(db, event.session, state)
}

export function interruptWorkForGap(db: Database.Database, ts: number) {
  const rows = db.prepare('SELECT key, value FROM work_sessions').all() as { key: string; value: string }[]
  for (const row of rows) {
    const state: State = JSON.parse(row.value)
    if (state.phase === 'closed') continue
    closeSpan(db, state, ts, true)
    state.phase = 'disconnected'
    save(db, row.key, state)
  }
}
