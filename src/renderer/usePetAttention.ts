import { useEffect, useRef, useState } from 'react'

/** Pointer and keyboard own attention until a short, cancellable handoff. */
export function usePetAttention() {
  const pointer = useRef<string | undefined>(undefined)
  const keyboard = useRef<string | undefined>(undefined)
  const timer = useRef<number | undefined>(undefined)
  const [key, setKey] = useState<string>()
  function cancel() { window.clearTimeout(timer.current); timer.current = undefined }
  function claim() {
    cancel()
    setKey(pointer.current || keyboard.current)
  }
  function release() {
    cancel()
    if (pointer.current || keyboard.current) { claim(); return }
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      if (!pointer.current && !keyboard.current) setKey(undefined)
    }, 650)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    key,
    enterPointer(value: string) { pointer.current = value; claim() },
    leavePointer(value: string) { if (pointer.current === value) { pointer.current = undefined; release() } },
    enterKeyboard(value: string) { keyboard.current = value; claim() },
    leaveKeyboard(value: string) { if (keyboard.current === value) { keyboard.current = undefined; release() } },
    clear() { cancel(); pointer.current = keyboard.current = undefined; setKey(undefined) }
  }
}
