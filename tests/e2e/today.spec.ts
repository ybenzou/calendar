import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('Today keeps its label, charcoal date, underline and four-sided frame across heat and selection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-e2e-today-'))
  const env = Object.fromEntries(Object.entries({ ...process.env, CALENDAR_DATA_DIR: directory, CALENDAR_AGENT_DATA_DIR: path.join(directory, 'agents'), CALENDAR_DIAGNOSTIC: '1' }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({ args: [process.cwd()], env })
  try {
    const page = await electron.firstWindow()
    await expect(page.locator('.today')).toHaveCount(1)
    const today = page.locator('.today'), date = await today.getAttribute('data-date')
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1032))
    await page.evaluate(async date => {
      await window.calendar.execute({ command: 'add', args: { title: 'Today sample appointment', start: `${date}T19:00:00+08:00`, end: `${date}T20:00:00+08:00` } })
    }, date)
    await expect(today.locator('.event-chip')).toBeVisible()
    for (const theme of ['swiss', 'warm', 'memphis']) {
      for (const fontSize of [14, 22]) {
        await page.evaluate(async ({ theme, fontSize }) => { await window.calendar.execute({ command: 'settings.set', args: { theme, fontSize } }) }, { theme, fontSize })
        await expect(page.locator('.app')).toHaveClass(new RegExp(`theme-${theme}`))
        await expect(page.locator('.app')).toHaveCSS('font-size', `${fontSize}px`)
        for (const selected of [true, false]) {
          await (selected ? today : page.locator('.day:not(.today):not(.outside)').first()).click()
          await expect(today).toHaveAttribute('aria-current', 'date')
          await expect(page.locator('[aria-current="date"]')).toHaveCount(1)
          await expect(today.locator('.today-label')).toHaveText('TODAY')
          await expect(today.locator('.today-label')).toBeVisible()
          await expect(page.locator('.day:not(.today) .today-label')).toHaveCount(0)
          await expect(today.locator('.today-label')).toHaveCSS('color', 'rgb(37, 56, 50)')
          if (selected) await expect(today).toHaveClass(/selected/)
          else await expect(today).not.toHaveClass(/selected/)
          const styles = await today.evaluate(node => {
            const rgb = (color: string) => color.startsWith('#') ? color.slice(1).match(/../g)!.map(v => parseInt(v, 16)) : color.match(/[\d.]+/g)!.map(Number)
            const blend = (top: number[], bottom: number[]) => top.slice(0, 3).map((v, i) => v * (top[3] ?? 1) + bottom[i] * (1 - (top[3] ?? 1)))
            const luminance = (color: number[]) => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
            return [0, 1, 2, 3, 4].map(level => {
              node.setAttribute('data-heat', String(level))
              const style = getComputedStyle(node.querySelector('.day-date')!)
              const frame = getComputedStyle(node, ':after')
              const paper = rgb(getComputedStyle(document.querySelector('.app')!).getPropertyValue('--paper').trim())
              const heat = getComputedStyle(node, ':before').backgroundColor
              const background = blend(rgb(heat), blend(rgb(getComputedStyle(node).backgroundColor), paper))
              const a = luminance(rgb(style.color)), b = luminance(background)
              return { color: style.color, heat, line: style.borderBottomStyle, lineColor: style.borderBottomColor, width: style.borderBottomWidth, bg: style.backgroundColor, radius: style.borderRadius, fontSize: parseFloat(style.fontSize), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), frame: { color: frame.borderColor, widths: [frame.borderTopWidth, frame.borderRightWidth, frame.borderBottomWidth, frame.borderLeftWidth], position: frame.position, pointerEvents: frame.pointerEvents } }
            })
          })
          expect(new Set(styles.map(s => s.color)).size).toBe(1)
          expect(new Set(styles.map(s => s.heat))).toEqual(new Set(['rgba(0, 0, 0, 0)']))
          for (const style of styles) {
            expect(style.color).toBe('rgb(37, 56, 50)')
            expect(style.line).toBe('solid'); expect(style.width).toBe('2px')
            expect(style.lineColor).toBe(style.color)
            expect(style.frame.color).toBe(style.color)
            expect(style.frame.widths).toEqual(['2px', '2px', '2px', '2px'])
            expect(style.frame.position).toBe('absolute')
            expect(style.frame.pointerEvents).toBe('none')
            expect(style.bg).toBe('rgba(0, 0, 0, 0)'); expect(style.radius).toBe('0px')
            expect(style.fontSize).toBeGreaterThanOrEqual(24)
            expect(style.contrast).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
    await today.click()
    await page.evaluate(async () => { await window.calendar.execute({ command: 'settings.set', args: { theme: 'swiss', fontSize: 14 } }) })
    await expect(page.locator('.app')).toHaveCSS('font-size', '14px')
    await today.evaluate(node => node.setAttribute('data-heat', '4'))
    await page.screenshot({ path: 'test-results/today-charcoal-label.png', fullPage: true })
    await expect(today.locator('.day-date')).toHaveCSS('font-weight', await page.locator('.day:not(.today):not(.outside) .day-date').first().evaluate(node => getComputedStyle(node).fontWeight))
    expect(await today.getAttribute('data-date')).toBe(date)
    const marker = await today.locator('.day-date').boundingBox(), label = await today.locator('.today-label').boundingBox(), event = await today.locator('.event-chip').boundingBox()
    expect(label!.x).toBeGreaterThanOrEqual(marker!.x + marker!.width)
    expect(label!.y).toBeLessThan(marker!.y + marker!.height)
    expect(event!.y).toBeGreaterThanOrEqual(marker!.y + marker!.height)
  } finally {
    await electron.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
