import { contextBridge, ipcRenderer } from 'electron'
import type { CalendarAPI } from '../shared/protocol'
const api: CalendarAPI = {
  execute: command => ipcRenderer.invoke('calendar:execute', command),
  pet: action => ipcRenderer.invoke('calendar:pet', action),
  subscribePet: callback => { const listener = (_event: unknown, message: Parameters<typeof callback>[0]) => callback(message); ipcRenderer.on('calendar:pet-frame', listener); return () => ipcRenderer.removeListener('calendar:pet-frame', listener) },
  subscribe: callback => { const listener = () => callback(); ipcRenderer.on('calendar:changed', listener); return () => ipcRenderer.removeListener('calendar:changed', listener) }
}
contextBridge.exposeInMainWorld('calendar', api)
