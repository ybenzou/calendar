import { commandDefinitions } from '../shared/commands'
import { Command as Commander } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dataDirectory, request } from '../shared/transport'
import { failure, type Command } from '../shared/protocol'

function launchService() {
  const packaged = process.env.CALENDAR_PACKAGED === '1'
  const electron = packaged ? process.execPath : path.join(__dirname, '../../node_modules/electron/dist/electron.exe')
  const entry = packaged ? path.join(process.resourcesPath || path.join(path.dirname(process.execPath), 'resources'), 'app.asar') : path.join(__dirname, '../..')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [entry, '--service'], { detached: true, stdio: 'ignore', windowsHide: true, env })
  child.on('error', () => {}); child.unref()
}
async function execute(command: string, options: any, context: Commander) {
  const global = context.optsWithGlobals(), { input, json, dryRun, requestId, ...args } = { ...global, ...options }
  let data = args
  if (input) {
    const source = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8')
    const parsed = JSON.parse(source)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Input must be a JSON object')
    data = { ...parsed, ...args }
  }
  const isWrite = ['add', 'batch.add', 'update', 'delete', 'move', 'undo', 'settings.set', 'calendars.add', 'calendars.update', 'calendars.delete', 'backup.create', 'backup.restore', 'ai.preview', 'ai.apply', 'ai.cancel'].includes(command)
  const directory = dataDirectory(), payload: Command = { command, args: data, dryRun: !!dryRun, requestId: requestId || (isWrite ? randomUUID() : undefined) }
  let result
  try { result = await request(directory, payload) } catch {
    if (command === 'status') result = { ok: true as const, data: { running: false, ui: false } }
    else if (command === 'quit') result = { ok: true as const, data: { stopped: true } }
    else {
      launchService()
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 125))
        try { result = await request(directory, payload); break } catch { /* wait for pipe creation */ }
      }
      if (!result) throw new Error('Calendar service failed to start; check data directory logs')
    }
  }
  if (!result.ok) { process.stderr.write(json ? JSON.stringify(result) + '\n' : `${result.error.code}: ${result.error.message}\n`); process.exitCode = 1 }
  else process.stdout.write(json ? JSON.stringify(result) + '\n' : JSON.stringify(result.data, null, 2) + '\n')
}

const program = new Commander().name('calendar').description('Programmable local-first desktop calendar').version('0.2.22')
  .option('--json', 'Machine-readable output').option('--input <path>', 'JSON file or - for stdin')
  .option('--dry-run', 'Validate without writing').option('--request-id <id>', 'Idempotent write identifier')
function register(parent: Commander, name: string, command: string, flags: string[] = []) {
  const child = parent.command(name).description(command)
  for (const flag of flags) { if (flag.includes('<number>')) child.option(flag, '', Number); else child.option(flag, '') }
  child.action(async (options, context) => { try { await execute(command, options, context) } catch (error) { process.stderr.write(JSON.stringify(failure(error)) + '\n'); process.exitCode = 1 } })
  return child
}
const groups = new Map<string, Commander>()
for (const definition of commandDefinitions) {
  const [group, child] = definition.path.split('.')
  let parent = program
  if (child) { if (!groups.has(group)) groups.set(group, program.command(group)); parent = groups.get(group)! }
  register(parent, child || group, definition.path, definition.flags)
}
program.parseAsync(process.argv.slice(2), { from: 'user' }).catch(error => { process.stderr.write(JSON.stringify(failure(error)) + '\n'); process.exitCode = 1 })
