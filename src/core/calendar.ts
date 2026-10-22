import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { CalendarError, commandSchema, dateSchema, settingsSchema, stableJSON, placeSchema, routeSchema, type Command, type Event, type Settings } from '../shared/protocol'

const eventInput = z.object({
  calendarId: z.string().default('local'), title: z.string().trim().min(1).max(500), notes: z.string().max(20000).default(''),
  start: z.string(), end: z.string(), timezone: z.string().default('Asia/Hong_Kong'), allDay: z.boolean().default(false),
  location: placeSchema.nullable().optional(), route: routeSchema.nullable().optional()
}).strict()
const now = () => new Date().toISOString()
const batchInput = z.object({ title: z.string().trim().min(1).max(500), notes: z.string().max(20000).default(''), key: z.string().min(1).max(200).optional(), replaceId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), timezone: z.string().default('Asia/Hong_Kong'), calendarId: z.string().default('local'), events: z.array(eventInput.omit({ calendarId: true }).extend({ end: z.string().optional(), timezone: z.string().optional() })).min(1).max(100) }).strict()
type Entity = { table: 'events' | 'calendars' | 'settings'; id: string; value: any | null }
const tables = new Set(['events', 'calendars', 'settings'])

export class CalendarCore {
  private db!: Database.Database
  constructor(public directory: string) {
    fs.mkdirSync(directory, { recursive: true })
    // An interrupted restore rolls back to the old, complete database at startup.
    const target = path.join(directory, 'calendar.sqlite'), previous = `${target}.restore-old`
    if (fs.existsSync(previous)) {
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(target + suffix)) fs.unlinkSync(target + suffix)
      fs.renameSync(previous, target)
    }
    this.open()
  }
  private open() {
    this.db = new Database(path.join(this.directory, 'calendar.sqlite'))
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL'); this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 1) { this.db.close(); throw new CalendarError('NEWER_DATABASE', 'Database requires a newer Calendar version') }
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, before_json TEXT NOT NULL, after_json TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, signature TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_previews (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS external_mappings (provider TEXT, account_id TEXT, calendar_id TEXT, external_id TEXT, local_id TEXT, version TEXT, PRIMARY KEY(provider, account_id, calendar_id, external_id));
      CREATE INDEX IF NOT EXISTS events_range ON events(json_extract(value,'$.deleted'), json_extract(value,'$.allDay'), json_extract(value,'$.start'), json_extract(value,'$.end'));
      PRAGMA user_version = 1;`)
    if (!this.read('calendars', 'local')) this.write('calendars', 'local', { id: 'local', name: '我的日历', color: '#245b51', version: 1, deleted: false })
    if (!this.read('settings', 'app')) this.write('settings', 'app', settingsSchema.parse({}))
  }
  close() { this.db.close() }
  replayRequest(id: string, signature: string) {
    const existing = this.db.prepare('SELECT signature,result FROM requests WHERE id=?').get(id) as any
    if (!existing) return undefined
    if (stableJSON(JSON.parse(existing.signature)) !== signature) throw new CalendarError('REQUEST_CONFLICT', 'Request ID already used for different parameters')
    return JSON.parse(existing.result)
  }
  recordRequest(id: string, signature: string, result: unknown) {
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(id, signature, JSON.stringify(result))
  }
  private read(table: string, id: string): any | null {
    if (!tables.has(table)) throw new CalendarError('INVALID_TABLE', 'Unsupported entity')
    const row = this.db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get(id) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  private write(table: string, id: string, value: any | null) {
    if (!tables.has(table)) throw new CalendarError('INVALID_TABLE', 'Unsupported entity')
    if (value === null) this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    else this.db.prepare(`INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`).run(id, JSON.stringify(value))
  }
  private all(table: string): any[] {
    if (!tables.has(table)) throw new CalendarError('INVALID_TABLE', 'Unsupported entity')
    return (this.db.prepare(`SELECT value FROM ${table}`).all() as { value: string }[]).map(r => JSON.parse(r.value))
  }
  settings(): Settings { return settingsSchema.parse(this.read('settings', 'app')) }
  private getEvent(id: unknown): Event {
    const event = this.read('events', z.string().parse(id))
    if (!event || event.deleted) throw new CalendarError('NOT_FOUND', 'Event not found')
    return event
  }
  private validateEvent(value: unknown, allowReadOnly = false, pointInTime = false) {
    const event = eventInput.parse(value)
    if (!DateTime.now().setZone(event.timezone).isValid) throw new CalendarError('INVALID_TIMEZONE', 'Unknown IANA timezone')
    if (event.allDay) {
      dateSchema.parse(event.start); dateSchema.parse(event.end)
      if (!DateTime.fromISO(event.start).isValid || !DateTime.fromISO(event.end).isValid) throw new CalendarError('INVALID_DATE', 'Invalid date')
      if (event.end <= event.start) throw new CalendarError('INVALID_RANGE', 'All-day end date must follow start date (exclusive)')
    } else {
      if (![event.start, event.end].every(t => /T.*(?:Z|[+-]\d\d:\d\d)$/.test(t))) throw new CalendarError('INVALID_TIME', 'Times require an explicit UTC offset')
      const start = DateTime.fromISO(event.start), end = DateTime.fromISO(event.end)
      if (!start.isValid || !end.isValid || (pointInTime ? end.toMillis() !== start.toMillis() : end.toMillis() <= start.toMillis())) throw new CalendarError('INVALID_RANGE', pointInTime ? 'Time point must have identical start and end' : 'End must follow start')
      event.start = start.toUTC().toISO()!; event.end = end.toUTC().toISO()!
    }
    const calendar = this.read('calendars', event.calendarId)
    if (!calendar || calendar.deleted) throw new CalendarError('NOT_FOUND', 'Calendar not found')
    if (calendar.readOnly && !allowReadOnly) throw new CalendarError('READ_ONLY', 'Subscribed calendars are managed by their source')
    return event
  }
  private checkVersion(value: any, expected: unknown) {
    if (expected !== undefined && value.version !== z.number().int().positive().parse(expected)) throw new CalendarError('VERSION_CONFLICT', 'Event changed; reload before applying')
  }
  private groupSpan(items: Event[], zone: string) {
    const live = items.filter(e => !e.deleted)
    if (!live.length) return { deleted: true }
    const starts = live.map(e => e.allDay ? e.start : DateTime.fromISO(e.start).setZone(zone).toISODate()!)
    const ends = live.map(e => e.allDay ? e.end : (e.pointInTime ? DateTime.fromISO(e.start) : DateTime.fromISO(e.end).minus({ milliseconds: 1 })).setZone(zone).plus({ days: 1 }).toISODate()!)
    return { start: starts.sort()[0], end: ends.sort().at(-1)!, deleted: false }
  }
  private moveItem(event: Event, date: string): Event {
    const day = DateTime.fromISO(date, { zone: event.timezone })
    if (!day.isValid) throw new CalendarError('INVALID_DATE', 'Invalid destination date')
    if (event.allDay) return { ...event, start: date, end: day.plus({ days: DateTime.fromISO(event.end).diff(DateTime.fromISO(event.start), 'days').days }).toISODate()!, version: event.version + 1, updatedAt: now() }
    const start = DateTime.fromISO(event.start).setZone(event.timezone), moved = day.set({ hour: start.hour, minute: start.minute, second: start.second, millisecond: start.millisecond })
    if (moved.hour !== start.hour || moved.minute !== start.minute) throw new CalendarError('DST_GAP', 'Local time does not exist on that date')
    return { ...event, start: moved.toUTC().toISO()!, end: moved.plus({ milliseconds: DateTime.fromISO(event.end).toMillis() - start.toMillis() }).toUTC().toISO()!, version: event.version + 1, updatedAt: now() }
  }
  private mutation(changes: Entity[], dryRun: boolean, data: any) {
    if (dryRun) return { ...data, dryRun: true, changes }
    const before = changes.map(c => ({ ...c, value: this.read(c.table, c.id) }))
    const operationId = randomUUID()
    for (const c of changes) this.write(c.table, c.id, c.value)
    this.db.prepare('INSERT INTO operations(id,before_json,after_json,created_at) VALUES(?,?,?,?)').run(operationId, JSON.stringify(before), JSON.stringify(changes), now())
    return { ...data, operationId }
  }
  list(args: Record<string, any>): Event[] {
    const zone = args.timezone || this.settings().timezone
    if (!DateTime.now().setZone(zone).isValid) throw new CalendarError('INVALID_TIMEZONE', 'Unknown timezone')
    const from = args.date || args.from, to = args.date ? DateTime.fromISO(args.date).plus({ days: 1 }).toISODate() : args.to
    if (from) { dateSchema.parse(from); if (!DateTime.fromISO(from).isValid) throw new CalendarError('INVALID_DATE', 'Invalid date') }
    if (to) { dateSchema.parse(to); if (!DateTime.fromISO(to).isValid || (from && to <= from)) throw new CalendarError('INVALID_RANGE', 'Invalid date range') }
    const fromMillis = from ? DateTime.fromISO(from, { zone }).startOf('day').toMillis() : -Infinity
    const toMillis = to ? DateTime.fromISO(to, { zone }).startOf('day').toMillis() : Infinity
    const fromUTC = Number.isFinite(fromMillis) ? DateTime.fromMillis(fromMillis).toUTC().toISO()! : ''
    const toUTC = Number.isFinite(toMillis) ? DateTime.fromMillis(toMillis).toUTC().toISO()! : '9999-12-31T23:59:59.999Z'
    const rows = this.db.prepare(`SELECT value FROM events WHERE json_extract(value,'$.deleted')=0 AND
      ((json_extract(value,'$.allDay')=1 AND json_extract(value,'$.end')>? AND json_extract(value,'$.start')<?) OR
       (json_extract(value,'$.allDay')=0 AND json_extract(value,'$.end')>? AND json_extract(value,'$.start')<?))`).all(from || '', to || '9999-12-31', fromUTC, toUTC) as { value: string }[]
    return rows.map(row => JSON.parse(row.value) as Event).filter((e: Event) => {
      if (e.deleted || (args.calendarId && e.calendarId !== args.calendarId)) return false
      if (args.search && !`${e.title} ${e.notes} ${e.items?.map(item => `${item.title} ${item.notes}`).join(' ') || ''}`.toLowerCase().includes(String(args.search).toLowerCase())) return false
      if (e.items) return e.items.some(item => !item.deleted && (item.allDay ? (!from || item.end > from) && (!to || item.start < to) : item.pointInTime ? DateTime.fromISO(item.start).toMillis() >= fromMillis && DateTime.fromISO(item.start).toMillis() < toMillis : DateTime.fromISO(item.end).toMillis() > fromMillis && DateTime.fromISO(item.start).toMillis() < toMillis))
      return e.allDay ? (!from || e.end > from) && (!to || e.start < to) : DateTime.fromISO(e.end).toMillis() > fromMillis && DateTime.fromISO(e.start).toMillis() < toMillis
    }).sort((a, b) => a.start.localeCompare(b.start))
  }
  execute(raw: Command): any {
    const command = commandSchema.parse(raw), args = command.args as Record<string, any>
    const signature = stableJSON({ command: command.command, args, dryRun: command.dryRun })
    return this.db.transaction(() => {
      if (command.requestId && !command.dryRun) {
        const existing = this.replayRequest(command.requestId, signature)
        if (existing !== undefined) return existing
      }
      const result = this.dispatch(command.command, args, command.dryRun)
      if (command.requestId && !command.dryRun) this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(command.requestId, signature, JSON.stringify(result))
      return result
    })()
  }
  private dispatch(command: string, args: Record<string, any>, dryRun: boolean): any {
    switch (command) {
      case 'list': return { events: this.list(args) }
      case 'get': return { event: this.getEvent(args.id) }
      case 'batch.add': {
        const input = batchInput.parse(args), signature = stableJSON(input)
        if (input.key) {
          const existing = this.all('events').find(e => e.batchKey === input.key)
          if (existing) {
            if (existing.batchSignature !== signature) throw new CalendarError('BATCH_KEY_CONFLICT', '这个批次标识已用于不同内容，请更换 key')
            if (existing.deleted) throw new CalendarError('BATCH_DELETED', '活动组已删除，请撤销删除或更换 key')
            return { event: existing, eventId: existing.id, version: existing.version, itemCount: existing.items.filter((e: Event) => !e.deleted).length, duplicate: true, ...(dryRun ? { dryRun: true } : {}) }
          }
        }
        const previous = input.replaceId ? this.getEvent(input.replaceId) : undefined
        if (previous) {
          if (input.expectedVersion === undefined) throw new CalendarError('VERSION_REQUIRED', '升级已有日程必须指定 expectedVersion')
          this.checkVersion(previous, input.expectedVersion)
          if (previous.readOnly || previous.items) throw new CalendarError('INVALID_REPLACEMENT', '仅可将可编辑的单条日程升级为活动组')
          if (previous.calendarId !== input.calendarId) throw new CalendarError('GROUP_CALENDAR', '升级时须保留原日历')
        } else if (input.expectedVersion !== undefined) throw new CalendarError('INVALID_INPUT', 'expectedVersion requires replaceId')
        const items: Event[] = input.events.map(item => {
          if (item.allDay && !item.end) throw new CalendarError('INVALID_RANGE', '全天子日程需要结束日期')
          const pointInTime = !item.end
          const end = item.end || item.start
          return { ...this.validateEvent({ ...item, end, timezone: item.timezone || input.timezone, calendarId: input.calendarId }, false, pointInTime), id: randomUUID(), createdAt: now(), updatedAt: now(), version: 1, deleted: false, ...(pointInTime ? { pointInTime: true } : {}) }
        })
        const span = this.groupSpan(items, input.timezone)
        const group: Event = { id: previous?.id || randomUUID(), title: input.title, notes: input.notes, calendarId: input.calendarId, timezone: input.timezone, allDay: true, createdAt: previous?.createdAt || now(), updatedAt: now(), version: previous ? previous.version + 1 : 1, start: '', end: '', ...span, items, ...(input.key ? { batchKey: input.key, batchSignature: signature } : {}) }
        this.validateEvent({ title: group.title, notes: group.notes, calendarId: group.calendarId, timezone: group.timezone, allDay: true, start: group.start, end: group.end })
        return this.mutation([{ table: 'events', id: group.id, value: group }], dryRun, { event: group, eventId: group.id, version: group.version, itemCount: items.length })
      }
      case 'add': {
        const event: Event = { ...this.validateEvent(args), id: randomUUID(), createdAt: now(), updatedAt: now(), version: 1, deleted: false }
        return this.mutation([{ table: 'events', id: event.id, value: event }], dryRun, { event, eventId: event.id, version: event.version })
      }
      case 'update': case 'move': case 'delete': {
        const previous = this.getEvent(args.id); this.checkVersion(previous, args.expectedVersion)
        if (previous.readOnly) throw new CalendarError('READ_ONLY', 'Subscribed events are managed by their source calendar')
        const { id: _id, expectedVersion: _version, itemId, date, ...patch } = args
        if (command === 'update' && patch.location !== undefined && patch.route === undefined) patch.route = null
        if (previous.items) {
          let items = previous.items.map(item => ({ ...item }))
          if (itemId) {
            const item = items.find(e => e.id === itemId && !e.deleted)
            if (!item) throw new CalendarError('NOT_FOUND', '子日程不存在')
            let nextItem = { ...item, ...patch, version: item.version + 1, updatedAt: now() }
            if (command === 'delete') nextItem.deleted = true
            else if (command === 'move') nextItem = this.moveItem(item, dateSchema.parse(date))
            else {
              if (patch.pointInTime !== undefined) z.boolean().parse(patch.pointInTime)
              if (patch.calendarId && patch.calendarId !== previous.calendarId) throw new CalendarError('GROUP_CALENDAR', '子日程必须属于活动组的日历')
              const { id: _i, createdAt: _c, updatedAt: _u, version: _v, deleted: _d, pointInTime: _point, ...value } = nextItem
              const pointInTime = patch.pointInTime ?? (patch.end ? false : item.pointInTime)
              if (pointInTime) value.end = value.start
              nextItem = { ...nextItem, ...this.validateEvent(value, false, !!pointInTime), pointInTime }
            }
            items = items.map(e => e.id === item.id ? nextItem : e)
          } else if (command === 'move') {
            dateSchema.parse(date)
            const days = DateTime.fromISO(date).diff(DateTime.fromISO(previous.start), 'days').days
            items = items.map(item => item.deleted ? item : this.moveItem(item, (item.allDay ? DateTime.fromISO(item.start) : DateTime.fromISO(item.start).setZone(item.timezone)).plus({ days }).toISODate()!))
          } else if (command === 'update') {
            z.object({ title: z.string().trim().min(1).max(500).optional(), notes: z.string().max(20000).optional() }).strict().parse(patch)
          }
          const group = { ...previous, ...(itemId ? {} : patch), ...this.groupSpan(items, previous.timezone), items, version: previous.version + 1, updatedAt: now(), ...(command === 'delete' && !itemId ? { deleted: true } : {}) }
          return this.mutation([{ table: 'events', id: group.id, value: group }], dryRun, { event: group, eventId: group.id, version: group.version, itemCount: items.filter(e => !e.deleted).length })
        }
        if (itemId) throw new CalendarError('NOT_A_GROUP', '这个日程不是活动组')
        let next = { ...previous, ...patch }
        if (command === 'delete') next.deleted = true
        else {
          if (command === 'move') {
            dateSchema.parse(date)
            const day = DateTime.fromISO(date, { zone: previous.timezone })
            if (!day.isValid) throw new CalendarError('INVALID_DATE', 'Invalid destination date')
            if (previous.allDay) {
              const days = DateTime.fromISO(previous.end).diff(DateTime.fromISO(previous.start), 'days').days
              next.start = date; next.end = day.plus({ days }).toISODate()!
            } else {
              const start = DateTime.fromISO(previous.start).setZone(previous.timezone)
              const moved = day.set({ hour: start.hour, minute: start.minute, second: start.second, millisecond: start.millisecond })
              if (moved.hour !== start.hour || moved.minute !== start.minute) throw new CalendarError('DST_GAP', 'Local time does not exist on that date; choose another time')
              next.start = moved.toISO()!; next.end = moved.plus({ milliseconds: DateTime.fromISO(previous.end).toMillis() - start.toMillis() }).toISO()!
            }
          }
          const { id: _eventId, createdAt: _created, updatedAt: _updated, version: _v, deleted: _deleted, ...input } = next
          next = { ...next, ...this.validateEvent(input) }
        }
        next.updatedAt = now(); next.version = previous.version + 1
        return this.mutation([{ table: 'events', id: previous.id, value: next }], dryRun, { event: next, eventId: next.id, version: next.version })
      }
      case 'undo': {
        const id = z.string().parse(args.operationId)
        const op = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as any
        if (!op) throw new CalendarError('NOT_FOUND', 'Operation not found')
        if (op.undone) throw new CalendarError('ALREADY_UNDONE', 'Operation already undone')
        const after: Entity[] = JSON.parse(op.after_json), before: Entity[] = JSON.parse(op.before_json)
        for (const entity of after) if (JSON.stringify(this.read(entity.table, entity.id)) !== JSON.stringify(entity.value)) throw new CalendarError('VERSION_CONFLICT', 'Entity has changed since this operation')
        const restored = before.map((entity, index) => {
          if (entity.table === 'settings') return entity
          const current = after[index].value
          return { ...entity, value: entity.value ? { ...entity.value, version: current.version + 1, updatedAt: now() } : { ...current, deleted: true, version: current.version + 1, updatedAt: now() } }
        })
        const result = this.mutation(restored, dryRun, { undoneOperationId: id })
        if (!dryRun) this.db.prepare('UPDATE operations SET undone=1 WHERE id=?').run(id)
        return result
      }
      case 'settings.get': return { settings: this.settings() }
      case 'settings.set': {
        settingsSchema.partial().parse(args)
        const settings = settingsSchema.parse({ ...this.settings(), ...args })
        if (!DateTime.now().setZone(settings.timezone).isValid) throw new CalendarError('INVALID_TIMEZONE', 'Unknown timezone')
        return this.mutation([{ table: 'settings', id: 'app', value: settings }], dryRun, { settings })
      }
      case 'calendars.list': return { calendars: this.all('calendars').filter(c => !c.deleted) }
      case 'calendars.add': {
        const input = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#245b51') }).strict().parse(args)
        const calendar = { ...input, id: randomUUID(), version: 1, deleted: false }
        return this.mutation([{ table: 'calendars', id: calendar.id, value: calendar }], dryRun, { calendar })
      }
      case 'calendars.update': case 'calendars.delete': {
        const input = z.object({ id: z.string(), name: z.string().trim().min(1).max(100).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), expectedVersion: z.number().int().positive().optional(), includeEvents: z.boolean().optional() }).strict().parse(args)
        const calendar = this.read('calendars', input.id)
        if (!calendar || calendar.deleted) throw new CalendarError('NOT_FOUND', 'Calendar not found')
        this.checkVersion(calendar, input.expectedVersion)
        if (calendar.readOnly && command === 'calendars.delete') throw new CalendarError('READ_ONLY', 'Remove the subscription to remove this calendar')
        if (command === 'calendars.delete' && input.id === 'local') throw new CalendarError('DEFAULT_CALENDAR', 'Default calendar cannot be deleted')
        const events = this.list({ calendarId: input.id })
        if (command === 'calendars.delete' && events.length && !input.includeEvents) throw new CalendarError('CONFIRM_REQUIRED', 'Use --include-events to delete a nonempty calendar')
        const next = { ...calendar, ...(input.name ? { name: input.name } : {}), ...(input.color ? { color: input.color } : {}), deleted: command === 'calendars.delete', version: calendar.version + 1 }
        const changes: Entity[] = [{ table: 'calendars', id: next.id, value: next }]
        if (next.deleted) changes.push(...events.map(e => ({ table: 'events' as const, id: e.id, value: { ...e, deleted: true, version: e.version + 1, updatedAt: now() } })))
        return this.mutation(changes, dryRun, { calendar: next })
      }
      default: throw new CalendarError('UNKNOWN_COMMAND', `Unknown command: ${command}`)
    }
  }
  backupCreate(): { id: string; path: string } {
    const directory = path.join(this.directory, 'backups'); fs.mkdirSync(directory, { recursive: true })
    const id = `${Date.now()}-${randomUUID()}.sqlite`, file = path.join(directory, id)
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    return { id, path: file }
  }
  backupList() {
    const directory = path.join(this.directory, 'backups')
    return { backups: fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => f.endsWith('.sqlite')).sort().reverse().map(id => ({ id, path: path.join(directory, id) })) : [] }
  }
  backupRestore(args: Record<string, any>) {
    if (args.confirm !== true) throw new CalendarError('CONFIRM_REQUIRED', 'Restore requires --confirm')
    const id = z.string().regex(/^[a-zA-Z0-9-]+\.sqlite$/).parse(args.id)
    const file = path.join(this.directory, 'backups', id)
    if (!fs.existsSync(file)) throw new CalendarError('NOT_FOUND', 'Backup not found')
    const check = new Database(file, { readonly: true })
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok' || check.pragma('user_version', { simple: true }) !== 1) throw new CalendarError('INVALID_BACKUP', 'Unsupported or corrupt backup')
      for (const table of ['events', 'calendars', 'settings', 'requests', 'operations', 'ai_previews', 'external_mappings']) check.prepare(`SELECT * FROM ${table} LIMIT 1`).get()
    } finally { check.close() }
    const destination = path.join(this.directory, 'calendar.sqlite')
    const staged = `${destination}.restore-next`, previous = `${destination}.restore-old`
    fs.copyFileSync(file, staged)
    const fd = fs.openSync(staged, 'r+'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    const safetyBackup = this.backupCreate()
    this.db.pragma('wal_checkpoint(TRUNCATE)'); this.close()
    try {
      fs.renameSync(destination, previous); fs.renameSync(staged, destination); this.open(); fs.unlinkSync(previous)
    } catch (error) {
      if (this.db.open) this.db.close()
      if (fs.existsSync(previous)) { if (fs.existsSync(destination)) fs.unlinkSync(destination); fs.renameSync(previous, destination) }
      this.open(); throw error
    }
    return { restored: id, safetyBackup }
  }
  automaticBackup() {
    const backups = this.backupList().backups
    if (!backups.length || Number(backups[0].id.split('-')[0]) < Date.now() - 86400000) this.backupCreate()
    for (const old of this.backupList().backups.slice(14)) fs.unlinkSync(old.path)
  }
  savePreview(id: string, value: any) { this.db.prepare('INSERT INTO ai_previews VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(value)) }
  subscriptions(): any[] { return (this.db.prepare('SELECT value FROM subscriptions').all() as any[]).map(row => JSON.parse(row.value)) }
  saveSubscription(subscription: any) { this.db.prepare('INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(subscription.id, JSON.stringify(subscription)) }
  createSubscriptionCalendar(id: string, name: string, color: string) { this.write('calendars', id, { id, name, color, readOnly: true, version: 1, deleted: false }) }
  syncSubscription(id: string, entries: (Omit<Event, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'deleted'> & { externalId: string })[]) {
    return this.db.transaction(() => {
      const existing: Event[] = this.all('events').filter(e => e.subscriptionId === id), byKey = new Map(existing.map(e => [e.externalId, e]))
      const incoming = new Set<string>(); let added = 0, updated = 0, removed = 0
      for (const entry of entries) {
        if (incoming.has(entry.externalId)) throw new CalendarError('INVALID_FEED', 'Feed contains duplicate event identities')
        incoming.add(entry.externalId)
        this.validateEvent({ title: entry.title, notes: entry.notes, start: entry.start, end: entry.end, timezone: entry.timezone, allDay: entry.allDay, calendarId: entry.calendarId }, true)
        const previous = byKey.get(entry.externalId) || (entry.externalId.startsWith('hku:') ? existing.find(e => !e.deleted && e.title === entry.title && e.start === entry.start && e.end === entry.end) : undefined)
        const next: Event = { ...entry, id: previous?.id || randomUUID(), createdAt: previous?.createdAt || now(), updatedAt: now(), version: (previous?.version || 0) + 1, deleted: false, readOnly: true, subscriptionId: id }
        const same = previous && !previous.deleted && ['title', 'notes', 'start', 'end', 'timezone', 'allDay', 'externalId'].every(key => (previous as any)[key] === (entry as any)[key])
        if (!same) { this.write('events', next.id, next); if (previous) updated++; else added++ }
      }
      const preserved = new Set(entries.map(entry => byKey.get(entry.externalId)?.id || (entry.externalId.startsWith('hku:') ? existing.find(e => !e.deleted && e.title === entry.title && e.start === entry.start && e.end === entry.end)?.id : undefined)))
      for (const previous of existing) if (!previous.deleted && !incoming.has(previous.externalId!) && !preserved.has(previous.id)) { this.write('events', previous.id, { ...previous, deleted: true, version: previous.version + 1, updatedAt: now() }); removed++ }
      return { added, updated, removed, events: entries.length }
    })()
  }
  removeSubscription(id: string) {
    return this.db.transaction(() => {
      const subscription = this.subscriptions().find(s => s.id === id)
      if (!subscription) throw new CalendarError('NOT_FOUND', 'Subscription not found')
      for (const event of this.all('events')) if (event.subscriptionId === id && !event.deleted) this.write('events', event.id, { ...event, deleted: true, version: event.version + 1, updatedAt: now() })
      const calendar = this.read('calendars', subscription.calendarId)
      this.write('calendars', calendar.id, { ...calendar, deleted: true, version: calendar.version + 1 })
      this.db.prepare('DELETE FROM subscriptions WHERE id=?').run(id)
      return { removed: id }
    })()
  }
  getPreview(id: string): any {
    const row = this.db.prepare('SELECT value FROM ai_previews WHERE id=?').get(id) as any
    if (!row) throw new CalendarError('NOT_FOUND', 'Preview not found')
    return JSON.parse(row.value)
  }
}
