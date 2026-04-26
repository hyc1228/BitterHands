import { useCallback, useRef } from 'react'
import { registerWobbly, unregisterWobbly, type WobblyPreset } from './wobblyBg'

/** Returns a callback ref that registers/unregisters the wobbly clip-path. */
export function useWobbly(preset: WobblyPreset = 'panel') {
  const elRef = useRef<HTMLElement | null>(null)

  const ref = useCallback((el: HTMLElement | null) => {
    if (elRef.current) unregisterWobbly(elRef.current)
    elRef.current = el
    if (el) registerWobbly(el, preset)
  }, [preset])

  return ref
}
