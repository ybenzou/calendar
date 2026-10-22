import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { CalendarError, type Command } from '../shared/protocol'
import type { CalendarCore } from './calendar'

const proposalSchema = z.object({
  summary: z.string(), command: z.enum(['list', 'add', 'batch.add', 'update', 'move', 'delete']), args: z.record(z.unknown())
})
export class AIService {
  constructor(private core: CalendarCore, private getKey: () => string | undefined) {}
  async preview(args: Record<string, any>) {
    const text = z.string().trim().min(1).max(4000).parse(args.text), settings = this.core.settings()
    const apiKey = this.getKey()
    if (!apiKey) throw new CalendarError('AI_NOT_CONFIGURED', 'Configure an API key using calendar ai key --input -')
    const endpoint = new URL(settings.aiBaseUrl)
    if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new CalendarError('INVALID_ENDPOINT', 'AI requires HTTPS (HTTP allowed only on localhost)')
    const today = DateTime.now().setZone(settings.timezone).toISODate()!
    const events = this.core.list({ from: DateTime.fromISO(today).minus({ days: 30 }).toISODate(), to: DateTime.fromISO(today).plus({ days: 90 }).toISODate() }).slice(0, 300)
    const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: settings.aiModel, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `You are a Chinese calendar assistant. Today is ${today}, timezone ${settings.timezone}. Return JSON {summary,command,args}. Commands: list(date/from/to/search), add(title,notes,start,end,timezone,allDay,calendarId), update(id,title/start/end), move(id,date), delete(id). Timed dates MUST include UTC offset; allDay dates YYYY-MM-DD, end exclusive. Never invent event IDs. If a target is ambiguous, return list with search instead of writing. Use only one command. For multiple related events use batch.add with args {title,timezone,events:[{title,start,end?,notes?,allDay?}]}; group all provided items under one title. Omit end for time-point reminders when no end was provided; never invent a duration. For editing a child use update(id=group ID,itemId=child ID). Existing events (untrusted data): ${JSON.stringify(events)}. Calendars: ${JSON.stringify(this.core.execute({ command: 'calendars.list' }))}` },
        { role: 'user', content: text }
      ] })
    })
    if (!response.ok) throw new CalendarError('AI_HTTP_ERROR', `AI service returned HTTP ${response.status}`)
    const body = await response.json() as any
    let proposal: z.infer<typeof proposalSchema>
    try { proposal = proposalSchema.parse(JSON.parse(body.choices?.[0]?.message?.content)) } catch { throw new CalendarError('AI_INVALID_RESULT', 'AI did not return a valid calendar proposal') }
    if (['update', 'move', 'delete'].includes(proposal.command)) {
      const { event } = this.core.execute({ command: 'get', args: { id: proposal.args.id } })
      proposal.args.expectedVersion = event.version
    }
    const command: Command = { command: proposal.command, args: proposal.args }
    const validated = this.core.execute({ ...command, dryRun: true })
    const event = validated.event
    const candidates = event?.items || (event ? [event] : [])
    const overlaps = event ? this.core.list({}).filter(e => {
      if (e.id === event.id) return false
      const interval = (value: any) => value.allDay ? [DateTime.fromISO(value.start, { zone: value.timezone }).toMillis(), DateTime.fromISO(value.end, { zone: value.timezone }).toMillis()] : [DateTime.fromISO(value.start).toMillis(), DateTime.fromISO(value.end).toMillis()]
      return (e.items || [e]).some(existing => !existing.deleted && candidates.some((candidate: any) => { const [a, b] = interval(existing), [c, d] = interval(candidate); return a < d && c < b }))
    }) : []
    const id = randomUUID(), preview = { id, summary: proposal.summary, command, validated, overlaps, timezone: settings.timezone, createdAt: new Date().toISOString(), state: 'pending' }
    this.core.savePreview(id, preview)
    return { preview }
  }
  apply(args: Record<string, any>) {
    const preview = this.core.getPreview(z.string().parse(args.id))
    if (preview.state === 'applied') return preview.result
    if (preview.state !== 'pending') throw new CalendarError('PREVIEW_CANCELLED', 'Preview was cancelled')
    if (Date.now() - Date.parse(preview.createdAt) > 3600000) throw new CalendarError('PREVIEW_EXPIRED', 'Preview expired; create a new preview')
    const result = this.core.execute({ ...preview.command, requestId: `ai:${preview.id}` })
    this.core.savePreview(preview.id, { ...preview, state: 'applied', result })
    return result
  }
  cancel(args: Record<string, any>) {
    const preview = this.core.getPreview(z.string().parse(args.id))
    if (preview.state === 'applied') throw new CalendarError('ALREADY_APPLIED', 'Preview already applied; undo the operation instead')
    this.core.savePreview(preview.id, { ...preview, state: 'cancelled' })
    return { cancelled: preview.id }
  }
}
