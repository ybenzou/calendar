import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Reserve room for an overflow link; never display a partially clipped card. */
export function DayEvents({ children, total, onMore }: { children: ReactNode[]; total: number; onMore: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ compact: false, visible: 0 })
  useLayoutEffect(() => {
    const node = container.current!
    const list = node.querySelector<HTMLElement>('.day-event-candidates')!
    const more = node.querySelector<HTMLElement>('.day-events-more')!
    const measure = () => {
      const compact = node.clientHeight < parseFloat(getComputedStyle(node).fontSize) * 9
      if (compact !== node.classList.contains('compact')) {
        setLayout(previous => ({ ...previous, compact }))
        return
      }
      const cards = Array.from(list.children) as HTMLElement[]
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0
      const fullHeight = cards.reduce((height, card) => height + card.offsetHeight, 0) + Math.max(0, cards.length - 1) * gap
      const available = node.clientHeight - (total > cards.length || fullHeight > node.clientHeight ? more.offsetHeight + gap : 0)
      let height = 0, visible = 0
      for (const card of cards) {
        height += card.offsetHeight + (visible ? gap : 0)
        if (height > available) break
        visible++
      }
      setLayout(previous => previous.compact === compact && previous.visible === visible ? previous : { compact, visible })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node); observer.observe(list)
    return () => observer.disconnect()
  }, [children, total, layout.compact])
  return <div ref={container} className={`day-events adaptive-events ${layout.compact ? 'compact' : ''}`}>
    <div className="day-event-candidates">{children.map((child, index) => <div key={index} className="day-event-slot" inert={index >= layout.visible} style={{ visibility: index < layout.visible ? 'visible' : 'hidden' }}>{child}</div>)}</div>
    <button className="day-events-more" style={{ visibility: total > layout.visible ? 'visible' : 'hidden' }} tabIndex={total > layout.visible ? 0 : -1} onClick={event => { event.stopPropagation(); onMore() }} onKeyDown={event => event.stopPropagation()}>+{total - layout.visible} 条日程</button>
  </div>
}
