import {
  type ReactNode,
  type ReactElement,
  useState,
  useEffect,
  useCallback,
  Children,
} from 'react'
import './SlideContainer.css'

interface SlideContainerProps {
  children: ReactNode
}

export function SlideContainer({ children }: SlideContainerProps) {
  const slides = Children.toArray(children) as ReactElement[]
  const [current, setCurrent] = useState(0)
  const total = slides.length

  const go = useCallback(
    (dir: 1 | -1) =>
      setCurrent((i) => Math.max(0, Math.min(total - 1, i + dir))),
    [total],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        go(1)
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  return (
    <div className="slide-deck">
      {slides.map((slide, i) => (
        <section
          key={i}
          className={`slide ${i === current ? 'slide-active' : ''} ${
            i < current ? 'slide-past' : ''
          } ${i > current ? 'slide-future' : ''}`}
        >
          <div className="slide-content">{slide}</div>
        </section>
      ))}

      <div className="slide-dots">
        {slides.map((_, i) => (
          <button
            key={i}
            className={`slide-dot ${i === current ? 'slide-dot--active' : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>

      <div className="slide-counter text-small">
        {current + 1} / {total}
      </div>
    </div>
  )
}
