import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

test('UI and CLI share data, editor input works, restart preserves events', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup path')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)), CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['out/cli/index.cjs', ...args, '--json'], { cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true }))
  let electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(cli('view', '--date', '2026-10-14').ok).toBe(true)
    const added = cli('add', '--title', 'CLI 论文讨论', '--start', '2026-10-14T15:00:00+08:00', '--end', '2026-10-14T16:00:00+08:00', '--request-id', 'e2e-cli')
    expect(added.ok).toBe(true)
    await expect(page.locator('.agenda-event h3')).toHaveText('CLI 论文讨论')
    await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0)
    await expect(page.getByText('CALENDAR / LOCAL FIRST', { exact: true })).toHaveCount(0)
    const commandBar = page.getByLabel('日历命令', { exact: true })
    await commandBar.fill('calendar list --date 2026-10-14')
    await commandBar.press('Enter')
    await expect(page.locator('.command-result')).toContainText('查询到 1 条日程')
    await page.keyboard.press('Escape'); await expect(page.locator('.command-result')).toHaveCount(0)
    await commandBar.fill('/外观'); await commandBar.press('Enter')
    await page.getByLabel('主题', { exact: true }).selectOption('warm')
    expect(cli('settings', 'get').data.settings.theme).toBe('warm')
    await page.getByLabel('主题', { exact: true }).selectOption('swiss')
    await commandBar.fill('/外观'); await commandBar.press('Enter')
    const newWindow = electron.waitForEvent('window')
    await page.getByRole('button', { name: '＋ 新建日程' }).click()
    const editor = await newWindow
    await editor.getByLabel('标题', { exact: true }).fill('界面新增日程')
    await editor.getByRole('button', { name: '保存日程' }).click()
    await expect(page.locator('.agenda-event h3')).toHaveCount(2)
    expect(cli('list', '--date', '2026-10-14').data.events).toHaveLength(2)
    await page.screenshot({ path: 'test-results/calendar.png', fullPage: true })
    expect(cli('move', '--id', added.data.eventId, '--date', '2026-10-15').ok).toBe(true)
    await expect(page.locator('.agenda-event h3')).toHaveText('界面新增日程')
    await electron.close()
    electron = await _electron.launch({ args: [process.cwd()], env })
    const restarted = await electron.firstWindow()
    await expect(restarted.getByRole('heading', { level: 1 })).toBeVisible()
    cli('view', '--date', '2026-10-15')
    await expect(restarted.locator('.agenda-event h3')).toHaveText('CLI 论文讨论')
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('itinerary tree and OSM map share selection; planned routes save locally', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup path')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    // Fake providers in an isolated process: no network requests or personal events.
    await electron.evaluate((_electron, liveTiles) => {
      const original = globalThis.fetch
      globalThis.fetch = async (url: any, options?: any) => String(url).includes('tile.') ? liveTiles ? original(url, options) : new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=', 'base64'), { headers: { 'content-type': 'image/png' } }) : new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 300, duration: 240, geometry: { coordinates: [[114.13, 22.28], [114.131, 22.281]] } }] }))
    }, process.env.CALENDAR_MAP_LIVE_TILES === '1')
    const page = await electron.firstWindow(), input = page.getByLabel('日历命令', { exact: true })
    await expect(input).toBeVisible()
    await input.fill('batch add ' + JSON.stringify({ title: '地图合成行程', events: [{ title: '合成地点一', start: '2026-10-17T10:00:00+08:00', location: { name: '合成起点', latitude: 22.28, longitude: 114.13 } }, { title: '合成地点二', start: '2026-10-17T11:00:00+08:00', location: { name: '合成终点', latitude: 22.281, longitude: 114.131 } }] }))
    await input.press('Enter'); await expect(page.locator('.group-title')).toHaveText('地图合成行程')
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('行程地图')).toBeVisible()
    await expect(page.locator('.route-marker')).toHaveCount(2)
    await page.locator('.timeline-place').last().click()
    await expect(page.locator('.route-selected')).toContainText('合成地点二')
    const editorPromise = electron.waitForEvent('window')
    await page.locator('.route-selected').getByRole('button', { name: '编辑', exact: true }).click()
    const editor = await editorPromise
    await editor.getByText('地点与地图', { exact: false }).click()
    await editor.getByRole('button', { name: '从上一地点规划路线' }).click()
    await expect(editor.locator('.route-planner')).toContainText('0.30 km')
    await editor.getByRole('button', { name: '保存日程' }).click()
    await expect(page.locator('.route-selected')).toContainText('0.30 km')
    await expect(page.locator('.route-selected')).toContainText('约 4 分钟')
    await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(1)
    const saved = await page.evaluate(async () => (await window.calendar.execute({ command: 'list', args: { date: '2026-10-17' } })))
    expect(saved.ok && saved.data.events[0].items[1].route.source).toBe('osrm')
    const titleY = (await page.locator('.agenda-header').boundingBox())!.y
    await page.locator('.route-marker').first().click()
    await expect(page.locator('.route-selected')).toContainText('合成地点一')
    await expect(page.locator('.route-planner')).toHaveCount(0)
    expect((await page.locator('.agenda-header').boundingBox())!.y).toBe(titleY)
    if (process.env.CALENDAR_MAP_LIVE_TILES === '1') await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: 'test-results/itinerary-map.png', fullPage: true })
  } finally { await electron.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('command bar creates one grouped batch and sidebar expands a date tree', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup path')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  // Synthetic six-item fixture: no writes to the user's real calendar.
  const args = { title: '测试活动组', key: 'e2e-group', events: Array.from({ length: 6 }, (_, index) => ({ title: `测试步骤 ${index + 1}`, start: `2026-10-${index === 0 ? '13' : '14'}T${String(9 + index).padStart(2, '0')}:00:00+08:00`, ...(index === 5 ? {} : { end: `2026-10-${index === 0 ? '13' : '14'}T${String(10 + index).padStart(2, '0')}:00:00+08:00` }) })) }
  try {
    const page = await electron.firstWindow(), input = page.getByLabel('日历命令', { exact: true })
    await expect(input).toBeVisible()
    const text = `batch add ${JSON.stringify(args)}`
    await input.fill(text); await input.press('Enter')
    await expect(page.locator('.command-result')).toContainText('活动组已保存')
    await expect(page.locator('.group-title')).toHaveText('测试活动组')
    await expect(page.locator('.group-timeline li')).toHaveCount(6)
    await expect(page.locator('.timeline-day')).toHaveCount(2)
    await expect(page.locator('.month-span.group-chip[data-start="2026-10-13"][data-end="2026-10-14"]')).toHaveCount(1)
    await page.keyboard.press('Escape'); await expect(page.locator('.command-result')).toHaveCount(0)
    await page.locator('.group-back').click()
    await page.locator('.month-span.group-chip[data-start="2026-10-13"]').click()
    await expect(page.locator('.group-title')).toHaveText('测试活动组')
    await expect(page.locator('.group-timeline li')).toHaveCount(6)
    const editorPromise = electron.waitForEvent('window')
    await page.locator('.group-timeline li').first().getByRole('button', { name: '编辑', exact: true }).click()
    const editor = await editorPromise
    await editor.getByLabel('标题', { exact: true }).fill('测试步骤更新')
    await editor.getByRole('button', { name: '保存日程' }).click()
    await expect(page.locator('.group-timeline h3').first()).toHaveText('测试步骤更新')
    await input.fill(text); await input.press('Enter')
    await expect(page.locator('.command-result')).toContainText('活动组已存在')
    await expect(page.locator('.month-span.group-chip[data-start="2026-10-13"][data-end="2026-10-14"]')).toHaveCount(1)
    await expect(page.locator('.command-result')).toHaveCount(0, { timeout: 7000 })
    await input.fill('list --date 2026-10-14'); await input.press('Enter')
    await expect(page.locator('.command-result')).toBeVisible()
    await page.getByRole('heading', { level: 1 }).click()
    await expect(page.locator('.command-result')).toHaveCount(0)
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    const titleFont = () => page.locator('.timeline-day li h3').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))
    const initialFont = await titleFont()
    await page.evaluate(() => window.calendar.execute({ command: 'settings.set', args: { fontSize: 22 } }))
    await expect.poll(titleFont).toBeGreaterThan(initialFont * 1.5)
    const header = page.locator('.agenda-header'), list = page.locator('.agenda-list')
    const headerTop = (await header.boundingBox())!.y
    await list.evaluate(node => { node.scrollTop = node.scrollHeight })
    expect((await header.boundingBox())!.y).toBe(headerTop)
    expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    expect(await page.locator('.agenda').evaluate(node => getComputedStyle(node).overflowY)).toBe('hidden')
    await page.screenshot({ path: 'test-results/grouped-reading-pane.png', fullPage: true })
    await page.evaluate(() => window.calendar.execute({ command: 'settings.set', args: { fontSize: 14 } }))
    await page.screenshot({ path: 'test-results/grouped-batch.png', fullPage: true })
  } finally { await electron.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
