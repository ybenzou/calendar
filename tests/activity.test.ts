import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { AgentActivityService } from '../src/main/activity'
import { activityLevel } from '../src/shared/activity'

let directory: string, source: string, service: AgentActivityService
const clock = () => Date.parse('2026-10-14T10:00:00Z')
function event(seq: number, patch: Record<string, unknown> = {}) {
  return { schema_version: 3, seq, source: 'codex', session_id: 'session', turn_id: 'turn', tool_call_id: `tool-${seq}`, event: 'tool_start', ts: '2026-10-13T10:00:00Z', origin: 'desktop', workspace_name: 'Project', workspace_id: 'project-id', ...patch }
}
function journal(rows: unknown[], name = 'events.jsonl') { fs.writeFileSync(path.join(source, name), rows.map(row => JSON.stringify(row)).join('\n') + '\n') }
function range() { return service.range({ from: '2026-10-12', to: '2026-10-16' }, 'Asia/Hong_Kong') }
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-activity-'))
  source = path.join(directory, 'source'); fs.mkdirSync(source)
  service = new AgentActivityService(directory, source, clock)
})
afterEach(() => {
  service.close()
  if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-activity-'))) throw new Error('Unsafe cleanup')
  fs.rmSync(directory, { recursive: true, force: true })
})
describe('Agent activity metadata', () => {
  it('groups events by local date, client and project, including midnight boundaries', () => {
    journal([event(1, { ts: '2026-10-13T15:59:00Z' }), event(2, { ts: '2026-10-13T16:01:00Z' }), event(3, { source: 'cursor', ts: '2026-10-13T16:02:00Z' }), event(4, { event: 'turn_done', ts: '2026-10-13T16:03:00Z' })])
    const result = range()
    expect(result.days['2026-10-13'].toolCalls).toBe(1)
    expect(result.days['2026-10-14']).toMatchObject({ toolCalls: 2, completedTasks: 1, partial: true, known: true })
    expect(result.days['2026-10-14'].projects.map(project => project.client)).toEqual(['Codex App', 'Cursor'])
  })
  it('deduplicates repeated hooks while keeping distinct clients and tool calls', () => {
    journal([event(1), event(2, { tool_call_id: 'tool-1' }), event(3, { event: 'turn_done' }), event(4, { event: 'turn_done' }), event(5, { origin: 'vscode', tool_call_id: 'tool-1' }), event(6, { tool_call_id: '' }), event(7, { tool_call_id: '' })])
    expect(range().days['2026-10-13']).toMatchObject({ toolCalls: 4, completedTasks: 1 })
    expect(range().days['2026-10-13'].toolCalls).toBe(4)
  })
  it('preserves records through journal rotation and service restart', () => {
    journal([event(1), event(2)]); service.sync()
    fs.renameSync(path.join(source, 'events.jsonl'), path.join(source, 'events.prev.jsonl'))
    journal([event(3)]); service.sync()
    journal([event(3)], 'events.prev.jsonl'); journal([event(4)])
    service.close(); service = new AgentActivityService(directory, source, clock)
    expect(range().days['2026-10-13'].toolCalls).toBe(4)
  })
  it('marks missing history and journal gaps instead of fabricating zero activity', () => {
    expect(range()).toMatchObject({ available: false, capturedSince: null })
    journal([event(1, { ts: '2026-10-14T01:00:00Z' })]); service.sync()
    journal([event(20, { ts: '2026-10-14T08:00:00Z' })])
    const result = range()
    expect(result.days['2026-10-12'].known).toBe(false)
    expect(result.days['2026-10-15'].known).toBe(false)
    expect(result.days['2026-10-14']).toMatchObject({ toolCalls: 2, partial: true })
  })
  it('ignores previews, ambiguous sessions, malformed input and content fields', () => {
    journal([event(1, { source: 'demo' }), event(2, { session_id: 'pending-cursor' }), event(3, { schema_version: 99 }), event(4, { prompt: 'PRIVATE PROMPT', tool_input: { command: 'PRIVATE COMMAND' } })])
    expect(range().days['2026-10-13'].toolCalls).toBe(1)
    const db = new Database(path.join(directory, 'agent-activity.sqlite'), { readonly: true })
    try { expect(JSON.stringify(db.prepare('SELECT * FROM records').all())).not.toContain('PRIVATE') } finally { db.close() }
  })
  it('does not consume a partial line and retries when the newline arrives', () => {
    const target = path.join(source, 'events.jsonl')
    fs.writeFileSync(target, JSON.stringify(event(1)))
    expect(range().days['2026-10-13'].known).toBe(false)
    fs.appendFileSync(target, '\n')
    expect(range().days['2026-10-13'].toolCalls).toBe(1)
  })
  it('keeps fixed heat thresholds and rejects oversized or invalid date ranges', () => {
    const base = { workMs: 0, startedTasks: 0, completedTasks: 0, failedTools: 0 }
    expect([0, 1, 9, 10, 49, 50, 199, 200].map(toolCalls => activityLevel({ ...base, toolCalls }, 'tools'))).toEqual([0, 1, 1, 2, 2, 3, 3, 4])
    expect(() => service.range({ from: '2026-02-30', to: '2026-03-02' }, 'Asia/Hong_Kong')).toThrow()
    expect(() => service.range({ from: '2026-01-01', to: '2028-01-01' }, 'Asia/Hong_Kong')).toThrow()
  })
})
