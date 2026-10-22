import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('month cards and overflow links fit four, five and six week grids', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-'))
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'calendar-e2e-'))) throw new Error('Unsafe cleanup path')
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agent-source'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.locator('.grid')).toBeVisible()
    for (const [date, cells] of [['2021-02-05', 28], ['2026-10-30', 35], ['2026-11-06', 42]] as const) {
      await page.evaluate(async date => {
        for (let index = 0; index < 8; index++) {
          const hour = String(9 + index).padStart(2, '0')
          await window.calendar.execute({ command: 'add', args: { title: `Course ${index + 1} with a long title`, start: `${date}T${hour}:00:00+08:00`, end: `${date}T${hour}:30:00+08:00` } })
        }
        await window.calendar.execute({ command: 'view', args: { date } })
      }, date)
      await expect(page.locator('.day')).toHaveCount(cells)
      const day = page.locator(`[data-date="${date}"]`)
      for (const [width, height, fontSize] of [[1920, 1032, 14], [1280, 800, 14], [900, 650, 22], [1920, 1032, 22], [1920, 1032, 14]]) {
        await electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
        await page.evaluate(fontSize => window.calendar.execute({ command: 'settings.set', args: { fontSize } }), fontSize)
        await expect.poll(() => day.evaluate(node => {
          const region = node.querySelector('.day-events')!.getBoundingClientRect()
          const more = node.querySelector<HTMLElement>('.day-events-more')!
          const link = more.getBoundingClientRect()
          const cards = Array.from(node.querySelectorAll<HTMLElement>('.event-chip')).filter(card => getComputedStyle(card).visibility === 'visible')
          const boundsFit = cards.every(card => {
            const bounds = card.getBoundingClientRect()
            return bounds.top >= region.top - 1 && bounds.bottom <= link.top - 1 && bounds.right <= region.right + 1
          })
          const count = Number(more.textContent!.match(/\d+/)![0])
          return boundsFit && cards.length + count === 8 && getComputedStyle(more).visibility === 'visible' && link.top >= region.top - 1 && link.bottom <= region.bottom + 1
        })).toBe(true)
      }
      await day.locator('.day-events-more').click()
      await expect(page.locator('.agenda-event')).toHaveCount(8)
      if (cells === 42) await page.screenshot({ path: 'test-results/november-layout.png' })
    }
    // A sparse day restores all cards without an unnecessary overflow link.
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'add', args: { title: 'Single course', start: '2026-11-05T19:00:00+08:00', end: '2026-11-05T20:00:00+08:00' } })
    })
    const sparse = page.locator('[data-date="2026-11-05"]')
    await expect(sparse.locator('.event-chip')).toBeVisible()
    await expect(sparse.locator('.day-events-more')).toBeHidden()
    await page.evaluate(() => window.calendar.execute({ command: 'add', args: { title: 'Evening course', start: '2026-11-05T20:00:00+08:00', end: '2026-11-05T21:00:00+08:00' } }))
    await expect(sparse.locator('.event-chip:visible')).toHaveCount(2)
    await expect(sparse.locator('.day-events-more')).toBeHidden()
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
