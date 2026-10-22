import { randomUUID, createHash } from 'node:crypto'
import ical from 'node-ical'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { CalendarError, type Event } from '../shared/protocol'
import type { CalendarCore } from './calendar'

function normalizeURL(value: string) {
  let url: URL
  try { url = new URL(value.replace(/^webcal:/i, 'https:')) } catch { throw new CalendarError('INVALID_SUBSCRIPTION_URL', '请输入有效的日历订阅地址') }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new CalendarError('INVALID_SUBSCRIPTION_URL', '订阅需要 HTTPS 地址')
  url.hash = ''; return url.toString()
}
const text = (value: any): string => typeof value === 'string' ? value : value?.val ? String(value.val) : ''
type Imported = Omit<Event, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'deleted'> & { externalId: string }
export async function parseSubscriptionICS(body: string, calendarId: string, zone = 'Asia/Hong_Kong', identityStrategy: 'uid' | 'hku-schedule' = 'uid'): Promise<Imported[]> {
  if (!/^BEGIN:VCALENDAR\s*$/m.test(body.replace(/\r/g, '')) || !/END:VCALENDAR/.test(body)) throw new CalendarError('INVALID_FEED', '地址没有返回 ICS 日历，可能是登录页或订阅未启用')
  let data: any
  try { data = await ical.async.parseICS(body) } catch { throw new CalendarError('INVALID_FEED', '日历内容无法解析，已保留上次缓存') }
  const entries: Imported[] = [], from = DateTime.now().minus({ years: 1 }).startOf('year').toJSDate(), to = DateTime.now().plus({ years: 2 }).endOf('year').toJSDate()
  for (const source of Object.values(data) as any[]) {
    if (source.type !== 'VEVENT' || source.status === 'CANCELLED') continue
    if (!source.uid || !(source.start instanceof Date)) throw new CalendarError('INVALID_FEED', '订阅事件缺少 UID 或日期；已保留上次缓存')
    const instances = source.rrule || source.rdate ? ical.expandRecurringEvent(source, { from, to, includeOverrides: true, excludeExdates: true, expandOngoing: true }) : [{ start: source.start, end: source.end, isFullDay: source.datetype === 'date' || source.start.dateOnly === true, event: source, summary: source.summary, isRecurring: false }]
    for (const instance of instances) {
      const event = instance.event as any
      if (event.status === 'CANCELLED') continue
      // The source may encode UTC; its instant stays unchanged while this
      // subscription is displayed in the configured calendar timezone (HKT).
      const timezone = zone
      const startDate = DateTime.fromJSDate(instance.start), endDate = instance.end ? DateTime.fromJSDate(instance.end) : undefined
      const allDay = instance.isFullDay
      const start = allDay ? startDate.toISODate()! : startDate.toUTC().toISO()!
      const end = allDay ? (endDate && endDate.toMillis() > startDate.toMillis() ? endDate : startDate.plus({ days: 1 })).toISODate()! : (endDate && endDate.toMillis() > startDate.toMillis() ? endDate : startDate.plus({ minutes: 15 })).toUTC().toISO()!
      const recurrenceId = instance.isRecurring ? event.recurrenceid instanceof Date ? event.recurrenceid.toISOString() : startDate.toUTC().toISO() : 'single'
      const title = (text(instance.summary) || '学校日程').trim().slice(0, 500), location = text(event.location).trim()
      // HKU regenerates random UIDs on every export. Scope a stable schedule
      // fingerprint to this subscription instead of accumulating fresh copies.
      const externalId = identityStrategy === 'hku-schedule' ? `hku:${createHash('sha256').update(JSON.stringify([title, start, end, allDay])).digest('hex')}` : `${source.uid}::${recurrenceId}`
      entries.push({ calendarId, title, notes: [text(event.description).trim(), location ? `地点：${location}` : ''].filter(Boolean).join('\n').slice(0, 20000), start, end, timezone, allDay, readOnly: true, externalId })
      if (entries.length > 10000) throw new CalendarError('FEED_TOO_LARGE', '订阅展开超过一万条事件，已保留上次缓存')
    }
  }
  return entries
}
export class SubscriptionService {
  private pending = new Map<string, Promise<any>>()
  constructor(private core: CalendarCore, private encrypt: (value: string) => string, private decrypt: (value: string) => string) {
    // Existing successful imports are local calendars, not background feeds.
    for (const subscription of core.subscriptions()) {
      if (subscription.refreshMode === 'manual') continue
      const { refreshMinutes: _interval, ...retained } = subscription
      const cached = subscription.lastSync && subscription.eventCount > 0
      core.saveSubscription({ ...retained, refreshMode: 'manual', ...(cached ? { state: 'cached', message: '', errorCode: undefined } : {}) })
    }
  }
  list() { return { subscriptions: this.core.subscriptions().map(({ encryptedUrl: _url, etag: _etag, lastModified: _modified, ...value }) => value) } }
  async add(args: Record<string, any>, dryRun = false) {
    const input = z.object({ name: z.string().trim().min(1).max(100), url: z.string().max(4096), timezone: z.string().default('Asia/Hong_Kong'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c8d5c') }).strict().parse(args)
    const url = normalizeURL(input.url)
    if (!DateTime.now().setZone(input.timezone).isValid) throw new CalendarError('INVALID_TIMEZONE', 'Unknown timezone')
    if (dryRun) return { dryRun: true, name: input.name, hostname: new URL(url).hostname }
    const duplicate = this.core.subscriptions().find(s => this.decrypt(s.encryptedUrl) === url)
    if (duplicate) return { subscription: this.list().subscriptions.find(s => s.id === duplicate.id), duplicate: true }
    const id = randomUUID(), calendarId = `subscription-${id}`
    const subscription = { id, calendarId, name: input.name, hostname: new URL(url).hostname, timezone: input.timezone, encryptedUrl: this.encrypt(url), enabled: true, state: 'pending', eventCount: 0, createdAt: new Date().toISOString(), refreshMode: 'manual' }
    this.core.createSubscriptionCalendar(calendarId, input.name, input.color); this.core.saveSubscription(subscription)
    return this.refresh({ id })
  }
  async refresh(args: Record<string, any> = {}, dryRun = false) {
    const input = z.object({ id: z.string().optional() }).strict().parse(args)
    const subscriptions = this.core.subscriptions().filter(s => !input.id || s.id === input.id)
    if (input.id && !subscriptions.length) throw new CalendarError('NOT_FOUND', 'Subscription not found')
    if (dryRun) return { dryRun: true, count: subscriptions.length }
    const results = []
    for (const subscription of subscriptions) {
      let pending = this.pending.get(subscription.id)
      if (!pending) { pending = this.refreshOne(subscription).finally(() => this.pending.delete(subscription.id)); this.pending.set(subscription.id, pending) }
      results.push(await pending)
    }
    return { subscriptions: results, subscription: results.length === 1 ? results[0] : undefined }
  }
  private async refreshOne(subscription: any) {
    const attempt = new Date().toISOString()
    try {
      const headers: Record<string, string> = { Accept: 'text/calendar, application/octet-stream;q=0.9' }
      if (subscription.etag) headers['If-None-Match'] = subscription.etag
      if (subscription.lastModified) headers['If-Modified-Since'] = subscription.lastModified
      const response = await fetch(this.decrypt(subscription.encryptedUrl), { headers, signal: AbortSignal.timeout(20000), redirect: 'error' })
      if (response.status === 304) { this.core.saveSubscription({ ...subscription, state: 'ok', message: '', lastAttempt: attempt, lastSync: attempt }); return this.list().subscriptions.find(s => s.id === subscription.id) }
      if (!response.ok) throw new CalendarError(`SUBSCRIPTION_HTTP_${response.status}`, [401, 403].includes(response.status) ? `学校返回 HTTP ${response.status}；请启用 Internet Calendar 并保存，或更新订阅地址` : `订阅服务返回 HTTP ${response.status}，已保留上次缓存`)
      if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) throw new CalendarError('FEED_TOO_LARGE', '订阅内容超过 10 MB')
      const reader = response.body?.getReader(); if (!reader) throw new CalendarError('INVALID_FEED', '订阅返回空内容')
      const chunks: Uint8Array[] = []; let size = 0
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new CalendarError('FEED_TOO_LARGE', '订阅内容超过 10 MB') }; chunks.push(value) }
      const body = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
      const entries = await parseSubscriptionICS(body, subscription.calendarId, subscription.timezone, subscription.hostname === 'hkuesd.hku.hk' ? 'hku-schedule' : 'uid')
      // Removal during a network refresh must not resurrect the subscription.
      if (!this.core.subscriptions().some(s => s.id === subscription.id)) return { removed: subscription.id }
      const changes = this.core.syncSubscription(subscription.id, entries)
      this.core.saveSubscription({ ...subscription, state: 'ok', message: '', errorCode: undefined, eventCount: entries.length, lastAttempt: attempt, lastSync: attempt, etag: response.headers.get('etag') || undefined, lastModified: response.headers.get('last-modified') || undefined })
      return { ...this.list().subscriptions.find(s => s.id === subscription.id), changes }
    } catch (error) {
      if (!this.core.subscriptions().some(s => s.id === subscription.id)) return { removed: subscription.id }
      const code = error instanceof CalendarError ? error.code : 'SUBSCRIPTION_NETWORK_ERROR'
      const message = error instanceof CalendarError ? error.message : '订阅网络请求失败；已保留上次缓存，可稍后重试'
      this.core.saveSubscription({ ...subscription, state: 'error', errorCode: code, message, lastAttempt: attempt })
      return this.list().subscriptions.find(s => s.id === subscription.id)
    }
  }
  async update(args: Record<string, any>, dryRun = false) {
    const input = z.object({ id: z.string(), url: z.string().optional(), name: z.string().trim().min(1).max(100).optional() }).strict().parse(args)
    const subscription = this.core.subscriptions().find(s => s.id === input.id)
    if (!subscription) throw new CalendarError('NOT_FOUND', 'Subscription not found')
    const url = input.url ? normalizeURL(input.url) : undefined
    if (dryRun) return { dryRun: true, id: input.id }
    this.core.saveSubscription({ ...subscription, ...(url ? { encryptedUrl: this.encrypt(url), hostname: new URL(url).hostname, etag: undefined, lastModified: undefined } : {}), ...(input.name ? { name: input.name } : {}) })
    if (input.name) this.core.execute({ command: 'calendars.update', args: { id: subscription.calendarId, name: input.name } })
    return this.refresh({ id: input.id })
  }
  remove(args: Record<string, any>, dryRun = false) {
    const input = z.object({ id: z.string(), confirm: z.literal(true) }).strict().parse(args)
    return dryRun ? { dryRun: true, id: input.id } : this.core.removeSubscription(input.id)
  }
}
