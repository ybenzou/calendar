import { describe, it, expect } from 'vitest'
import { parseCommandText, commandDefinitions } from '../src/shared/commands'
describe('Unified command-bar and CLI definitions', () => {
  it('parses quoted Chinese, grouped commands, numbers and flags', () => {
    expect(parseCommandText('calendar add --title "论文 讨论" --start "2026-10-14T15:00:00+08:00" --end "2026-10-14T16:00:00+08:00" --dry-run')).toMatchObject({ command: 'add', args: { title: '论文 讨论' }, dryRun: true })
    expect(parseCommandText('/settings set --font-size 16 --theme=warm')).toMatchObject({ command: 'settings.set', args: { fontSize: 16, theme: 'warm' } })
    expect(parseCommandText('calendar move --id abc --date 2026-10-15 --expected-version 2 --request-id stable')).toMatchObject({ args: { expectedVersion: 2 }, requestId: 'stable' })
  })
  it('supports JSON parameter objects for all validated settings and commands', () => {
    expect(parseCommandText('batch add {"title":"测试活动","events":[{"title":"测试节点","start":"2026-10-14T09:10:00+08:00"}]}')).toMatchObject({ command: 'batch.add', args: { title: '测试活动' } })
    expect(parseCommandText('settings set {"fillDisplay":true,"fontSize":16}')).toEqual({ command: 'settings.set', args: { fillDisplay: true, fontSize: 16 } })
    expect(parseCommandText('add {"title":"下午讨论","start":"2026-10-14T15:00:00+08:00","end":"2026-10-14T16:00:00+08:00"}').args?.title).toBe('下午讨论')
  })
  it('rejects incomplete quotes, missing values, unknown flags and arbitrary code', () => {
    expect(() => parseCommandText('add --title "broken')).toThrow('引号')
    expect(() => parseCommandText('move --id --date 2026-10-15')).toThrow('缺少')
    expect(() => parseCommandText('settings set --font-size nope')).toThrow('数字')
    expect(() => parseCommandText('window --eval process.exit()')).toThrow('不支持')
    expect(() => parseCommandText('powershell Remove-Item')).toThrow('未知')
  })
  it('keeps command names unique', () => { expect(new Set(commandDefinitions.map(d => d.path)).size).toBe(commandDefinitions.length) })
})
