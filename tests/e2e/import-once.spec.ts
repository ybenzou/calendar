import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('school events stay local on restart; no startup request or network banner', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!directory.startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  let electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    await electron.evaluate(() => {
      ;(globalThis as any).__calendarRequests = 0
      globalThis.fetch = async () => { (globalThis as any).__calendarRequests++; return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:school-course\r\nDTSTART:20261014T070000Z\r\nDTEND:20261014T080000Z\r\nSUMMARY:One-time school course\r\nEND:VEVENT\r\nEND:VCALENDAR') }
    })
    const first = await electron.firstWindow()
    await expect(first.locator('.grid')).toBeVisible()
    const imported = await first.evaluate(() => window.calendar.execute({ command: 'subscriptions.add', args: { name: 'Synthetic school', url: 'https://example.test/calendar' } }))
    expect(imported.ok).toBe(true)
    expect(await electron.evaluate(() => (globalThis as any).__calendarRequests)).toBe(1)
    await electron.close(); electron = await _electron.launch({ args: [process.cwd()], env })
    await electron.evaluate(() => { (globalThis as any).__calendarRequests = 0; globalThis.fetch = async () => { (globalThis as any).__calendarRequests++; throw new Error('No network expected') } })
    const page = await electron.firstWindow()
    await expect(page.locator('.grid')).toBeVisible()
    await page.evaluate(() => window.calendar.execute({ command: 'view', args: { date: '2026-10-14' } }))
    await expect(page.locator('.agenda-event h3')).toHaveText('One-time school course')
    await page.waitForTimeout(1500) // Covers the former delayed startup request.
    expect(await electron.evaluate(() => (globalThis as any).__calendarRequests)).toBe(0)
    await expect(page.locator('.notice')).not.toContainText('订阅网络请求失败')
  } finally { await electron.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
