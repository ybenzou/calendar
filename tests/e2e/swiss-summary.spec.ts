import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('compact work bars leave room for appointments and groups expose actual start/end', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-swiss-'))
  const source = path.join(directory, 'agents'); fs.mkdirSync(source)
  let seq = 0
  const records: Record<string, unknown>[] = []
  for (const [index, minutes] of [78, 54, 9, 4, 0].entries()) {
    const base = { schema_version: 3, source: 'codex', session_id: `desktop:synthetic-${index}`, turn_id: 'turn', origin: 'desktop', workspace_name: `Project ${index + 1}` }
    const ts = `2026-10-15T00:00:00Z`
    records.push({ ...base, seq: ++seq, event: 'turn_start', ts })
    records.push({ ...base, seq: ++seq, event: 'tool_start', tool_call_id: `tool-${index}`, ts })
    records.push({ ...base, seq: ++seq, event: 'turn_done', ts: new Date(Date.parse(ts) + minutes * 60_000).toISOString() })
  }
  fs.writeFileSync(path.join(source, 'events.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: source, CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'batch.add', args: { title: 'Design workshop', timezone: 'Asia/Hong_Kong', events: [
        { title: 'Preparation', start: '2026-10-15T08:00:00+08:00', end: '2026-10-15T09:00:00+08:00' },
        { title: 'Workshop', start: '2026-10-15T09:30:00+08:00', end: '2026-10-15T18:00:00+08:00' },
        { title: 'Next day review', start: '2026-10-16T10:00:00+08:00', end: '2026-10-16T12:00:00+08:00' }
      ] } })
      await window.calendar.execute({ command: 'add', args: { title: 'Evening lecture', start: '2026-10-15T19:00:00+08:00', end: '2026-10-15T20:50:00+08:00' } })
      await window.calendar.execute({ command: 'view', args: { date: '2026-10-15' } })
    })
    const activity = page.getByLabel('当日 Agent 活动', { exact: true })
    await expect(page.locator('.month-span .span-time')).toHaveText('10.15 08:00 — 10.16 12:00')
    await expect(page.locator('.month-span')).toHaveCount(1)
    await expect(page.locator('.agenda-event').first().locator('.event-time')).toContainText('08:00–18:00')
    await expect(page.locator('.agent-project')).toHaveCount(4)
    const bars = await page.locator('.agent-project-track i').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.width))
    expect(parseFloat(bars[0])).toBeCloseTo(100)
    expect(parseFloat(bars[1])).toBeCloseTo(54 / 78 * 100)
    await expect(page.locator('.agent-totals').getByLabel('工具调用：5', { exact: true })).toBeVisible()
    for (const fontSize of [14, 22]) {
      await page.evaluate(fontSize => window.calendar.execute({ command: 'settings.set', args: { fontSize } }), fontSize)
      await expect(page.locator('.app')).toHaveCSS('font-size', `${fontSize}px`)
      expect((await activity.boundingBox())!.height).toBeLessThan(fontSize === 14 ? 210 : 280)
      const lastBar = await page.locator('.agent-totals').boundingBox(), appointment = await page.locator('.agenda-event').first().boundingBox()
      expect(appointment!.y).toBeGreaterThanOrEqual(lastBar!.y + lastBar!.height)
      expect(await activity.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      if (fontSize === 14) await page.screenshot({ path: 'test-results/swiss-compact-calendar.png' })
    }
    await page.getByRole('button', { name: '另 1 个项目' }).click()
    await expect(page.locator('.agent-project')).toHaveCount(5)
    await expect(page.locator('.agent-project').last().locator('.agent-project-track')).toHaveClass(/unknown/)
    await expect(page.locator('.agent-project').last().locator('.agent-project-track i')).toHaveCount(0)
    await expect(page.locator('.agent-project').last().locator('.agent-project-time')).toHaveText('—')
    await page.getByRole('button', { name: '收起', exact: true }).click()
    await page.screenshot({ path: 'test-results/swiss-compact-large.png' })
    await expect(page.locator('.month-span.group-chip')).toBeVisible({ timeout: 1000 })
    await page.locator('.month-span.group-chip').click({ position: { x: 20, y: 10 } })
    await expect(page.locator('.group-time-range')).toHaveText('10.15 08:00 — 10.16 12:00')
    await expect(page.locator('.timeline-day')).toHaveCount(2)
    await page.getByRole('button', { name: '返回当天', exact: false }).click()
    await expect(page.locator('.agenda-event')).toHaveCount(2)
    // A six-row month must keep the group's time visible, even at the largest font.
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'batch.add', args: { title: 'November workshop', timezone: 'Asia/Hong_Kong', events: [{ title: 'Session', start: '2026-11-06T10:40:00+08:00', end: '2026-11-06T19:40:00+08:00' }] } })
      await window.calendar.execute({ command: 'view', args: { date: '2026-11-06' } })
    })
    const clock = page.locator('[data-date="2026-11-06"] .group-chip .event-clock')
    for (const [width, height] of [[1920, 1032], [1280, 800], [900, 650]]) {
      await electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
      await expect(clock).toBeVisible()
      await expect(clock).toHaveText('10:40–19:40')
      expect(await clock.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    }
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
