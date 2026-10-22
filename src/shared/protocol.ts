import { z } from 'zod'
import type { PetAction, PetMessage } from './pet'

export const commandSchema = z.object({
  command: z.string().min(1).max(80), args: z.record(z.unknown()).default({}),
  requestId: z.string().min(1).max(200).optional(), dryRun: z.boolean().default(false)
})
export type Command = z.input<typeof commandSchema>
export function stableJSON(value: unknown): string {
  const sorted = (item: any): any => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, sorted(item[key])])) : item
  return JSON.stringify(sorted(value))
}
export type Result = { ok: true; data: any } | { ok: false; error: { code: string; message: string } }
export class CalendarError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export function failure(error: unknown): Result {
  if (error instanceof CalendarError) return { ok: false, error: { code: error.code, message: error.message } }
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } }
  return { ok: false, error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Unknown error' } }
}
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const placeSchema = z.object({ name: z.string().trim().min(1).max(200), latitude: z.number().min(-85).max(85), longitude: z.number().min(-180).max(180) }).strict()
export const routeSchema = z.object({
  mode: z.enum(['foot', 'bike', 'car', 'tram', 'metro', 'bus', 'ferry', 'cable']),
  waypoints: z.array(placeSchema).min(2).max(16),
  geometry: z.array(z.tuple([z.number().min(-85).max(85), z.number().min(-180).max(180)])).min(2).max(20000).optional(),
  distanceMeters: z.number().nonnegative().max(10000000).optional(), durationSeconds: z.number().nonnegative().max(604800).optional(),
  source: z.enum(['osrm', 'manual']).default('manual')
}).strict()
export type Place = z.infer<typeof placeSchema>
export type Route = z.infer<typeof routeSchema>
export const settingsSchema = z.object({
  theme: z.enum(['swiss', 'warm', 'memphis']).default('swiss'),
  opacity: z.number().min(0.35).max(1).default(0.96), fontSize: z.number().int().min(12).max(22).default(14),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#f5f2e9'),
  timezone: z.string().default('Asia/Hong_Kong'), autoStart: z.boolean().default(false),
  displayId: z.number().int().optional(), preferredDisplay: z.number().int().min(1).max(16).default(2),
  fillDisplay: z.boolean().default(true),
  sidebarView: z.enum(['events', 'pet']).default('events'),
  x: z.number().int().default(320), y: z.number().int().default(80),
  width: z.number().int().min(760).max(7680).default(1100), height: z.number().int().min(540).max(4320).default(720),
  aiBaseUrl: z.string().url().default('https://api.openai.com/v1'), aiModel: z.string().min(1).max(200).default('gpt-4.1-mini'),
  mapTileUrl: z.string().startsWith('https://').max(500).refine(v => ['{z}', '{x}', '{y}'].every(p => v.includes(p)), '需要 z/x/y 模板').default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  mapRoutingUrl: z.string().url().startsWith('https://').default('https://routing.openstreetmap.de')
}).strict()
export type Settings = z.infer<typeof settingsSchema>
export type Event = {
  id: string; calendarId: string; title: string; notes: string; start: string; end: string;
  timezone: string; allDay: boolean; createdAt: string; updatedAt: string; version: number; deleted: boolean;
  readOnly?: boolean; subscriptionId?: string; externalId?: string;
  items?: Event[]; pointInTime?: boolean; batchKey?: string; batchSignature?: string
  location?: Place | null; route?: Route | null
}
export interface CalendarAPI {
  execute(command: Command): Promise<Result>
  subscribe(callback: () => void): () => void
  pet(action: PetAction): Promise<void>
  subscribePet(callback: (message: PetMessage) => void): () => void
}
