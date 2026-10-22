import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('a 10:00 course precedes a 17:00 activity group in the month and agenda', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-order-'))
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.locator('.grid')).toBeVisible()
    await page.evaluate(async () => {
      const meeting = await window.calendar.execute({ command: 'batch.add', args: { title: 'Progress Meeting', events: [{ title: 'Meeting with Mike', start: '2026-10-23T17:00:00+08:00' }] } })
      const course = await window.calendar.execute({ command: 'add', args: { title: 'RECO6022 lecture', start: '2026-10-23T10:00:00+08:00', end: '2026-10-23T12:20:00+08:00' } })
      if (!meeting.ok || !course.ok) throw new Error('Failed to create ordering fixtures')
      await window.calendar.execute({ command: 'view', args: { date: '2026-10-23' } })
    })
    await page.getByRole('tab', { name: '日程', exact: true }).click()
    const day = page.locator('[data-date="2026-10-23"]')
    await expect(day.locator('.event-title')).toHaveText(['RECO6022 lecture', 'Progress Meeting'])
    await expect(day.locator('.event-clock')).toHaveText(['10:00', '17:00'])
    await expect(page.locator('.agenda-event h3')).toHaveCount(2)
    await expect(page.locator('.agenda-event h3').nth(0)).toHaveText('RECO6022 lecture')
    await expect(page.locator('.agenda-event h3').nth(1)).toContainText('Progress Meeting')
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
