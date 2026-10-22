import { CalendarError, type Command } from './protocol'
const eventFlags = ['--title <text>', '--notes <text>', '--start <time>', '--end <time>', '--timezone <zone>', '--calendar-id <id>', '--all-day']
export const commandDefinitions: { path: string; flags: string[] }[] = [
  ...['run', 'quit', 'status'].map(path => ({ path, flags: [] })),
  { path: 'add', flags: eventFlags },
  { path: 'batch.add', flags: ['--title <text>', '--timezone <zone>', '--calendar-id <id>', '--key <key>', '--replace-id <id>', '--expected-version <number>'] },
  { path: 'maps.route', flags: ['--mode <mode>'] },
  { path: 'activity.list', flags: ['--from <date>', '--to <date>'] },
  { path: 'list', flags: ['--date <date>', '--from <date>', '--to <date>', '--timezone <zone>', '--calendar-id <id>', '--search <text>'] },
  { path: 'get', flags: ['--id <id>'] },
  { path: 'update', flags: ['--id <id>', '--item-id <id>', '--expected-version <number>', ...eventFlags] },
  { path: 'delete', flags: ['--id <id>', '--item-id <id>', '--expected-version <number>'] },
  { path: 'move', flags: ['--id <id>', '--date <date>', '--expected-version <number>'] },
  { path: 'undo', flags: ['--operation-id <id>'] },
  { path: 'view', flags: ['--date <date>', '--month <month>', '--today', '--group-id <id>'] },
  { path: 'window', flags: ['--action <action>', '--panel <panel>', '--id <id>', '--item-id <id>', '--date <date>', '--x <number>', '--y <number>', '--width <number>', '--height <number>'] },
  { path: 'settings.get', flags: [] },
  { path: 'settings.set', flags: ['--theme <theme>', '--opacity <number>', '--font-size <number>', '--background <color>', '--timezone <zone>', '--display-id <number>', '--preferred-display <number>', '--ai-base-url <url>', '--ai-model <model>', '--map-tile-url <url>', '--map-routing-url <url>'] },
  { path: 'subscriptions.list', flags: [] },
  { path: 'subscriptions.add', flags: ['--name <name>', '--url <url>', '--timezone <zone>', '--color <color>'] },
  { path: 'subscriptions.refresh', flags: ['--id <id>'] },
  { path: 'subscriptions.update', flags: ['--id <id>', '--url <url>', '--name <name>'] },
  { path: 'subscriptions.remove', flags: ['--id <id>', '--confirm'] },
  { path: 'calendars.list', flags: [] },
  { path: 'calendars.add', flags: ['--name <name>', '--color <color>'] },
  { path: 'calendars.update', flags: ['--id <id>', '--name <name>', '--color <color>', '--expected-version <number>'] },
  { path: 'calendars.delete', flags: ['--id <id>', '--include-events', '--expected-version <number>'] },
  { path: 'backup.create', flags: [] }, { path: 'backup.list', flags: [] }, { path: 'backup.restore', flags: ['--id <id>', '--confirm'] },
  { path: 'ai.key', flags: [] }, { path: 'ai.preview', flags: ['--text <text>'] }, { path: 'ai.apply', flags: ['--id <id>'] }, { path: 'ai.cancel', flags: ['--id <id>'] }
]
function tokens(text: string): string[] {
  const result: string[] = []; let value = '', quote = '', started = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && (text[i + 1] === quote || text[i + 1] === '\\')) value += text[++i]
      else value += c
    } else if (c === '"' || c === "'") { quote = c; started = true }
    else if (/\s/.test(c)) { if (started) { result.push(value); value = ''; started = false } }
    else { value += c; started = true }
  }
  if (quote) throw new CalendarError('INVALID_COMMAND', '引号没有闭合')
  if (started) result.push(value)
  return result
}
export function parseCommandText(text: string): Command {
  const source = text.trim().replace(/^calendar\s+/, '').replace(/^\//, '')
  const jsonIndex = source.indexOf('{'), prefix = jsonIndex >= 0 ? source.slice(0, jsonIndex).trim().replace(/\s+/g, '.') : ''
  if (jsonIndex >= 0 && commandDefinitions.some(d => d.path === prefix)) {
    let args: any
    try { args = JSON.parse(source.slice(jsonIndex)) } catch { throw new CalendarError('INVALID_COMMAND', '命令参数不是有效 JSON') }
    if (!args || Array.isArray(args) || typeof args !== 'object') throw new CalendarError('INVALID_COMMAND', '参数需要 JSON 对象')
    return { command: prefix, args }
  }
  const words = tokens(source), root = words.shift(), grouped = commandDefinitions.some(d => d.path.startsWith(`${root}.`))
  const command = grouped ? `${root}.${words.shift()}` : root
  const definition = commandDefinitions.find(d => d.path === command)
  if (!definition) throw new CalendarError('INVALID_COMMAND', '未知命令；输入 /帮助 查看入口')
  const args: Record<string, unknown> = {}, envelope: Command = { command: definition.path, args }
  const flags = [...definition.flags, '--dry-run', '--request-id <id>', '--json']
  for (let i = 0; i < words.length; i++) {
    const [flag, inline] = words[i].split(/=(.*)/s)
    const spec = flags.find(f => f.split(' ')[0] === flag)
    if (!spec) throw new CalendarError('INVALID_COMMAND', `不支持参数 ${flag}；JSON 参数可以直接写在命令后`)
    const value = spec.includes('<') ? inline ?? words[++i] : true
    if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) throw new CalendarError('INVALID_COMMAND', `${flag} 缺少参数`)
    const name = flag.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    const parsed = spec.includes('<number>') ? Number(value) : value
    if (spec.includes('<number>') && !Number.isFinite(parsed)) throw new CalendarError('INVALID_COMMAND', `${flag} 需要数字`)
    if (name === 'dryRun') envelope.dryRun = true
    else if (name === 'requestId') envelope.requestId = String(parsed)
    else if (name !== 'json') args[name] = parsed
  }
  return envelope
}
