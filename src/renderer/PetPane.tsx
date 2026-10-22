import React, { useEffect, useRef, useState } from 'react'
import type { PetScene, PetSession } from '../shared/pet'
import { usePetAttention } from './usePetAttention'

const finished = (session: PetSession) => session.activity === 'offline' || ['done', 'stopped', 'idle'].includes(session.pose) && session.activity !== 'disconnected'
const working = (session: PetSession) => !['offline', 'disconnected'].includes(session.activity) && ['working', 'tool'].includes(session.pose)
function duration(seconds: number) { const minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : minutes ? `${minutes}m` : `${Math.floor(seconds)}s` }

export function PetPane() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const attend = useRef<() => void>(() => {})
  const lastAttention = useRef('')
  const screens = useRef(new Map<string, HTMLElement>())
  const [connected, setConnected] = useState(false)
  const [sessions, setSessions] = useState<PetSession[]>([]), [expanded, setExpanded] = useState<string>()
  const manual = usePetAttention()
  const [scene, setScene] = useState<PetScene>()
  const [actorPose, setActorPose] = useState('rest')
  const [workloadMode, setWorkloadMode] = useState('rest'), [runningCount, setRunningCount] = useState<number>()
  useEffect(() => {
    let alive = true, decoding = false, aspect = 10/7, requested = '', lastFrameSize = '', restShift = 62
    let liveConnection = false, lastPose = '', lastMode = '', lastCount = -1, lastScene: PetScene | undefined
    const connection = (value: boolean) => { if (value !== liveConnection) { liveConnection = value; setConnected(value) } }
    const image = new Image()
    const resize = () => {
      const parent = stage.current, target = canvas.current
      if (!parent || !target) return
      const bounds = parent.getBoundingClientRect()
      restShift = bounds.height*.15
      // The native frame contains transparent margins around the actor. Let
      // these extend into the gaps; the opaque body fits the centre column.
      const width = Math.min(bounds.width*2, bounds.height*aspect), height = width/aspect
      if (width < 16 || height < 16) return
      target.style.width = `${width}px`; target.style.height = `${height}px`
      const ratio = Math.min(devicePixelRatio || 1, 1536/width, 1080/height, Math.sqrt(1_500_000/(width*height)))
      const physicalWidth = Math.max(16, Math.round(width*ratio)), physicalHeight = Math.max(16, Math.round(height*ratio))
      const size = `${physicalWidth}x${physicalHeight}`
      if (size !== requested) { requested = size; void window.calendar.pet({ action: 'viewport', width: physicalWidth, height: physicalHeight }) }
      attend.current()
    }
    const observer = new ResizeObserver(resize)
    if (stage.current) observer.observe(stage.current)
    window.addEventListener('resize', resize)
    const unsubscribe = window.calendar.subscribePet(message => {
      if (message.type === 'status') { connection(message.connected); return }
      connection(true)
      if (message.sessions) setSessions(message.sessions.sort((a, b) => a.slot - b.slot))
      if (message.workload) {
        if (lastMode !== message.workload.mode) { lastMode = message.workload.mode; setWorkloadMode(lastMode) }
        if (lastCount !== message.workload.running) { lastCount = message.workload.running; setRunningCount(lastCount) }
      }
      if (message.scene) {
        const next = message.scene
        if (!lastScene || lastScene.action !== next.action || lastScene.target !== next.target || lastScene.since !== next.since || lastScene.lamp !== next.lamp || lastScene.object !== next.object) { lastScene = next; setScene(next) }
      }
      if (message.attention && lastPose !== message.attention.pose) { lastPose = message.attention.pose; setActorPose(lastPose) }
      const natural = `${message.logicalWidth || message.width}x${message.logicalHeight || message.height}`
      if (natural !== lastFrameSize) { lastFrameSize = natural; aspect = (message.logicalWidth || message.width)/(message.logicalHeight || message.height); resize() }
      if (decoding) return
      decoding = true
      image.onload = () => {
        const target = canvas.current
        if (alive && target) {
          if (target.width !== message.width || target.height !== message.height) { target.width = message.width; target.height = message.height }
          const context = target.getContext('2d')!
          context.imageSmoothingEnabled = false
          // Replace opaque and transparent pixels together in one draw.
          context.globalCompositeOperation = 'copy'
          context.drawImage(image, 0, 0)
          // Move beneath the desk using the same smooth progress as the
          // native lie/rise, without resizing or restarting the canvas.
          target.style.transform = `translate(-50%, -50%) translateY(${(message.attention?.rest ?? 0)*restShift}px)`
        }
        decoding = false
      }
      image.onerror = () => { decoding = false }
      image.src = `data:image/png;base64,${message.png}`
    })
    void window.calendar.pet({ action: 'host', enabled: true })
    resize()
    return () => { alive = false; observer.disconnect(); window.removeEventListener('resize', resize); unsubscribe(); void window.calendar.pet({ action: 'host', enabled: false }) }
  }, [])
  const active = sessions.filter(working)
  const shown = sessions
  const waiting = sessions.filter(session => session.pose === 'needs_you' && !['offline', 'disconnected'].includes(session.activity))
  const autoKey = scene?.object ? undefined : scene?.target || (active.length ? active : waiting)[0]?.key
  const manualKey = shown.some(session => session.key === manual.key) ? manual.key : undefined
  const focusedKey = manualKey || (
    shown.some(session => session.key === autoKey) ? autoKey : scene?.object ? undefined : shown.find(session => !finished(session))?.key
  )
  const targetIndex = shown.findIndex(session => session.key === focusedKey)
  useEffect(() => {
    let scheduled = 0
    if (!connected) { lastAttention.current = ''; return }
    const send = () => {
      scheduled = 0
      const actor = canvas.current?.getBoundingClientRect(), screen = focusedKey && screens.current.get(focusedKey)?.getBoundingClientRect()
      if (!actor) return
      const x = screen ? Math.max(-1, Math.min(1, (screen.x+screen.width/2-actor.x-actor.width/2)/120)) : 0
      const y = screen ? Math.max(-1, Math.min(1, (screen.y+screen.height/2-actor.y-actor.height*.26)/140)) : 0
      const request = { action: 'focus' as const, key: focusedKey || null, source: manualKey ? 'manual' as const : 'auto' as const, x: Math.round(x*2)/2, y: Math.round(y*2)/2 }
      const signature = JSON.stringify(request)
      if (signature !== lastAttention.current) { lastAttention.current = signature; void window.calendar.pet(request) }
    }
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(send) }
    attend.current = schedule
    schedule()
    return () => { cancelAnimationFrame(scheduled); attend.current = () => {} }
  }, [connected, focusedKey, manualKey, expanded])
  function tapActor(clientX?: number, clientY?: number) {
    const bounds = canvas.current?.getBoundingClientRect()
    if (bounds) void window.calendar.pet({ action: 'click', x: clientX === undefined ? .5 : (clientX-bounds.left)/bounds.width, y: clientY === undefined ? .6 : (clientY-bounds.top)/bounds.height })
  }
  function interact(event: React.MouseEvent, item: 'lamp' | 'plant' | 'notes') {
    event.stopPropagation()
    manual.clear()
    void window.calendar.pet({ action: 'interact', item })
  }
  function card(session: PetSession, index: number) {
    const running = connected && working(session)
    const status = connected ? session.status : '连接已断开'
    return <article className="pet-session" key={session.key} ref={node => { if (node) screens.current.set(session.key, node); else screens.current.delete(session.key) }}
      style={{ gridColumn: index%2 ? 3 : 1, gridRow: Math.floor(index/2)+1 }}
      data-key={session.key} data-pose={session.pose} data-running={running} data-finished={finished(session)} data-focused={connected && session.key === focusedKey} data-screen-side={index%2 ? 'right' : 'left'}
      onPointerEnter={() => manual.enterPointer(session.key)} onPointerLeave={() => manual.leavePointer(session.key)}
      onFocus={event => { if ((event.target as HTMLElement).matches(':focus-visible')) manual.enterKeyboard(session.key) }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) manual.leaveKeyboard(session.key) }}>
      <button className="pet-session-jump" disabled={!connected} onClick={() => void window.calendar.pet({ action: 'click', key: session.key })} title={`${session.project}\n${status}\n点击跳转到对应窗口`}>
        <small><i/><b>{String(session.slot).padStart(2, '0')}</b></small>
        <strong>{session.project}</strong><span className="pet-screen-status"><em>{session.pose === 'done' ? '✓' : running ? '›_' : session.pose === 'needs_you' ? '◇' : '·'}</em>{status}</span>
        <div className="pet-screen-bottom"><span className="pet-screen-activity" aria-label="最近工具状态">{session.actions.slice(0, 4).reverse().map((action, index) => <i key={index} data-result={action.includes('失败') ? 'error' : action.includes('完成') ? 'done' : 'running'} title={action}/>)}</span><time>{duration(session.elapsed)}</time></div>
      </button>
      <button className="pet-detail-toggle" aria-expanded={expanded === session.key} onClick={() => setExpanded(expanded === session.key ? undefined : session.key)}>{expanded === session.key ? '收起' : '详情'}</button>
      {expanded === session.key && <div className="pet-session-actions">{session.actions.length ? session.actions.map((action, index) => <p key={index}>{action}</p>) : <p>暂无更多记录</p>}</div>}
    </article>
  }
  return <section className="pet-pane" aria-label="奶蛙实时会话">
    <div className="pet-toolbar"><span className="pet-session-count">{connected ? `${runningCount ?? active.length} 进行中` : '离线'} · {sessions.length} 会话</span><span className="pet-connection" data-connected={connected} role="status" aria-label={connected ? '实时连接' : '未连接'} title={connected ? '实时连接' : '未连接'}><i/></span></div>
    <div className="pet-session-list">
      <div className="pet-stage" ref={stage} data-action={scene?.action || 'rest'} data-lamp={scene?.lamp ?? true} data-workload={connected ? workloadMode : 'offline'} data-running-count={connected ? runningCount ?? active.length : 0} data-focus-key={focusedKey} data-pose={actorPose} data-side={targetIndex < 0 ? 'none' : targetIndex%2 ? 'right' : 'left'} tabIndex={connected ? 0 : -1} role="group" aria-label="奶蛙的工作角落"
        onClick={event => tapActor(event.clientX, event.clientY)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); tapActor() } }}>
        <div className="pet-world-floor" aria-hidden="true"/>
        <div className="pet-lamplight" aria-hidden="true"/>
        <div className="pet-desk" aria-hidden="true"/>
        <button className="pet-world-lamp" disabled={!connected} aria-label="开关台灯" aria-pressed={scene?.lamp ?? true} onClick={event => interact(event, 'lamp')}><svg viewBox="0 0 30 46" aria-hidden="true"><path d="M6 44h20M16 43V24L8 10h12l6 12H13"/><path d="M8 10V6h12v4"/></svg></button>
        <button className="pet-world-plant" disabled={!connected} aria-label="看看小植物" onClick={event => interact(event, 'plant')}><svg viewBox="0 0 22 30" aria-hidden="true"><path className="pet-leaves" d="M11 21V9C1 10 1 2 3 2c8 0 8 10 8 10C11 4 20 4 20 5c1 8-9 9-9 9"/><path d="M3 21h16l-2 8H5z"/></svg></button>
        <button className="pet-world-notes" disabled={!connected} aria-label="翻开笔记" onClick={event => interact(event, 'notes')}><i/><i/><i/></button>
        <canvas ref={canvas} aria-label="奶蛙工作动画" hidden={!connected}/>
        {!connected && <p className="pet-offline">未连接</p>}
      </div>
      {shown.map(card)}{!shown.length && <p className="pet-idle">{connected ? '等待会话接入' : '连接后恢复工作台'}</p>}
    </div>
  </section>
}
