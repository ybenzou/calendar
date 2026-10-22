import type { Event } from '../shared/protocol'

/** Providers translate remote objects; only the business core writes local events. */
export interface CalendarConnector {
  provider: 'google' | 'outlook' | 'test'
  authorize(): Promise<{ accountId: string }>
  calendars(accountId: string): Promise<{ id: string; name: string }[]>
  pull(accountId: string, calendarId: string, cursor?: string): Promise<{ changes: { externalId: string; event?: Omit<Event, 'id'>; deleted: boolean; version: string }[]; cursor: string }>
  push(accountId: string, calendarId: string, changes: { localId: string; externalId?: string; event: Event; expectedRemoteVersion?: string }[]): Promise<{ localId: string; externalId: string; version: string }[]>
}
