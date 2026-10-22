import type { Command, Result } from './protocol'
import { dataDirectory, request } from './transport'

/** Node/Electron client. Start the service using `calendar run` or any data CLI command. */
export function createCalendarClient(directory = dataDirectory()) {
  return { execute: (command: Command): Promise<Result> => request(directory, command) }
}
