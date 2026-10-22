import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { CalendarCore } from '../src/core/calendar'
import { migrateCalendarData } from '../src/main/data-migration'

let directory: string
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-migration-')) })
afterEach(() => { if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-migration-'))) throw new Error('Unsafe cleanup'); fs.rmSync(directory, { recursive: true, force: true }) })
function fixture(name: string, populated: boolean) {
  const root = path.join(directory, name), core = new CalendarCore(root)
  if (populated) core.execute({ command: 'add', args: { title: 'Preserved event', start: '2026-10-14T09:00:00+08:00', end: '2026-10-14T10:00:00+08:00' } })
  return { root, core }
}
it('migrates a populated virtualized database including its live WAL; ignores an empty AppData DB', async () => {
  const empty = fixture('roaming', false), original = fixture('package-cache', true), target = path.join(directory, 'stable')
  try {
    expect(await migrateCalendarData(target, [empty.root, original.root])).toMatchObject({ migrated: true, events: 1 })
    const migrated = new CalendarCore(target)
    try { expect(migrated.list({})[0].title).toBe('Preserved event') } finally { migrated.close() }
    expect(original.core.list({})).toHaveLength(1)
  } finally { empty.core.close(); original.core.close() }
})
it('keeps the original intact and never replaces existing user events on another startup', async () => {
  const original = fixture('original', true), current = fixture('current', true)
  try {
    expect(await migrateCalendarData(current.root, [original.root])).toEqual({ migrated: false })
    expect(current.core.list({})).toHaveLength(1); expect(original.core.list({})).toHaveLength(1)
  } finally { original.core.close(); current.core.close() }
})
it('preserves subscription credentials, backup files and newly collected activity history', async () => {
  const original = fixture('original', true), empty = fixture('empty', false), target = path.join(directory, 'stable')
  original.core.saveSubscription({ id: 'school', encryptedUrl: 'opaque-encrypted-value' })
  original.core.backupCreate()
  const activity = new Database(path.join(empty.root, 'agent-activity.sqlite'))
  activity.exec('CREATE TABLE records (calls INTEGER); INSERT INTO records VALUES (12)'); activity.close()
  try {
    await migrateCalendarData(target, [empty.root, original.root])
    const recovered = new CalendarCore(target)
    try { expect(recovered.subscriptions()[0].encryptedUrl).toBe('opaque-encrypted-value'); expect(recovered.backupList().backups).toHaveLength(1) } finally { recovered.close() }
    const stats = new Database(path.join(target, 'agent-activity.sqlite'), { readonly: true })
    try { expect(stats.prepare('SELECT calls FROM records').get()).toEqual({ calls: 12 }) } finally { stats.close() }
  } finally { original.core.close(); empty.core.close() }
})
