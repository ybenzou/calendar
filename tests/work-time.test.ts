import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentActivityService } from '../src/main/activity'
import { activityLevel } from '../src/shared/activity'

let directory: string, source: string, service: AgentActivityService, now: number
const minute = 60_000
function hook(seq: number, event: string, time: string, patch: Record<string, unknown> = {}) {
  return { schema_version: 3, seq, event, ts: `2026-10-13T${time}:00Z`, source: 'codex', session_id: 's1', turn_id: 't1', origin: 'desktop', workspace_name: 'Project', ...patch }
}
function write(rows: unknown[]) { fs.writeFileSync(path.join(source, 'events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n') }
function days() { return service.range({ from: '2026-10-13', to: '2026-10-15' }, 'Asia/Hong_Kong').days }
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-work-')); source = path.join(directory, 'source'); fs.mkdirSync(source)
  now = Date.parse('2026-10-13T12:00:00Z')
  service = new AgentActivityService(directory, source, () => now)
})
afterEach(() => { service.close(); if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-work-'))) throw new Error('Unsafe cleanup'); fs.rmSync(directory, { recursive: true, force: true }) })

it('uses work duration by default: one long call is stronger than fifty short calls', () => {
  const rows = [hook(1, 'turn_start', '09:00'), hook(2, 'tool_start', '09:01', { tool_call_id: 'long' }), hook(3, 'turn_done', '09:30')]
  write(rows); const long = days()['2026-10-13']
  write([...rows, hook(4, 'turn_start', '10:00', { turn_id: 't2' }), ...Array.from({ length: 50 }, (_, index) => hook(5 + index, 'tool_start', '10:00', { turn_id: 't2', tool_call_id: `short-${index}` })), hook(55, 'turn_done', '10:01', { turn_id: 't2' })])
  const combined = days()['2026-10-13']
  expect(long.workMs).toBe(30 * minute); expect(combined.workMs - long.workMs).toBe(minute)
  expect(activityLevel(long)).toBeGreaterThan(activityLevel({ ...long, workMs: minute, toolCalls: 50 }))
})
it('subtracts explicit human waiting and resumes only after pending questions are answered', () => {
  write([hook(1, 'turn_start', '09:00'), hook(2, 'input_wait', '09:10', { tool_call_id: 'question' }), hook(3, 'heartbeat', '09:20'), hook(4, 'tool_end', '09:40', { tool_call_id: 'question' }), hook(5, 'turn_done', '09:50')])
  expect(days()['2026-10-13'].workMs).toBe(20 * minute)
})
it('counts parallel agents separately rather than summing overlapping tools within one agent', () => {
  write([hook(1, 'turn_start', '09:00'), hook(2, 'turn_start', '09:00', { session_id: 's2' }), hook(3, 'tool_start', '09:01', { tool_call_id: 'a' }), hook(4, 'tool_start', '09:02', { tool_call_id: 'b' }), hook(5, 'turn_done', '09:10'), hook(6, 'turn_done', '09:10', { session_id: 's2' })])
  expect(days()['2026-10-13'].workMs).toBe(20 * minute)
})
it('splits work across local midnight', () => {
  now = Date.parse('2026-10-14T02:00:00Z')
  write([hook(1, 'turn_start', '15:55'), hook(2, 'turn_done', '16:05')])
  const result = days()
  expect(result['2026-10-13'].workMs).toBe(5 * minute); expect(result['2026-10-14'].workMs).toBe(5 * minute)
})
it('caps a stale session and a later window close; late callbacks never reopen it', () => {
  write([hook(1, 'turn_start', '09:00')])
  expect(days()['2026-10-13'].workMs).toBe(3 * minute)
  write([hook(1, 'turn_start', '09:00'), hook(2, 'session_end', '12:00'), hook(3, 'heartbeat', '12:01')])
  expect(days()['2026-10-13'].workMs).toBe(3 * minute)
})
it('persists an open interval on restart and confirms a long thinking interval at completion', () => {
  now = Date.parse('2026-10-13T09:02:00Z')
  write([hook(1, 'turn_start', '09:00')]); expect(days()['2026-10-13'].workMs).toBe(2 * minute)
  service.close(); service = new AgentActivityService(directory, source, () => now)
  now = Date.parse('2026-10-13T09:30:00Z')
  write([hook(1, 'turn_start', '09:00'), hook(2, 'turn_done', '09:30')])
  expect(days()['2026-10-13'].workMs).toBe(30 * minute)
})
it('rejects an old completion after a new turn has begun', () => {
  write([hook(1, 'turn_start', '09:00'), hook(2, 'turn_start', '09:01', { turn_id: 't2' }), hook(3, 'turn_done', '09:02'), hook(4, 'turn_done', '09:11', { turn_id: 't2' })])
  expect(days()['2026-10-13'].workMs).toBe(11 * minute)
})
it('does not bridge a missing journal interval as continuous work', () => {
  write([hook(1, 'turn_start', '09:00')]); service.sync()
  write([hook(20, 'heartbeat', '09:30'), hook(21, 'turn_done', '09:40')])
  expect(days()['2026-10-13']).toMatchObject({ workMs: 13 * minute, partial: true })
})
it('handles Cursor thought generation aliases without resetting the task clock', () => {
  write([hook(1, 'turn_start', '09:00', { source: 'cursor' }), hook(2, 'heartbeat', '09:15', { source: 'cursor', turn_id: 'thought-generation' }), hook(3, 'turn_done', '09:30', { source: 'cursor' })])
  expect(days()['2026-10-13'].workMs).toBe(30 * minute)
})
