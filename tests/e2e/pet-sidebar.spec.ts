import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

for (const displayScale of [1, 1.5]) test(`sidebar hosts the same live actor at DPI ${displayScale}, preserves events and restores on disconnect`, async () => {
  const python = process.env.NAIWA_PYTHON || path.join(os.homedir(), 'miniconda3/envs/naiwa/python.exe')
  const source = path.resolve('../naiwa/src')
  test.skip(!fs.existsSync(python) || !fs.existsSync(source), 'Requires the adjacent Naiwa checkout and its Python environment')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-pet-'))
  const agents = path.join(directory, 'agents'); fs.mkdirSync(agents)
  const code = `
import json, sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QTimer
from naiwa.window import NaiwaWindow
from naiwa.calendar_bridge import CalendarBridge
from naiwa.demo import demo_machine
from naiwa.bus import atomic_json
app=QApplication([])
pet=NaiwaWindow(Path(sys.argv[1]), demo=True)
if not Path(sys.argv[1], 'restart.signal').exists(): pet.machine=demo_machine('partial_done')
pet._sync(); pet.show()
pet.calendar_bridge=CalendarBridge(pet)
pet._panel_jump=lambda key: Path(sys.argv[1], 'jump.json').write_text(json.dumps(key))
timer=QTimer(); timer.setInterval(100)
def tick():
    attention_signal = Path(sys.argv[1], 'attention.signal')
    if attention_signal.exists():
        item = attention_signal.read_text()
        pet._scene_director.current = replace(pet._scene_director.current, object='plant' if item == 'object' else None)
        pet._scene_director.next_target = 0
        pet._sync()
        attention_signal.unlink()
    workload_signal = Path(sys.argv[1], 'workload.signal')
    if workload_signal.exists():
        phases = json.loads(workload_signal.read_text())
        for key, turn in pet.machine.turns.items():
            turn.phase = phases.get(key, 'done')
            turn.ts = datetime.now(timezone.utc).isoformat()
            turn.tools.clear()
        pet._sync()
        workload_signal.unlink()
    signal = Path(sys.argv[1], 'finish.signal')
    if signal.exists():
        key = signal.read_text()
        if key in pet.machine.turns:
            pet.machine.turns[key].phase = 'done'
            pet.machine.turns[key].ts = datetime.now(timezone.utc).isoformat()
            pet._sync()
        signal.unlink()
    atomic_json(Path(sys.argv[1], 'host.json'), {'hosted':pet._calendar_hosted,'visible':pet.isVisible(), 'focus':pet._calendar_focus_key, 'source':pet._calendar_attention_source, 'gaze':pet._calendar_gaze, 'effectiveGaze':pet._look_direction, 'scene':pet._scene_director.metadata(), 'pose':pet._display_args[0], 'variant':pet._display_args[1], 'workload':pet._workload.__dict__})
timer.timeout.connect(tick)
timer.start()
app.exec()
`
  let pet = spawn(python, ['-c', code, agents], { env: { ...process.env, PYTHONPATH: source, QT_QPA_PLATFORM: 'offscreen' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let errors = ''; pet.stderr.on('data', chunk => { errors += chunk.toString() })
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: agents, CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd(), `--force-device-scale-factor=${displayScale}`], env })
  try {
    const page = await electron.firstWindow()
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    await expect(page.getByRole('tab', { name: '日程', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.evaluate(() => window.calendar.execute({ command: 'add', args: { title: '保留的日程', start: '2026-11-06T10:00:00+08:00', end: '2026-11-06T11:00:00+08:00' } }))
    await page.evaluate(() => window.calendar.execute({ command: 'view', args: { date: '2026-11-06' } }))
    await expect(page.locator('.agenda-event h3')).toHaveText('保留的日程')
    await page.getByRole('tab', { name: '奶蛙', exact: true }).click()
    await expect(page.locator('.pet-connection')).toHaveAttribute('data-connected', 'true', { timeout: 15000 })
    await expect(page.locator('.pet-session-list>.pet-session')).toHaveCount(6)
    await expect(page.locator('.pet-filters')).toHaveCount(0)
    for (const name of ['全部', 'Cursor', 'Codex']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    expect(await page.locator('.pet-stage').evaluate(node => Number(getComputedStyle(node.querySelector('canvas')!).zIndex) < Number(getComputedStyle(node.querySelector('.pet-desk')!).zIndex))).toBe(true)
    await expect(page.locator('.pet-session[data-finished="true"]')).toHaveCount(1)
    const keys = await page.locator('.pet-session').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-key')))
    const completing = await page.locator('.pet-session[data-running="true"]').first().getAttribute('data-key')
    fs.writeFileSync(path.join(agents, 'finish.signal'), completing!)
    await expect(page.locator('.pet-session[data-finished="true"]')).toHaveCount(2)
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-workload', 'busy')
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-running-count', '4')
    expect(await page.locator('.pet-session').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-key')))).toEqual(keys)
    await expect.poll(() => fs.existsSync(path.join(agents, 'host.json')) && JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).hosted).toBe(true)
    // Different pixels are presented while the same actor is hosted in the canvas.
    await expect.poll(() => page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data.some((v, i) => i % 4 === 3 && v > 0))).toBe(true)
    const first = await page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => node.toDataURL())
    await expect.poll(() => page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => {
      const bounds = node.getBoundingClientRect()
      return Math.abs(node.width-Math.round(bounds.width*devicePixelRatio)) <= 1 && Math.abs(node.height-Math.round(bounds.height*devicePixelRatio)) <= 1
    })).toBe(true)
    await expect.poll(() => page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(first)
    // Watching either side changes the real actor, without activating a client
    // or moving any persisted screen slot.
    for (const side of ['left', 'right']) {
      const screen = page.locator(`.pet-session[data-running="true"][data-screen-side="${side}"][data-pose="tool"]`).first()
      const key = await screen.getAttribute('data-key')
      await screen.hover()
      await expect(screen).toHaveAttribute('data-focused', 'true')
      await expect.poll(() => {
        const state = JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8'))
        return state.focus === key && state.workload.running === 4 && (side === 'left' ? state.gaze[0] < 0 : state.gaze[0] > 0)
      }).toBe(true)
    }
    expect(fs.existsSync(path.join(agents, 'jump.json'))).toBe(false)
    // Reproduce an automatic scene/target change during a pointer handoff.
    const manualScreen = page.locator('.pet-session[data-running="true"][data-screen-side="left"]').first()
    const manualKey = await manualScreen.getAttribute('data-key')
    await manualScreen.hover()
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).source).toBe('manual')
    const manualColor = await manualScreen.locator('.pet-session-jump').evaluate(node => getComputedStyle(node).backgroundColor)
    fs.writeFileSync(path.join(agents, 'attention.signal'), 'object')
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).scene.object).toBe('plant')
    await expect(manualScreen).toHaveAttribute('data-focused', 'true')
    await expect(page.locator('.pet-session[data-focused="true"]')).toHaveCount(1)
    expect(await manualScreen.locator('.pet-session-jump').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(manualColor)
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).effectiveGaze[0]).toBeLessThan(0)
    // A small gap keeps the manual target; entering a second screen cancels
    // the old release callback instead of letting it steal attention later.
    await page.locator('.pet-toolbar').hover()
    await page.waitForTimeout(150)
    await expect(manualScreen).toHaveAttribute('data-focused', 'true')
    const nextManual = page.locator('.pet-session[data-running="true"][data-screen-side="right"]').first()
    const nextKey = await nextManual.getAttribute('data-key')
    await nextManual.hover()
    await page.waitForTimeout(750)
    await expect(nextManual).toHaveAttribute('data-focused', 'true')
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).focus).toBe(nextKey)
    expect(nextKey).not.toBe(manualKey)
    await page.mouse.move(700, 60)
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).source).toBe('auto')
    fs.writeFileSync(path.join(agents, 'attention.signal'), 'resume')
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).scene.object).toBeNull()
    await expect.poll(async () => {
      const state = JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8'))
      return state.source === 'auto' && state.focus === state.scene.target
    }).toBe(true)
    // Measure actual browser paints and input latency, beyond sender FPS.
    if (displayScale === 1) {
      await page.evaluate(() => {
        const state = { paints: [] as number[], input: [] as number[], tasks: [] as number[] }
        Object.assign(window, { petHoverMetrics: state })
        const draw = CanvasRenderingContext2D.prototype.drawImage
        CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
          if (this.canvas === document.querySelector('.pet-stage canvas')) state.paints.push(performance.now())
          return draw.apply(this, args)
        } as typeof draw
        document.querySelector('.pet-pane')!.addEventListener('pointermove', event => {
          state.input.push(Math.max(0, performance.now()-event.timeStamp))
        })
        new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: false })
      })
      const bounds = await page.locator('.pet-session').first().boundingBox()
      const opposite = await page.locator('.pet-session').nth(1).boundingBox()
      for (let i = 0; i < 30; i++) {
        const target = i%2 ? bounds! : opposite!
        await page.mouse.move(target.x+target.width/2, target.y+target.height/2, { steps: 3 })
      }
      const metrics = await page.evaluate(() => {
        const values = (window as unknown as { petHoverMetrics: { paints: number[]; input: number[]; tasks: number[] } }).petHoverMetrics
        const gaps = values.paints.slice(1).map((time, index) => time-values.paints[index]).sort((a, b) => a-b)
        const input = values.input.sort((a, b) => a-b)
        return { frames: values.paints.length, fps: (values.paints.length-1)*1000/(values.paints.at(-1)!-values.paints[0]), gapP95: gaps[Math.floor(gaps.length*.95)], inputP95: input[Math.floor(input.length*.95)], longTasks: values.tasks }
      })
      fs.writeFileSync(`test-results/pet-hover-${displayScale}.json`, JSON.stringify(metrics, null, 2))
    }
    expect(await page.locator('.pet-session').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-key')))).toEqual(keys)
    await expect(page.locator('.pet-session-list>.pet-session')).toHaveCount(6)
    await page.locator('.pet-session-list>.pet-session .pet-session-jump').first().click()
    await expect.poll(() => fs.existsSync(path.join(agents, 'jump.json'))).toBe(true)
    expect(fs.readFileSync(path.join(agents, 'jump.json'), 'utf8')).toContain('cursor')
    await page.getByRole('button', { name: '详情', exact: true }).first().click()
    await expect(page.locator('.pet-session-actions').first()).toBeVisible()
    // Hovering completed work affects gaze only, never workload.
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-running-count', '4')
    await page.locator('.pet-session[data-finished="true"]').first().hover()
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8')).workload).toMatchObject({ mode: 'busy', running: 4, pose: 'tool' })
    // World objects change the actor's activity, never launch an IDE or edit sessions.
    const jumpBeforeProps = fs.readFileSync(path.join(agents, 'jump.json'), 'utf8')
    await page.getByRole('button', { name: '翻开笔记', exact: true }).click()
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-action', 'note')
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-running-count', '4')
    await page.getByRole('button', { name: '开关台灯', exact: true }).click()
    await expect(page.getByRole('button', { name: '开关台灯', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-action', 'look')
    await page.getByRole('button', { name: '看看小植物', exact: true }).click()
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-action', 'tend')
    expect(fs.readFileSync(path.join(agents, 'jump.json'), 'utf8')).toBe(jumpBeforeProps)
    const canvasGeometry = await page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => ({ width: node.width, height: node.height, styleWidth: node.style.width, styleHeight: node.style.height }))
    for (const [count, mode] of [[3, 'parallel'], [1, 'focused'], [0, 'rest']] as const) {
      fs.writeFileSync(path.join(agents, 'workload.signal'), JSON.stringify(Object.fromEntries(keys.slice(0, count).map(key => [key, 'working']))))
      await expect(page.locator('.pet-stage')).toHaveAttribute('data-workload', mode)
      await expect(page.locator('.pet-stage')).toHaveAttribute('data-running-count', String(count))
      expect(await page.locator('.pet-session').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-key')))).toEqual(keys)
      expect(await page.locator('.pet-stage canvas').evaluate((node: HTMLCanvasElement) => ({ width: node.width, height: node.height, styleWidth: node.style.width, styleHeight: node.style.height }))).toEqual(canvasGeometry)
    }
    fs.writeFileSync(path.join(agents, 'workload.signal'), JSON.stringify({ [keys[0]!]: 'needs_you' }))
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-workload', 'waiting')
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-running-count', '0')
    fs.writeFileSync(path.join(agents, 'workload.signal'), JSON.stringify(Object.fromEntries(keys.slice(0, 4).map(key => [key, 'working']))))
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-workload', 'busy')
    await expect(page.locator('.pet-session[data-running="true"]')).toHaveCount(4)
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-pose', 'tool')
    // Let the authored rise/keyboard transition finish before visual QA.
    await page.waitForTimeout(1100)
    await page.screenshot({ path: `test-results/pet-sidebar-${displayScale}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    await page.getByRole('tab', { name: '日程', exact: true }).click()
    await expect(page.locator('.agenda-event h3')).toHaveText('保留的日程')
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agents, 'host.json'), 'utf8'))).toMatchObject({ hosted: false, visible: true, focus: null, gaze: [0, 0] })
    await page.getByRole('tab', { name: '奶蛙', exact: true }).click()
    await expect(page.locator('.pet-connection')).toHaveAttribute('data-connected', 'true')
    // Selecting a date opens its events without losing the manual switch.
    await page.locator('.day[data-date="2026-11-07"]').click()
    await expect(page.getByRole('tab', { name: '日程', exact: true })).toHaveAttribute('aria-selected', 'true')
    const result = await page.evaluate(() => window.calendar.execute({ command: 'list', args: { date: '2026-11-06' } }))
    expect(result.ok && result.data.events[0].title).toBe('保留的日程')
    // Disconnect preserves screens but marks the whole workspace offline.
    await page.getByRole('tab', { name: '奶蛙', exact: true }).click()
    await expect(page.locator('.pet-connection')).toHaveAttribute('data-connected', 'true')
    pet.kill()
    await expect(page.locator('.pet-connection')).toHaveAttribute('data-connected', 'false')
    await expect(page.locator('.pet-session-list>.pet-session')).toHaveCount(6)
    await expect(page.locator('.pet-session-jump:not(:disabled)')).toHaveCount(0)
    fs.writeFileSync(path.join(agents, 'restart.signal'), '1')
    pet = spawn(python, ['-c', code, agents], { env: { ...process.env, PYTHONPATH: source, QT_QPA_PLATFORM: 'offscreen' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    pet.stderr.on('data', chunk => { errors += chunk.toString() })
    await expect(page.locator('.pet-connection')).toHaveAttribute('data-connected', 'true', { timeout: 15000 })
    await expect(page.locator('.pet-session-list>.pet-session')).toHaveCount(6)
    expect(await page.locator('.pet-session').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-key')))).toEqual(keys)
    await expect(page.locator('.pet-session-count')).toContainText('0 进行中')
    await expect(page.locator('.pet-stage')).toHaveAttribute('data-pose', 'rest')
    await expect.poll(() => page.locator('.pet-stage canvas').evaluate(node => Number((node as HTMLElement).style.transform.match(/translateY\(([\d.]+)px\)/)?.[1] || 0))).toBeGreaterThan(50)
    await page.screenshot({ path: `test-results/pet-rest-${displayScale}.png` })
    expect(errors).not.toContain('Traceback')
  } finally {
    await electron.close(); pet.kill()
  }
})

