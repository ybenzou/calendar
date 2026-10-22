import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('Quiet activity markers preserve clean cells, metrics and events on restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup')
  const source = path.join(directory, 'agents'); fs.mkdirSync(source)
  let seq = 0
  const rows: Record<string, unknown>[] = []
  for (const [day, calls, minutes] of [[9, 6, 5], [10, 18, 30], [11, 65, 120], [12, 215, 300]]) {
    const start = `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`
    rows.push({ schema_version: 3, seq: ++seq, source: 'codex', session_id: 'desktop:synthetic', turn_id: `turn-${day}`, event: 'turn_start', ts: start, origin: 'desktop', workspace_name: '合成项目 · Calendar' })
    for (let index = 0; index < calls; index++) rows.push({ schema_version: 3, seq: ++seq, source: index % 3 ? 'codex' : 'cursor', session_id: index % 3 ? 'desktop:synthetic' : 'synthetic-cursor', turn_id: `turn-${day}`, tool_call_id: `tool-${day}-${index}`, event: 'tool_start', ts: `2026-10-${String(day).padStart(2, '0')}T08:01:00Z`, origin: 'desktop', workspace_name: index % 3 ? '合成项目 · Calendar' : '合成项目 · Research' })
    rows.push({ schema_version: 3, seq: ++seq, source: 'codex', session_id: 'desktop:synthetic', turn_id: `turn-${day}`, event: 'turn_done', ts: new Date(Date.parse(start) + minutes * 60_000).toISOString(), origin: 'desktop', workspace_name: '合成项目 · Calendar' })
  }
  fs.writeFileSync(path.join(source, 'events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: source, CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  let electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.locator('.grid')).toBeVisible()
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'view', args: { date: '2026-10-12' } })
      await window.calendar.execute({ command: 'add', args: { title: '原有日程仍然清晰', start: '2026-10-12T19:00:00+08:00', end: '2026-10-12T20:00:00+08:00' } })
    })
    const grid = page.locator('.grid'), day = page.locator('[data-date="2026-10-12"]')
    const geometry = await grid.boundingBox()
    await expect(page.locator('.day')).toHaveCount(35)
    for (const [date, level] of [[9, 1], [10, 2], [11, 3], [12, 4]]) await expect(page.locator(`[data-date="2026-10-${String(date).padStart(2, '0')}"]`)).toHaveAttribute('data-heat', String(level))
    await expect(day.locator('.event-chip')).toBeVisible()
    await expect(day.locator('.day-activity-indicator')).toBeVisible()
    await expect(day.locator('.day-activity-indicator')).toHaveAttribute('aria-label', /^Agent 工作时长：5 小时/)
    await expect(page.locator('.day-activity-count')).toHaveCount(0)
    await expect(page.locator('[data-date="2026-10-08"] .day-activity-indicator')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Agent 活跃度', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('活跃度指标', { exact: true })).toHaveCount(0)
    await day.locator('.day-number').click()
    await expect(page.getByLabel('当日 Agent 活动')).toContainText('215')
    await expect(page.locator('.agent-work-total')).toHaveAttribute('aria-label', /^累计工作时长：5 小时/)
    await expect(page.locator('.agent-project-track:not(.unknown)')).not.toHaveCount(0)
    expect(await page.locator('.agent-project').evaluateAll(nodes => nodes.map(node => node.getAttribute('title')).join(' '))).toMatch(/Codex App.*Cursor|Cursor.*Codex App/)
    await expect(page.locator('.agenda-event h3')).toHaveText('原有日程仍然清晰')
    const colors: string[] = []
    for (const date of [9, 10, 11, 12]) {
      const cell = page.locator(`[data-date="2026-10-${String(date).padStart(2, '0')}"]`)
      expect(await cell.evaluate(node => getComputedStyle(node, '::before').backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      const marker = cell.locator('.day-activity-indicator'), bounds = await marker.boundingBox(), header = await cell.locator('.day-number').boundingBox()
      expect(bounds!.width).toBe(8); expect(bounds!.height).toBe(8)
      expect(bounds!.y).toBeGreaterThanOrEqual(header!.y)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(header!.y + header!.height)
      const color = await marker.evaluate(node => getComputedStyle(node).backgroundColor)
      colors.push(color)
      await expect(page.locator(`.agent-heat-legend i[data-heat="${date - 8}"]`)).toHaveCSS('background-color', color)
    }
    expect(new Set(colors).size).toBe(4)
    await page.screenshot({ path: 'test-results/agent-calendar-markers.png' })
    await page.reload(); await expect(page.locator('.app')).toHaveClass(/heat-enabled/)
    expect(await grid.boundingBox()).toEqual(geometry)
    await page.locator('[data-date="2026-10-08"] .day-number').click()
    await expect(page.getByLabel('当日 Agent 活动')).toContainText('没有采集数据')
    // A fresh hook updates totals without restarting either application.
    fs.appendFileSync(path.join(source, 'events.jsonl'), JSON.stringify({ ...rows.find(row => row.event === 'tool_start'), seq: ++seq, turn_id: 'new-turn', tool_call_id: 'fresh-call', ts: '2026-10-12T10:00:00Z' }) + '\n')
    await day.locator('.day-number').click()
    await expect(page.getByLabel('当日 Agent 活动')).toContainText('216')
    await electron.close(); electron = await _electron.launch({ args: [process.cwd()], env })
    const restarted = await electron.firstWindow()
    await expect(restarted.locator('.grid')).toBeVisible()
    await restarted.evaluate(() => window.calendar.execute({ command: 'view', args: { date: '2026-10-12' } }))
    await expect(restarted.locator('.agent-work-total')).toHaveAttribute('aria-label', /^累计工作时长：5 小时/)
    await expect(restarted.locator('.agenda-event h3')).toHaveText('原有日程仍然清晰')
    await expect(restarted.getByLabel('当日 Agent 活动')).toContainText('216')
  } finally { await electron.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
