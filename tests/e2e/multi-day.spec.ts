import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('multi-day strips cross cells, continue across weeks, stack and open the original itinerary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-spans-'))
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agents'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.locator('.grid')).toBeVisible()
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'batch.add', args: { title: 'HKU Innovation', timezone: 'Asia/Hong_Kong', events: [
        { title: 'Opening', start: '2026-10-13T09:00:00+08:00', end: '2026-10-13T18:00:00+08:00' },
        { title: 'Closing', start: '2026-10-14T10:00:00+08:00', end: '2026-10-14T17:00:00+08:00' }
      ] } })
      await window.calendar.execute({ command: 'add', args: { title: 'Evening lecture', start: '2026-10-13T19:00:00+08:00', end: '2026-10-13T20:00:00+08:00' } })
      await window.calendar.execute({ command: 'add', args: { title: 'Overlapping event', start: '2026-10-13', end: '2026-10-16', allDay: true } })
      await window.calendar.execute({ command: 'batch.add', args: { title: 'Across Sunday', events: [
        { title: 'Start', start: '2026-10-18T09:00:00+08:00', end: '2026-10-18T10:00:00+08:00' },
        { title: 'End', start: '2026-10-20T12:00:00+08:00', end: '2026-10-20T13:00:00+08:00' }
      ] } })
      await window.calendar.execute({ command: 'view', args: { date: '2026-10-13' } })
    })
    const strip = page.locator('.month-span').filter({ hasText: 'HKU Innovation' })
    await expect(strip).toHaveCount(1)
    await expect(strip).toHaveAttribute('data-start', '2026-10-13')
    await expect(strip).toHaveAttribute('data-end', '2026-10-14')
    await expect(strip.locator('.span-time')).toHaveText('10.13 09:00 — 10.14 17:00')
    expect(await strip.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await expect(page.locator('.day .group-chip')).toHaveCount(0)
    const bounds = (await strip.boundingBox())!, first = (await page.locator('[data-date="2026-10-13"]').boundingBox())!, last = (await page.locator('[data-date="2026-10-14"]').boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(first.x)
    expect(bounds.x + bounds.width).toBeGreaterThan(last.x + last.width - 10)
    const other = page.locator('.month-span').filter({ hasText: 'Overlapping event' })
    expect(await strip.getAttribute('data-lane')).not.toBe(await other.getAttribute('data-lane'))
    const lecture = page.locator('[data-date="2026-10-13"] .event-chip')
    await expect(lecture).toBeVisible()
    expect((await lecture.boundingBox())!.y).toBeGreaterThan(bounds.y + bounds.height)
    const continuation = page.getByRole('button', { name: /^Across Sunday ·/ })
    await expect(continuation).toHaveCount(2)
    await expect(continuation.first()).toHaveClass(/continues-after/)
    await expect(continuation.last()).toHaveClass(/continues-before/)
    await strip.click({ position: { x: bounds.width * .75, y: bounds.height / 2 } })
    await expect(page.locator('.group-title')).toHaveText('HKU Innovation')
    await expect(page.locator('.timeline-day')).toHaveCount(2)
    await expect.poll(async () => page.evaluate(async () => { const result = await window.calendar.execute({ command: 'status' }); return result.ok && result.data.selectedDate })).toBe('2026-10-14')
    await page.screenshot({ path: 'test-results/multi-day-strips.png' })
    for (const [width, height, fontSize] of [[1280, 800, 14], [900, 650, 22]]) {
      await page.evaluate(fontSize => window.calendar.execute({ command: 'settings.set', args: { fontSize } }), fontSize)
      await expect(page.locator('.app')).toHaveCSS('font-size', `${fontSize}px`)
      await electron.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect(strip).toBeVisible()
      expect(await strip.evaluate(node => { const a = node.getBoundingClientRect(), b = node.parentElement!.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom })).toBe(true)
    }
    await page.screenshot({ path: 'test-results/multi-day-strips-compact.png' })
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'batch.add', args: { title: 'Month boundary', events: [
        { title: 'November', start: '2026-11-29T09:00:00+08:00', end: '2026-11-29T10:00:00+08:00' },
        { title: 'December', start: '2026-12-01T09:00:00+08:00', end: '2026-12-01T10:00:00+08:00' }
      ] } })
      await window.calendar.execute({ command: 'view', args: { date: '2026-11-29' } })
    })
    await expect(page.locator('.day')).toHaveCount(42)
    const boundary = page.getByRole('button', { name: /^Month boundary ·/ })
    await expect(boundary).toHaveCount(2)
    await expect(boundary.last()).toHaveAttribute('data-end', '2026-12-01')
    await boundary.last().click()
    await expect(page.locator('.group-title')).toHaveText('Month boundary')
    await page.evaluate(async () => {
      await window.calendar.execute({ command: 'batch.add', args: { title: 'Monday deadline', events: [
        { title: 'Preparation', start: '2026-10-21', end: '2026-12-01', allDay: true },
        { title: 'Submit outline', start: '2026-11-30', end: '2026-12-01', allDay: true }
      ] } })
      await window.calendar.execute({ command: 'view', args: { date: '2026-12-01' } })
      await window.calendar.execute({ command: 'settings.set', args: { fontSize: 14 } })
    })
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    const tail = page.getByRole('button', { name: /^Monday deadline · 10\.21/ })
    await expect(tail).toHaveAttribute('data-start', '2026-11-30')
    await expect(tail).toHaveAttribute('data-end', '2026-11-30')
    await expect(tail).toHaveClass(/continuation-track/)
    await expect(tail.locator('.span-title,.span-time,.urgency-badge')).toHaveCount(0)
    const node = page.getByRole('button', { name: /^Monday deadline · 11\.30/ })
    await expect(node).toHaveClass(/continuation-track/)
    const nodeBounds = (await node.boundingBox())!, cell = (await page.locator('.day[data-date="2026-11-30"]').boundingBox())!
    expect(nodeBounds.x).toBeGreaterThan(cell.x)
    expect(nodeBounds.x + nodeBounds.width).toBeLessThan(cell.x + cell.width)
    await page.screenshot({ path: 'test-results/monday-tail-december.png' })
    await node.click()
    await expect(page.locator('.group-title')).toHaveText('Monday deadline')
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
