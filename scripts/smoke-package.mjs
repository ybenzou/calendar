import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const root = path.resolve('.runtime/packaged-tests'), directory = path.join(root, randomUUID())
const binary = path.resolve('release/win-unpacked/calendar.exe'), env = { ...process.env, CALENDAR_DATA_DIR: directory }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function command(args, input, expectedStatus = 0) {
  const result = spawnSync(binary, [...args, '--json'], { input: input ? JSON.stringify(input) : undefined, encoding: 'utf8', env, windowsHide: true, timeout: 45000 })
  assert.equal(result.status, expectedStatus, result.stderr || result.error?.message)
  return JSON.parse(expectedStatus === 0 ? result.stdout : result.stderr)
}
try {
  assert.equal(command(['status']).data.running, false)
  const input = { title: '打包验收 · 中文与空格', start: '2026-10-14T15:00:00+08:00', end: '2026-10-14T16:00:00+08:00' }
  const added = command(['add', '--input', '-', '--request-id', 'package-smoke'], input)
  assert.equal(added.ok, true); assert.equal(added.data.event.timezone, 'Asia/Hong_Kong')
  assert.deepEqual(command(['add', '--input', '-', '--request-id', 'package-smoke'], input), added)
  assert.equal(command(['list', '--date', '2026-10-14']).data.events.length, 1)
  command(['add', '--input', '-', '--dry-run'], { ...input, title: 'Should not persist' })
  assert.equal(command(['list']).data.events.length, 1)
  assert.equal(command(['update', '--id', added.data.eventId, '--title', 'Wrong', '--expected-version', '9'], undefined, 1).error.code, 'VERSION_CONFLICT')
  const backup = command(['backup', 'create']).data
  command(['delete', '--id', added.data.eventId])
  command(['backup', 'restore', '--id', backup.id, '--confirm'])
  assert.equal(command(['get', '--id', added.data.eventId]).data.event.title, input.title)
  command(['run']); await pause(2000)
  const runtime = command(['status']).data
  assert.equal(runtime.ui, true); assert.equal(runtime.desktop.attached, true, JSON.stringify(runtime.desktop))
  assert.equal(runtime.desktop.boundsPixels.width, runtime.desktop.targetPixels?.width || runtime.displays[1]?.workArea.width || runtime.displays[0].workArea.width)
  command(['quit']); await pause(400)
  assert.equal(command(['status']).data.running, false)
  assert.equal(command(['get', '--id', added.data.eventId]).data.event.title, input.title)
  console.log('Packaged CLI passed: stdin/Unicode, headless startup, idempotency, dry-run, versions, backup, desktop, quit, restart.')
} finally {
  try { command(['quit']); await pause(500) } catch { /* already stopped */ }
  if (path.resolve(directory).startsWith(root + path.sep)) fs.rmSync(directory, { recursive: true, force: true })
}
