import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { parseCommandText } from '../shared/commands'
import type { Command } from '../shared/protocol'
import { GroupTimeline } from './GroupTimeline'

type Panel = 'ai' | 'settings' | 'calendars' | 'backups'
const shortcuts = [
  { command: '/新建', label: '用表单添加日程' }, { command: '/外观', label: '主题、字号与显示器' },
  { command: '/订阅', label: '学校日历与订阅刷新' }, { command: '/备份', label: '备份与恢复' },
  { command: '/AI设置', label: '模型与凭据' }, { command: '/刷新', label: '更新订阅日程' },
  { command: '/今天', label: '回到今天' }, { command: '/状态', label: '查看运行状态' }
]
export function CommandBar({ execute, openPanel, desktopMode, selectedDate, timezone }: {
  execute: (command: Command) => Promise<any>; openPanel: (panel: Panel) => void;
  desktopMode: boolean; selectedDate: string; timezone: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(''), [focused, setFocused] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [result, setResult] = useState<any>(), [preview, setPreview] = useState<any>()
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent ? event.key !== 'Escape' : container.current?.contains(event.target as Node)) return
      setResult(undefined); setError(''); setFocused(false)
      input.current?.blur()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [])
  useEffect(() => {
    // Query results remain readable; mutation acknowledgements disappear automatically.
    if (!result || result.events || preview) return
    const timer = setTimeout(() => setResult(undefined), 4500)
    return () => clearTimeout(timer)
  }, [result, preview])
  async function focus() {
    if (desktopMode) await execute({ command: 'window', args: { action: 'input-focus' } })
    input.current?.focus()
  }
  async function submit(value = text) {
    if (busy || !value.trim()) return
    setBusy(true); setError(''); setResult(undefined); setPreview(undefined)
    try {
      const source = value.trim(), panels: Record<string, Panel> = { '/外观': 'settings', '/设置': 'settings', '/订阅': 'calendars', '/日历': 'calendars', '/备份': 'backups', '/AI设置': 'ai' }
      if (panels[source]) { openPanel(panels[source]); setText(''); setFocused(false); input.current?.blur(); return }
      if (['/帮助', '/help', '/'].includes(source)) { setText('/'); setFocused(true); return }
      let command: Command
      if (source === '/新建') command = { command: 'window', args: { action: 'editor', date: selectedDate } }
      else if (source === '/今天') command = { command: 'view', args: { today: true } }
      else if (source === '/刷新') command = { command: 'subscriptions.refresh' }
      else if (source === '/状态') command = { command: 'status' }
      else if (source.startsWith('/') || source.startsWith('calendar ') || /^(run|quit|status|add|batch|maps|list|get|update|delete|move|undo|view|window|settings|subscriptions|calendars|backup|ai)(\s|$)/.test(source)) command = parseCommandText(source)
      else command = { command: 'ai.preview', args: { text: source } }
      const response = await execute({ ...command, requestId: command.requestId || crypto.randomUUID() })
      if (response?.preview) setPreview(response.preview)
      else setResult(response)
      setText(''); setFocused(false); input.current?.blur()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function finishPreview(apply: boolean) {
    setBusy(true); setError('')
    try { const response = await execute({ command: apply ? 'ai.apply' : 'ai.cancel', args: { id: preview.id }, requestId: `${apply ? 'apply' : 'cancel'}:${preview.id}` }); setPreview(undefined); if (apply) setResult(response) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <div ref={container} className="command-bar">
    <form onSubmit={e => { e.preventDefault(); void submit() }}><span className="command-symbol">›</span><input ref={input} aria-label="日历命令" value={text} disabled={busy} onMouseDown={() => void focus()} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); if (desktopMode) void execute({ command: 'window', args: { action: 'input-release' } }).catch(() => {}) }} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setText(''); setResult(undefined); setError(''); input.current?.blur() }; if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.current?.select() } }} placeholder={busy ? '处理中…' : '输入日程安排，或 / 打开命令'}/><span className="command-key">{busy ? '···' : '↵'}</span></form>
    {focused && (!text || text.startsWith('/')) && <div className="command-popup shortcuts">{shortcuts.filter(s => !text || text === '/' || '/帮助'.startsWith(text) || s.command.toLowerCase().includes(text.toLowerCase())).map(s => <button key={s.command} onMouseDown={e => e.preventDefault()} onClick={() => void submit(s.command)}><span>{s.command}</span><small>{s.label}</small></button>)}<div className="command-tip">也支持 calendar add / list / move 和 JSON 参数</div></div>}
    {error && <div className="command-popup command-error" role="alert">{error}<button onClick={() => setError('')}>关闭</button>{error.includes('AI_NOT_CONFIGURED') && <button onClick={() => openPanel('ai')}>配置 AI</button>}</div>}
    {preview && <div className="command-popup command-preview"><div className="popup-heading"><strong>检查操作</strong><span>确认后保存</span></div><p>{preview.summary}</p>{preview.validated.event && <div className="proposed-event"><strong>{preview.validated.event.title}</strong><p>{preview.validated.event.allDay ? `${preview.validated.event.start} — ${preview.validated.event.end}（结束日不包含）` : `${DateTime.fromISO(preview.validated.event.start).setZone(timezone).toFormat('yyyy-MM-dd HH:mm')} — ${DateTime.fromISO(preview.validated.event.end).setZone(timezone).toFormat('HH:mm')}`} · {timezone === 'Asia/Hong_Kong' ? 'HKT' : timezone}</p></div>}{preview.validated.event?.items && <GroupTimeline group={preview.validated.event} timezone={timezone}/>}{preview.validated.events?.map((event: any) => <div key={event.id} className="command-event">{event.title}<small>{event.allDay ? event.start : DateTime.fromISO(event.start).setZone(timezone).toFormat('MM-dd HH:mm')}</small></div>)}{preview.overlaps.length > 0 && <p className="overlap">与 {preview.overlaps.length} 条日程重叠</p>}<div className="popup-actions"><button disabled={busy} onClick={() => void finishPreview(false)}>取消</button><button className="primary" disabled={busy} onClick={() => void finishPreview(true)}>确认执行</button></div></div>}
    {result && !preview && <div className="command-popup command-result"><div className="popup-heading"><strong>{result.event?.items ? (result.duplicate ? '活动组已存在' : '活动组已保存') : result.event ? '日程已保存' : result.events ? `查询到 ${result.events.length} 条日程` : '命令已完成'}</strong><button onClick={() => setResult(undefined)}>×</button></div>{result.event && <p>{result.event.title}{result.itemCount ? ` · ${result.itemCount} 项，点击月历中的活动组查看` : ""}</p>}{result.events?.slice(0, 30).map((event: any) => <div className="command-event" key={event.id}>{event.title}<small>{event.allDay ? event.start : DateTime.fromISO(event.start).setZone(timezone).toFormat('MM-dd HH:mm')}</small></div>)}<details><summary>查看结果</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
  </div>
}
