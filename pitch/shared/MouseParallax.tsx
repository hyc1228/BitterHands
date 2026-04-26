import { type ReactNode, useEffect, useRef } from 'react'

interface MouseParallaxProps {
  children: ReactNode
}

/**
 * Wraps children and applies subtle parallax movement toward cursor.
 * Elements with data-parallax="N" shift up to N pixels toward the mouse.
 * Disabled on touch devices.
 */
export function MouseParallax({ children }: MouseParallaxProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const currentRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if ('ontouchstart' in window) return

    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }

    const lerp = 0.08
    let raf = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)

      const cur = currentRef.current
      const tgt = mouseRef.current
      cur.x += (tgt.x - cur.x) * lerp
      cur.y += (tgt.y - cur.y) * lerp

      const container = containerRef.current
      if (!container) return

      const els = container.querySelectorAll<HTMLElement>('[data-parallax]')
      for (const el of els) {
        const amount = parseFloat(el.dataset.parallax ?? '0')
        el.style.transform = `translate(${cur.x * amount}px, ${cur.y * amount}px)`
      }
    }

    window.addEventListener('mousemove', onMove)
    raf = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <div ref={containerRef}>{children}</div>
}
