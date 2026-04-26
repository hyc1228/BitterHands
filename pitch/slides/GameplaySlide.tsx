interface Station {
  emoji: string
  label: string
}

const STATIONS: Station[] = [
  { emoji: '📸', label: 'Scan your face' },
  { emoji: '🎭', label: 'Get an animal identity' },
  { emoji: '📜', label: 'Read your private rules' },
  { emoji: '👁️', label: 'Survive 2 minutes' },
  { emoji: '🏁', label: 'Roll call · survivors win' },
]

export function GameplaySlide() {
  const cx = 460
  const cy = 295
  const r = 160
  const startAngle = -Math.PI / 2

  const points = STATIONS.map((_, i) => {
    const a = startAngle + (i * 2 * Math.PI) / STATIONS.length
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  })

  return (
    <>
      <h2 className="slide-title pop-in pop-delay-1">How it plays</h2>
      <p className="slide-subtitle pop-in pop-delay-1">
        5–10 players · 2 minutes · phone-only
      </p>

      <div className="loop-wrap pop-in pop-delay-2" data-parallax="3">
        <div className="loop-card nz-card">
          <svg
            className="loop-svg"
            viewBox="0 0 920 590"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <marker
                id="arrow-red"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--nz-red)" />
              </marker>
              <radialGradient id="monitor-glow" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="rgba(214, 64, 46, 0.55)" />
                <stop offset="70%" stopColor="rgba(214, 64, 46, 0.12)" />
                <stop offset="100%" stopColor="rgba(214, 64, 46, 0)" />
              </radialGradient>
            </defs>

            {/* Outer arrows along the circle */}
            {points.map((p, i) => {
              const next = points[(i + 1) % points.length]
              const mx = (p.x + next.x) / 2
              const my = (p.y + next.y) / 2
              const dx = mx - cx
              const dy = my - cy
              const len = Math.hypot(dx, dy) || 1
              const cxCtrl = mx + (dx / len) * 38
              const cyCtrl = my + (dy / len) * 38
              const shrink = (
                from: { x: number; y: number },
                to: { x: number; y: number },
                by: number,
              ) => {
                const ddx = to.x - from.x
                const ddy = to.y - from.y
                const l = Math.hypot(ddx, ddy) || 1
                return { x: from.x + (ddx / l) * by, y: from.y + (ddy / l) * by }
              }
              const a = shrink(p, next, 40)
              const b = shrink(next, p, 40)
              return (
                <path
                  key={i}
                  d={`M${a.x} ${a.y} Q${cxCtrl} ${cyCtrl} ${b.x} ${b.y}`}
                  stroke="var(--nz-red)"
                  strokeWidth={2.2}
                  strokeOpacity={0.7}
                  fill="none"
                  markerEnd="url(#arrow-red)"
                />
              )
            })}

            {/* Station nodes — dark ink with cream stroke */}
            {points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={38}
                  fill="var(--nz-ink)"
                  stroke="var(--nz-cream)"
                  strokeWidth={1.8}
                />
                <text
                  x={p.x}
                  y={p.y + 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={32}
                >
                  {STATIONS[i].emoji}
                </text>
              </g>
            ))}

            {/* Station labels — outside the circle */}
            {points.map((p, i) => {
              const dx = p.x - cx
              const dy = p.y - cy
              const len = Math.hypot(dx, dy) || 1
              const lx = p.x + (dx / len) * 60
              const ly = p.y + (dy / len) * 60
              const anchor =
                Math.abs(dx) < 30 ? 'middle' : dx > 0 ? 'start' : 'end'
              return (
                <text
                  key={`l-${i}`}
                  x={lx}
                  y={ly}
                  fontFamily="'Patrick Hand', sans-serif"
                  fontSize={17}
                  fill="var(--nz-cream)"
                  textAnchor={anchor}
                  dominantBaseline="central"
                >
                  {STATIONS[i].label}
                </text>
              )
            })}

            {/* Center: AI Monitor with glow */}
            <circle cx={cx} cy={cy} r={90} fill="url(#monitor-glow)" />
            <circle
              cx={cx}
              cy={cy}
              r={52}
              fill="var(--nz-black)"
              stroke="var(--nz-red)"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={40}
            >
              👁️
            </text>
            <text
              x={cx}
              y={cy + 30}
              fontFamily="'Permanent Marker', sans-serif"
              fontSize={11}
              letterSpacing="0.22em"
              fill="var(--nz-red)"
              textAnchor="middle"
            >
              AI MONITOR
            </text>
          </svg>
        </div>
      </div>

      <div className="loop-meta pop-in pop-delay-3">
        <span className="nz-chip nz-chip--accent">🦁 Lion · roar ≥ 2s</span>
        <span className="nz-chip nz-chip--accent">🦉 Owl · don&apos;t blink for 3s</span>
        <span className="nz-chip nz-chip--accent">🦒 Giraffe · shake your head</span>
      </div>
    </>
  )
}
