import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import type { Event, Place } from '../shared/protocol'
import { RouteMap } from './RouteMap'

async function call(command: string, args: Record<string, unknown> = {}, requestId?: string) {
  const result = await window.calendar.execute({ command, args, requestId })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}
export function Editor() {
  const query = new URLSearchParams(location.search), id = query.get('id'), itemId = query.get('itemId')
  const [form, setForm] = useState<any>({ title: '', notes: '', start: `${query.get('date') || DateTime.now().toISODate()}T15:00`, end: `${query.get('date') || DateTime.now().toISODate()}T16:00`, timezone: 'Asia/Hong_Kong', calendarId: 'local', allDay: false })
  const [calendars, setCalendars] = useState<any[]>([]), [version, setVersion] = useState<number>(), [error, setError] = useState(''), [saving, setSaving] = useState(false), [groupEditor, setGroupEditor] = useState(false), [point, setPoint] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const [ready, setReady] = useState(false)
  const [routeFrom, setRouteFrom] = useState<Place>(), [routeMode, setRouteMode] = useState<'foot' | 'bike' | 'car'>('foot'), [routing, setRouting] = useState(false)
  useEffect(() => { void (async () => {
    try {
      const config = await call('settings.get'); setForm((f: any) => ({ ...f, timezone: config.settings.timezone })); setCalendars((await call('calendars.list')).calendars)
      if (id) {
        const { event: parent } = await call('get', { id })
        const event: Event = itemId ? parent.items?.find((item: Event) => item.id === itemId && !item.deleted) : parent
        if (!event) throw new Error('子日程不存在')
        const preceding = itemId ? [...parent.items].filter((item: Event) => !item.deleted).sort((a: Event, b: Event) => a.start.localeCompare(b.start)) : []
        const previous = preceding.slice(0, preceding.findIndex((item: Event) => item.id === itemId)).reverse().find((item: Event) => item.location || item.route)
        setRouteFrom(previous?.location || previous?.route?.waypoints.at(-1) || event.route?.waypoints[0])
        setVersion(parent.version); setGroupEditor(!!parent.items && !itemId); setPoint(!!event.pointInTime)
        setForm({ title: event.title, notes: event.notes, calendarId: event.calendarId, allDay: event.allDay, timezone: event.timezone, location: event.location, route: event.route, start: event.allDay ? event.start : DateTime.fromISO(event.start).setZone(event.timezone).toFormat("yyyy-MM-dd'T'HH:mm"), end: event.allDay ? event.end : DateTime.fromISO(event.end).setZone(event.timezone).toFormat("yyyy-MM-dd'T'HH:mm") })
      }
      setReady(true)
    } catch (e) { setError(String(e)) }
  })() }, [id, itemId])
  const field = (key: string, value: any) => setForm({ ...form, [key]: value })
  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const value: any = groupEditor ? { title: form.title, notes: form.notes } : { ...form, start: form.allDay ? form.start : DateTime.fromISO(form.start, { zone: form.timezone }).toISO(), end: form.allDay ? form.end : DateTime.fromISO(form.end, { zone: form.timezone }).toISO() }
      if (itemId) { value.pointInTime = point; if (point) delete value.end }
      await call(id ? 'update' : 'add', id ? { ...value, id, ...(itemId ? { itemId } : {}), expectedVersion: version } : value, requestId)
      window.close()
    } catch (e) { setError(String(e)); setSaving(false) }
  }
  if (!ready) return <div className="editor"><p>{error || '正在读取日程…'}</p></div>
  return <div className="editor"><h1>{groupEditor ? '编辑活动组' : id ? '编辑日程' : '安排一段时间'}</h1><form onSubmit={save}>
    <label>标题<input aria-label="标题" autoFocus required maxLength={500} value={form.title} onChange={e => field('title', e.target.value)} placeholder="要做些什么？"/></label>
    {!groupEditor && <><div className="row"><label>所属日历<select disabled={!!itemId} value={form.calendarId} onChange={e => field('calendarId', e.target.value)}>{calendars.filter(c => !c.readOnly).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={form.allDay} onChange={e => { setPoint(false); setForm({ ...form, allDay: e.target.checked, start: e.target.checked ? form.start.slice(0, 10) : `${form.start}T09:00`, end: e.target.checked ? DateTime.fromISO(form.end.slice(0, 10)).plus({ days: 1 }).toISODate() : `${form.end}T10:00` }) }}/>全天</label></div>
    {itemId && !form.allDay && <label className="checkbox"><input type="checkbox" checked={point} onChange={e => setPoint(e.target.checked)}/>仅记录时间点</label>}
    <label>开始<input aria-label="开始" required type={form.allDay ? 'date' : 'datetime-local'} value={form.start} onChange={e => field('start', e.target.value)}/></label>
    {!point && <label>结束{form.allDay && '（不包含此日）'}<input aria-label="结束" required type={form.allDay ? 'date' : 'datetime-local'} value={form.end} onChange={e => field('end', e.target.value)}/></label>}
    <label>时区<input value={form.timezone} onChange={e => field('timezone', e.target.value)}/></label></>}
    {!groupEditor && <details className="location-editor"><summary>地点与地图{form.location ? ` · ${form.location.name}` : ''}</summary><p>点击地图选点，再填写地点名称。只按需加载底图，不发送日程正文。</p><RouteMap events={form.location ? [{ ...form, id: 'editor' }] : []} onPick={point => setForm((current: any) => ({ ...current, location: { name: current.location?.name || current.title || '地点', ...point }, route: null }))}/>{form.location && <><label>地点名称<input aria-label="地点名称" required value={form.location.name} onChange={e => field('location', { ...form.location, name: e.target.value })}/></label><div className="row"><label>纬度<input aria-label="纬度" type="number" step="any" min="-85" max="85" value={form.location.latitude} onChange={e => setForm({ ...form, location: { ...form.location, latitude: Number(e.target.value) }, route: null })}/></label><label>经度<input aria-label="经度" type="number" step="any" min="-180" max="180" value={form.location.longitude} onChange={e => setForm({ ...form, location: { ...form.location, longitude: Number(e.target.value) }, route: null })}/></label></div></>}<button type="button" onClick={() => setForm({ ...form, location: { name: form.title || '地点', latitude: 22.283, longitude: 114.14 } })}>添加地点</button>{(form.location || form.route) && <button type="button" onClick={() => setForm({ ...form, location: null, route: null })}>清除地点与路线</button>}{form.location && routeFrom && <div className="route-planner"><select aria-label="路线交通方式" value={routeMode} onChange={e => setRouteMode(e.target.value as typeof routeMode)}><option value="foot">步行</option><option value="bike">骑行</option><option value="car">驾车</option></select><button type="button" disabled={routing} onClick={async () => { setRouting(true); setError(''); try { const result = await call('maps.route', { mode: routeMode, waypoints: [routeFrom, form.location] }); field('route', result.route) } catch (e) { setError(String(e)) } finally { setRouting(false) } }}>{routing ? '计算中…' : '从上一地点规划路线'}</button>{form.route && <span>{((form.route.distanceMeters || 0) / 1000).toFixed(2)} km · 约 {Math.ceil((form.route.durationSeconds || 0) / 60)} 分钟</span>}</div>}</details>}
    <label>备注<textarea rows={3} value={form.notes} onChange={e => field('notes', e.target.value)}/></label>{error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" onClick={() => window.close()}>取消</button><button className="primary" disabled={saving || routing || (!!id && !version)}>{saving ? '保存中…' : '保存日程'}</button></div>
  </form></div>
}
