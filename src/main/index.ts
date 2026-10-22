import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, safeStorage, screen, powerMonitor, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { CalendarCore } from '../core/calendar'
import { AIService } from '../core/ai'
import { SubscriptionService } from '../core/subscriptions'
import { CalendarError, commandSchema, dateSchema, failure, stableJSON, type Command, type Result } from '../shared/protocol'
import { dataDirectory, pipeAddress } from '../shared/transport'
import { DesktopHost, native } from './desktop'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { MapService } from './maps'
import { AgentActivityService } from './activity'
import { legacyDataDirectories, migrateCalendarData } from './data-migration'
import { PetBridge } from './pet'

protocol.registerSchemesAsPrivileged([{ scheme: 'calendar-map', privileges: { standard: true, secure: true } }])

if (app.isPackaged) process.env.CALENDAR_PACKAGED = '1'
const directory = dataDirectory()
fs.mkdirSync(directory, { recursive: true }); app.setPath('userData', directory)
const desktop = new DesktopHost()
let core: CalendarCore, ai: AIService, mainWindow: BrowserWindow | null = null, editor: BrowserWindow | null = null, tray: Tray | null = null
let subscriptions: SubscriptionService
let maps: MapService
let agentActivity: AgentActivityService | null = null
let petRequested = false
const petBridge = new PetBridge(message => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('calendar:pet-frame', message) })
function updatePetHost() { petBridge.setEnabled(petRequested && !!mainWindow?.isVisible() && !mainWindow.isMinimized()) }
let selectedDate = DateTime.now().toISODate()!, visibleMonth = selectedDate.slice(0, 7), diagnostic = false
let selectedGroupId: string | null = null
let server: net.Server, quitting = false, recovery: NodeJS.Timeout, backupTimer: NodeJS.Timeout, activityTimer: NodeJS.Timeout
const mutationCommands = new Set(['add', 'batch.add', 'update', 'delete', 'move', 'undo', 'settings.set', 'calendars.add', 'calendars.update', 'calendars.delete', 'backup.restore', 'ai.apply', 'subscriptions.add', 'subscriptions.update', 'subscriptions.refresh', 'subscriptions.remove'])
function log(error: unknown) {
  const logs = path.join(directory, 'logs'); fs.mkdirSync(logs, { recursive: true })
  fs.appendFileSync(path.join(logs, `${new Date().toISOString().slice(0, 10)}.log`), `${new Date().toISOString()} ${error instanceof CalendarError ? error.code : 'RUNTIME_ERROR'}\n`)
  for (const name of fs.readdirSync(logs)) if (/^\d{4}-\d{2}-\d{2}\.log$/.test(name) && Date.parse(name.slice(0, 10)) < Date.now() - 7 * 86400000) fs.unlinkSync(path.join(logs, name))
}
function publish() { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('calendar:changed') }
function runtimeStatus() { return { running: true, ui: !!mainWindow, visible: mainWindow?.isVisible() || false, desktop: desktop.state, diagnostic, dataDirectory: directory, selectedDate, month: visibleMonth, groupId: selectedGroupId, aiConfigured: fs.existsSync(path.join(directory, 'ai-key.bin')), displays: orderedDisplays().map((display, index) => ({ number: index + 1, id: display.id, label: display.label, primary: display.id === screen.getPrimaryDisplay().id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor })), bounds: mainWindow?.getBounds() } }
function orderedDisplays() {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().sort((a, b) => a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
}
function load(window: BrowserWindow, query: Record<string, string> = {}) {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    void window.loadURL(url.toString())
  } else void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
}
function windowOptions() {
  return { preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
}
function secureWindow(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['https://www.openstreetmap.org/copyright', 'https://www.openstreetmap.org/fixthemap', 'https://routing.openstreetmap.de/about.html'].includes(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
function position() {
  if (!mainWindow) return
  const settings = core.settings(), displays = orderedDisplays()
  const display = displays.find(d => d.id === settings.displayId) || displays[Math.min(settings.preferredDisplay - 1, displays.length - 1)]
  const area = display.workArea
  if (desktop.state.attached && !diagnostic) {
    void desktop.position(mainWindow, displays.indexOf(display) + 1, settings.fillDisplay ? undefined : { x: Math.round((settings.x-area.x)*display.scaleFactor), y: Math.round((settings.y-area.y)*display.scaleFactor), width: Math.round(settings.width*display.scaleFactor), height: Math.round(settings.height*display.scaleFactor) }).then(publish)
    return
  }
  if (settings.fillDisplay) { mainWindow.setBounds(area); return }
  mainWindow.setBounds({ x: Math.max(area.x, Math.min(settings.x, area.x + area.width - Math.min(settings.width, area.width))), y: Math.max(area.y, Math.min(settings.y, area.y + area.height - Math.min(settings.height, area.height))), width: Math.min(settings.width, area.width), height: Math.min(settings.height, area.height) })
}
function showUI() {
  if (mainWindow) { mainWindow.show(); return }
  mainWindow = new BrowserWindow({ width: 1100, height: 720, minWidth: 760, minHeight: 540, show: false, frame: false, transparent: true, skipTaskbar: true, backgroundColor: '#00000000', webPreferences: windowOptions() })
  secureWindow(mainWindow); position(); load(mainWindow)
  mainWindow.on('show', updatePetHost)
  mainWindow.on('hide', updatePetHost)
  mainWindow.on('minimize', updatePetHost)
  mainWindow.on('restore', updatePetHost)
  mainWindow.webContents.on('render-process-gone', () => { petRequested = false; updatePetHost() })
  mainWindow.webContents.on('did-start-loading', () => { petRequested = false; updatePetHost() })
  mainWindow.once('ready-to-show', async () => {
    if (!mainWindow) return
    mainWindow.show(); mainWindow.setFocusable(false)
    const result = process.env.CALENDAR_DIAGNOSTIC === '1' ? { attached: false, reason: 'Explicit diagnostic mode' } : await desktop.attach(mainWindow)
    if (!result.attached) { diagnostic = true; mainWindow.setFocusable(true); mainWindow.setSkipTaskbar(false) }
    else { mainWindow.setSkipTaskbar(true); position() }
    publish()
  })
  mainWindow.on('closed', () => { mainWindow = null; petRequested = false; updatePetHost(); desktop.state = { attached: false, reason: 'UI closed' }; publish() })
  if (!tray) {
    const icon = nativeImage.createFromPath(app.isPackaged ? path.join(process.resourcesPath, 'assets/generated/calendar.png') : path.join(app.getAppPath(), 'resources/generated/calendar.png')).resize({ width: 20, height: 20 })
    tray = new Tray(icon); tray.setToolTip('Calendar')
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示日历', click: showUI }, { label: '隐藏日历', click: () => mainWindow?.hide() }, { label: '普通窗口诊断', click: async () => { if (mainWindow) { await desktop.detach(mainWindow); mainWindow.setFocusable(true); mainWindow.setSkipTaskbar(false); diagnostic = true; mainWindow.show(); publish() } } }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]))
    tray.on('double-click', showUI)
  }
}
async function execute(raw: Command): Promise<Result> {
  try {
    const command = commandSchema.parse(raw), args = command.args as Record<string, any>
    const externalWrite = ['backup.create', 'backup.restore', 'ai.preview', 'ai.apply', 'ai.cancel'].includes(command.command)
    const signature = stableJSON({ command: command.command, args, dryRun: command.dryRun })
    if (externalWrite && command.requestId && !command.dryRun) {
      const cached = core.replayRequest(command.requestId, signature)
      if (cached !== undefined) return { ok: true, data: cached }
    }
    let data: any
    switch (command.command) {
      case 'activity.list': data = agentActivity?.range(args, core.settings().timezone) || { available: false, capturedSince: null, days: {} }; break
      case 'maps.route': data = await maps.route(args, command.dryRun); break
      case 'status': data = runtimeStatus(); break
      case 'run': if (!command.dryRun) showUI(); data = runtimeStatus(); break
      case 'quit': data = { stopped: true }; if (!command.dryRun) setTimeout(() => app.quit(), 150); break
      case 'view': {
        if (!mainWindow) throw new CalendarError('UI_NOT_RUNNING', 'Start the calendar using calendar run')
        const input = z.object({ date: dateSchema.optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), today: z.boolean().optional(), groupId: z.string().optional() }).strict().parse(args)
        const group = input.groupId ? core.execute({ command: 'get', args: { id: input.groupId } }).event : undefined
        if (group && !group.items) throw new CalendarError('NOT_A_GROUP', '这个日程不是活动组')
        const date = input.today ? DateTime.now().setZone(core.settings().timezone).toISODate()! : input.date || (input.month ? `${input.month}-01` : group?.start || selectedDate)
        const month = input.month || date.slice(0, 7)
        if (!DateTime.fromISO(date).isValid || !DateTime.fromISO(`${month}-01`).isValid) throw new CalendarError('INVALID_DATE', 'Invalid view date')
        if (!command.dryRun) { selectedDate = date; visibleMonth = month; selectedGroupId = input.groupId || null; publish() }
        data = { date, month }; break
      }
      case 'window': {
        if (!mainWindow) throw new CalendarError('UI_NOT_RUNNING', 'Start the calendar using calendar run')
        const input = z.object({ action: z.enum(['show', 'hide', 'close', 'attach', 'detach', 'diagnostic', 'bounds', 'editor', 'tools', 'input-focus', 'input-release', 'status']), panel: z.enum(['ai', 'settings', 'calendars', 'backups']).optional(), x: z.number().int().optional(), y: z.number().int().optional(), width: z.number().int().min(760).optional(), height: z.number().int().min(540).optional(), id: z.string().optional(), itemId: z.string().optional(), date: dateSchema.optional() }).strict().parse(args)
        if (!command.dryRun) switch (input.action) {
          case 'show': mainWindow.show(); break
          case 'input-focus': mainWindow.setFocusable(true); if (!diagnostic) mainWindow.setSkipTaskbar(true); mainWindow.focus(); break
          case 'input-release': if (!diagnostic) { mainWindow.setFocusable(false); mainWindow.setSkipTaskbar(true) }; break
          case 'hide': mainWindow.hide(); break
          case 'close': mainWindow.close(); break
          case 'attach': diagnostic = false; mainWindow.setFocusable(false); mainWindow.setSkipTaskbar(true); await desktop.attach(mainWindow); position(); break
          case 'detach': case 'diagnostic': diagnostic = true; await desktop.detach(mainWindow); mainWindow.setFocusable(true); mainWindow.setSkipTaskbar(false); mainWindow.show(); break
          case 'bounds': {
            const { action: _action, id: _id, itemId: _itemId, date: _date, panel: _panel, ...bounds } = input
            core.execute({ command: 'settings.set', args: { ...bounds, fillDisplay: false } }); position(); break
          }
          case 'editor': {
            if (input.id && core.execute({ command: 'get', args: { id: input.id } }).event.readOnly) throw new CalendarError('READ_ONLY', '学校订阅日程为只读')
            if (editor) editor.close()
            editor = new BrowserWindow({ width: 480, height: 720, resizable: false, title: '日程编辑', backgroundColor: '#f5f2e9', webPreferences: windowOptions() })
            editor.setMenu(null); secureWindow(editor); load(editor, { editor: '1', ...(input.id ? { id: input.id } : {}), ...(input.itemId ? { itemId: input.itemId } : {}), date: input.date || selectedDate })
            editor.on('closed', () => { editor = null }); break
          }
          case 'tools': {
            const tools = new BrowserWindow({ width: 1100, height: 820, title: '日历设置与 AI', backgroundColor: '#f5f2e9', webPreferences: windowOptions() })
            tools.setMenu(null); secureWindow(tools); load(tools, { tools: '1', panel: input.panel || 'settings' }); break
          }
        }
        data = runtimeStatus(); publish(); break
      }
      case 'backup.create': data = command.dryRun ? { dryRun: true } : core.backupCreate(); break
      case 'backup.list': data = core.backupList(); break
      case 'subscriptions.list': data = subscriptions.list(); break
      case 'subscriptions.add': data = await subscriptions.add(args, command.dryRun); break
      case 'subscriptions.refresh': data = await subscriptions.refresh(args, command.dryRun); break
      case 'subscriptions.update': data = await subscriptions.update(args, command.dryRun); break
      case 'subscriptions.remove': data = subscriptions.remove(args, command.dryRun); break
      case 'backup.restore': {
        z.object({ id: z.string().regex(/^[a-zA-Z0-9-]+\.sqlite$/), confirm: z.literal(true) }).strict().parse(args)
        data = command.dryRun ? { dryRun: true } : core.backupRestore(args); break
      }
      case 'ai.key': {
        const input = z.object({ key: z.string().min(1).max(4096) }).strict().parse(args)
        if (!safeStorage.isEncryptionAvailable()) throw new CalendarError('ENCRYPTION_UNAVAILABLE', 'Windows credential encryption unavailable')
        if (!command.dryRun) fs.writeFileSync(path.join(directory, 'ai-key.bin'), safeStorage.encryptString(input.key))
        data = { configured: true }; break
      }
      case 'ai.preview': if (command.dryRun) throw new CalendarError('INVALID_INPUT', 'Preview already performs validation; omit --dry-run'); data = await ai.preview(args); break
      case 'ai.apply': data = command.dryRun ? core.execute({ ...core.getPreview(z.string().parse(args.id)).command, dryRun: true }) : ai.apply(args); break
      case 'ai.cancel': data = command.dryRun ? { dryRun: true } : ai.cancel(args); break
      default: data = core.execute(command)
    }
    if (command.command === 'settings.set' && !command.dryRun) {
      position(); if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: core.settings().autoStart })
    }
    if (mutationCommands.has(command.command) && !command.dryRun) {
      if (selectedGroupId) { try { core.execute({ command: 'get', args: { id: selectedGroupId } }) } catch { selectedGroupId = null } }
      publish()
    }
    if (externalWrite && command.requestId && !command.dryRun) core.recordRequest(command.requestId, signature, data)
    return { ok: true, data }
  } catch (error) { log(error); return failure(error) }
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => { if (!argv.includes('--service')) showUI() })
  app.on('window-all-closed', () => { /* background data service stays alive */ })
  app.on('before-quit', () => {
    if (quitting) return; quitting = true
    petBridge.close(); clearInterval(recovery); clearInterval(backupTimer); clearInterval(activityTimer); server?.close(); tray?.destroy(); agentActivity?.close(); core?.close()
  })
  void app.whenReady().then(async () => {
    if (!process.env.CALENDAR_DATA_DIR) await migrateCalendarData(directory, legacyDataDirectories(app.isPackaged))
    core = new CalendarCore(directory)
    try { agentActivity = new AgentActivityService(directory); agentActivity.sync() } catch (error) { log(error) }
    activityTimer = setInterval(() => {
      if (quitting || !agentActivity) return
      try { const changed = agentActivity.sync(); if (changed || agentActivity.hasLiveWork()) publish() } catch (error) { log(error); agentActivity.close(); agentActivity = null; publish() }
    }, 5000)
    maps = new MapService(directory, () => core.settings())
    protocol.handle('calendar-map', async request => {
      const url = new URL(request.url), match = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/)
      if (url.hostname !== 'tiles' || !match) return new Response(null, { status: 400 })
      try { return new Response(new Uint8Array(await maps.tile(Number(match[1]), Number(match[2]), Number(match[3]))), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' } }) }
      catch { return new Response(null, { status: 503 }) }
    })
    if (!process.env.CALENDAR_DATA_DIR && core.settings().timezone === 'Asia/Shanghai') core.execute({ command: 'settings.set', args: { timezone: 'Asia/Hong_Kong' } })
    selectedDate = DateTime.now().setZone(core.settings().timezone).toISODate()!; visibleMonth = selectedDate.slice(0, 7)
    ai = new AIService(core, () => { const file = path.join(directory, 'ai-key.bin'); return fs.existsSync(file) ? safeStorage.decryptString(fs.readFileSync(file)) : undefined })
    subscriptions = new SubscriptionService(core, value => {
      if (!safeStorage.isEncryptionAvailable()) throw new CalendarError('ENCRYPTION_UNAVAILABLE', 'Windows encryption unavailable')
      return safeStorage.encryptString(value).toString('base64')
    }, value => safeStorage.decryptString(Buffer.from(value, 'base64')))
    ipcMain.handle('calendar:execute', (event, command) => {
      if (!BrowserWindow.getAllWindows().some(w => w.webContents.id === event.sender.id)) return failure(new CalendarError('FORBIDDEN', 'Unknown sender'))
      return execute(command)
    })
    ipcMain.handle('calendar:pet', (event, raw) => {
      if (!mainWindow || mainWindow.webContents.id !== event.sender.id) return
      const input = z.discriminatedUnion('action', [
        z.object({ action: z.literal('host'), enabled: z.boolean() }).strict(),
        z.object({ action: z.literal('viewport'), width: z.number().int().min(16).max(1536), height: z.number().int().min(16).max(1080) }).strict(),
        z.object({ action: z.literal('focus'), key: z.string().max(500).nullable(), x: z.number().min(-1).max(1), y: z.number().min(-1).max(1), source: z.enum(['manual', 'auto']).optional() }).strict(),
        z.object({ action: z.literal('interact'), item: z.enum(['lamp', 'plant', 'notes']) }).strict(),
        z.object({ action: z.literal('click'), key: z.string().max(500).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional() }).strict()
      ]).parse(raw)
      if (input.action === 'host') { petRequested = input.enabled; updatePetHost() }
      else if (input.action === 'viewport') petBridge.resize(input)
        else petBridge.interact(input)
    })
    // Serialize writes, including AI completion and backup restore, in the service.
    let queue = Promise.resolve()
    let secureResolve!: () => void
    const secured = new Promise<void>(resolve => { secureResolve = resolve })
    server = net.createServer(socket => {
      let buffer = '', handled = false
      socket.setTimeout(40000, () => socket.destroy())
      socket.on('error', () => {})
      socket.on('data', chunk => {
        if (handled) return
        buffer += chunk.toString(); if (buffer.length > 1024 * 1024) return socket.destroy()
        const index = buffer.indexOf('\n'); if (index < 0) return; handled = true
        queue = queue.then(async () => {
          await secured
          let result: Result
          try { result = await execute(JSON.parse(buffer.slice(0, index))) } catch (error) { result = failure(error) }
          socket.end(JSON.stringify(result) + '\n')
        }).catch(log)
      })
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipeAddress(directory), () => resolve()) })
    if (process.platform === 'win32') await native('secure-pipe', pipeAddress(directory))
    secureResolve()
    core.automaticBackup(); backupTimer = setInterval(() => { try { core.automaticBackup() } catch (error) { log(error) } }, 3600000)
    recovery = setInterval(async () => { if (mainWindow && !diagnostic) { await desktop.check(mainWindow); publish() } }, 5000)
    powerMonitor.on('resume', async () => { if (mainWindow && !diagnostic) { await desktop.attach(mainWindow); publish() }; core.automaticBackup() })
    screen.on('display-added', position); screen.on('display-removed', position); screen.on('display-metrics-changed', position)
    if (!process.argv.includes('--service')) showUI()
  }).catch(error => { log(error); app.exit(1) })
}
