import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Event, Place } from '../shared/protocol'

export const modeNames = { foot: '步行', bike: '骑行', car: '驾车', tram: '叮叮车', metro: '港铁', bus: '巴士', ferry: '轮渡', cable: '缆车' }
export function routeSummary(event: Event) {
  const r = event.route
  if (!r) return event.location?.name || ''
  return `${modeNames[r.mode]}${r.distanceMeters !== undefined ? ` · ${(r.distanceMeters / 1000).toFixed(2)} km` : ''}${r.durationSeconds !== undefined ? ` · 约 ${Math.ceil(r.durationSeconds / 60)} 分钟` : ''}`
}
export function RouteMap({ events, selectedId, onSelect, onPick }: { events: Event[]; selectedId?: string; onSelect?: (id: string) => void; onPick?: (point: Pick<Place, 'latitude' | 'longitude'>) => void }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<L.Map | undefined>(undefined), layer = useRef<L.LayerGroup | undefined>(undefined)
  const select = useRef(onSelect), pick = useRef(onPick)
  select.current = onSelect; pick.current = onPick
  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, { scrollWheelZoom: false, zoomControl: false }).setView([22.283, 114.14], 14)
    instance.attributionControl.setPrefix(false)
    map.current = instance; layer.current = L.layerGroup().addTo(instance)
    L.tileLayer('calendar-map://tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">FOSSGIS</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">纠错</a>' }).addTo(instance)
    instance.on('click', e => pick.current?.({ latitude: Number(e.latlng.lat.toFixed(6)), longitude: Number(e.latlng.lng.toFixed(6)) }))
    const resize = new ResizeObserver(() => instance.invalidateSize()); resize.observe(container.current)
    return () => { resize.disconnect(); instance.remove(); map.current = undefined }
  }, [])
  useEffect(() => {
    const instance = map.current, drawings = layer.current
    if (!instance || !drawings) return
    drawings.clearLayers()
    const bounds: L.LatLngExpression[] = [], selectedBounds: L.LatLngExpression[] = []
    const active = events.some(e => e.id === selectedId) ? selectedId : undefined
    events.filter(e => !e.deleted).forEach((event, index) => {
      const points = event.route?.waypoints || (event.location ? [event.location] : [])
      const coords: [number, number][] = event.route?.geometry || points.map(p => [p.latitude, p.longitude])
      const color = !active || active === event.id ? '#11645a' : '#94aaa4'
      if (coords.length > 1) {
        L.polyline(coords, { color, weight: active === event.id ? 5 : 3, dashArray: event.route?.geometry ? undefined : '6 6' }).bindTooltip(event.route?.geometry ? '已保存路线' : '地点连线示意，非道路路线').on('click', () => select.current?.(event.id)).addTo(drawings)
      }
      points.forEach((point, i) => {
        if (events.some(other => other.id !== event.id && other.location?.latitude === point.latitude && other.location?.longitude === point.longitude)) return
        const label = document.createElement('span'); label.textContent = `${index + 1}. ${point.name}`
        L.marker([point.latitude, point.longitude], { icon: L.divIcon({ className: 'route-marker', html: `<span>${index + 1}${points.length > 1 ? (i === 0 ? '起' : i === points.length - 1 ? '终' : '') : ''}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).bindTooltip(label).on('click', () => select.current?.(event.id)).addTo(drawings)
      })
      bounds.push(...coords); if (event.id === active) selectedBounds.push(...coords)
    })
    const target = selectedBounds.length ? selectedBounds : bounds
    if (target.length) instance.fitBounds(L.latLngBounds(target), { padding: [30, 30], maxZoom: 16, animate: false })
  }, [events, selectedId])
  return <div className="route-map-wrap"><div ref={container} className="route-map" aria-label="行程地图"/></div>
}
