import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function legacyDataDirectories(packaged: boolean): string[] {
  const names = packaged ? ['DesktopCalendar', 'YuanbenCalendar'] : ['DesktopCalendar-dev', 'YuanbenCalendar-dev']
  const roots = [process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')]
  const packages = path.join(os.homedir(), 'AppData', 'Local', 'Packages')
  if (fs.existsSync(packages)) {
    for (const item of fs.readdirSync(packages, { withFileTypes: true })) {
      if (item.isDirectory() && item.name.startsWith('OpenAI.')) roots.push(path.join(packages, item.name, 'LocalCache', 'Roaming'))
    }
  }
  // Prefer the current product's data over an older renamed application's copy.
  return names.flatMap(name => roots.map(root => path.join(root, name)))
}

function summary(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('user_version', { simple: true }) !== 1) return null
    const events = (db.prepare('SELECT count(*) AS count FROM events').get() as { count: number }).count
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name))
    const subscriptions = tables.has('subscriptions') ? (db.prepare('SELECT count(*) AS count FROM subscriptions').get() as { count: number }).count : 0
    db.prepare('SELECT * FROM calendars LIMIT 1').get(); db.prepare('SELECT * FROM settings LIMIT 1').get()
    return { events, subscriptions }
  } finally { db.close() }
}

async function snapshot(source: string, target: string) {
  const staged = `${target}.migration-${randomUUID()}`
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try { await db.backup(staged) } finally { db.close() }
  // Preserve a placeholder database as well; no source or old file is deleted.
  if (fs.existsSync(target)) {
    const preserved = `${target}.pre-migration-${randomUUID()}`
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, preserved + suffix)
  }
  fs.renameSync(staged, target)
}

export async function migrateCalendarData(directory: string, candidates: string[]) {
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, 'calendar.sqlite')
  if (fs.existsSync(target)) {
    const existing = summary(target)
    if (!existing || existing.events || existing.subscriptions) return { migrated: false }
  }
  const sources = candidates.filter(source => path.resolve(source) !== path.resolve(directory) && fs.existsSync(path.join(source, 'calendar.sqlite')))
  let source: string | undefined, data: ReturnType<typeof summary>
  for (const candidate of sources) {
    try {
      const found = summary(path.join(candidate, 'calendar.sqlite'))
      if (found && (found.events || found.subscriptions)) { source = candidate; data = found; break }
    } catch { /* An unreadable legacy location cannot replace a valid database. */ }
  }
  if (!source) return { migrated: false }
  await snapshot(path.join(source, 'calendar.sqlite'), target)
  for (const name of ['backups', 'maps']) {
    const original = path.join(source, name)
    if (fs.existsSync(original)) fs.cpSync(original, path.join(directory, name), { recursive: true, force: false, errorOnExist: false })
  }
  const key = path.join(source, 'ai-key.bin')
  if (fs.existsSync(key) && !fs.existsSync(path.join(directory, 'ai-key.bin'))) fs.copyFileSync(key, path.join(directory, 'ai-key.bin'))
  // Keep newly collected heatmap history even when it lived beside the empty DB.
  const activity = candidates.map(candidate => path.join(candidate, 'agent-activity.sqlite')).find(file => fs.existsSync(file))
  if (activity && !fs.existsSync(path.join(directory, 'agent-activity.sqlite'))) await snapshot(activity, path.join(directory, 'agent-activity.sqlite'))
  fs.writeFileSync(path.join(directory, 'data-migration.json'), JSON.stringify({ source, ...data!, migratedAt: new Date().toISOString() }, null, 2) + '\n')
  return { migrated: true, ...data! }
}
