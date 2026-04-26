/**
 * wobblyBg.ts — Animated SVG clip-path with organic squircle shape.
 *
 * Uses a 4-curve closed Bézier loop (squircle) as the clip outline.
 * Wobble driven by 4 phase-locked oscillators that modulate
 * control-point spread and anchor offsets.
 *
 * Soft ambient shadow is achieved via CSS filter: drop-shadow()
 * on the clipped element itself, so it stays perfectly in sync
 * during CSS animations.
 */

export type WobblyPreset = 'panel' | 'wide' | 'small' | 'slot'

interface WobblyConfig {
  fx: { base: number; wobble: number }
  fy: { base: number; wobble: number }
  fxFromPx?: number
  anchorDrift: number
  period: number
  filter: string
}

const PRESETS: Record<WobblyPreset, WobblyConfig> = {
  panel: {
    fx: { base: 0.44, wobble: 0.035 },
    fy: { base: 0.44, wobble: 0.035 },
    anchorDrift: 0.018,
    period: 8,
    filter: 'drop-shadow(0 4px 18px rgba(100,80,60,0.35)) drop-shadow(0 1px 6px rgba(100,80,60,0.35))',
  },
  wide: {
    fx: { base: 0.46, wobble: 0.025 },
    fy: { base: 0.44, wobble: 0.04 },
    fxFromPx: 30,
    anchorDrift: 0.014,
    period: 8,
    filter: 'drop-shadow(0 4px 18px rgba(100,80,60,0.35)) drop-shadow(0 1px 6px rgba(100,80,60,0.35))',
  },
  small: {
    fx: { base: 0.42, wobble: 0.04 },
    fy: { base: 0.42, wobble: 0.04 },
    anchorDrift: 0.022,
    period: 8,
    filter: 'drop-shadow(0 3px 10px rgba(100,80,60,0.35)) drop-shadow(0 1px 4px rgba(100,80,60,0.35))',
  },
  slot: {
    fx: { base: 0.42, wobble: 0.03 },
    fy: { base: 0.42, wobble: 0.03 },
    anchorDrift: 0.018,
    period: 10,
    filter: '',
  },
}

const HP = Math.PI / 2

interface Entry {
  el: HTMLElement
  clipId: string
  pathEl: SVGPathElement
  cfg: WobblyConfig
  basePhase: number
  phase2: number
}

let svgDefs: SVGSVGElement | null = null
const entries = new Map<HTMLElement, Entry>()
let rafId = 0
let uid = 0
let frameSkip = false

function ensureSvg(): SVGSVGElement {
  if (!svgDefs) {
    svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svgDefs.setAttribute('style',
      'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')
    svgDefs.innerHTML = '<defs></defs>'
    document.body.prepend(svgDefs)
  }
  return svgDefs
}

export function registerWobbly(el: HTMLElement, preset: WobblyPreset = 'panel'): void {
  if (entries.has(el)) return

  const svg = ensureSvg()
  const defs = svg.querySelector('defs')!

  const clipId = `wob-${uid++}`
  const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
  clip.setAttribute('id', clipId)
  clip.setAttribute('clipPathUnits', 'objectBoundingBox')

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  clip.appendChild(path)
  defs.appendChild(clip)

  const cfg = PRESETS[preset]

  el.style.clipPath = `url(#${clipId})`
  // Apply shadow filter to parent so it isn't clipped by clip-path
  if (cfg.filter && el.parentElement) {
    el.parentElement.style.filter = cfg.filter
  }

  entries.set(el, {
    el,
    clipId,
    pathEl: path,
    cfg,
    basePhase: Math.random() * Math.PI * 2,
    phase2: Math.random() * Math.PI * 2,
  })

  if (entries.size === 1) rafId = requestAnimationFrame(tick)
}

export function unregisterWobbly(el: HTMLElement): void {
  const e = entries.get(el)
  if (!e) return
  el.style.clipPath = ''
  if (el.parentElement) el.parentElement.style.filter = ''
  document.getElementById(e.clipId)?.remove()
  entries.delete(el)
  if (entries.size === 0 && rafId) { cancelAnimationFrame(rafId); rafId = 0 }
}

function tick(ms: number): void {
  rafId = requestAnimationFrame(tick)
  frameSkip = !frameSkip
  if (frameSkip) return
  const t = ms / 1000
  for (const e of entries.values()) update(e, t)
}

function update(e: Entry, t: number): void {
  const w = e.el.offsetWidth
  const h = e.el.offsetHeight
  if (w === 0 || h === 0) return

  const { cfg, basePhase, phase2 } = e
  const omega = (Math.PI * 2) / cfg.period

  const osc: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const fast = Math.sin(t * omega + basePhase + i * HP)
    const slow = Math.sin(t * omega * 0.7 + phase2 + i * HP)
    osc[i] = fast * 0.7 + slow * 0.3
  }

  let fxBase = cfg.fx.base
  if (cfg.fxFromPx !== undefined) {
    fxBase = 0.5 - cfg.fxFromPx / w
  }
  const fx: [number, number, number, number] = [
    fxBase + cfg.fx.wobble * osc[1],
    fxBase + cfg.fx.wobble * osc[2],
    fxBase + cfg.fx.wobble * osc[3],
    fxBase + cfg.fx.wobble * osc[0],
  ]
  const fy: [number, number, number, number] = [
    cfg.fy.base + cfg.fy.wobble * osc[1],
    cfg.fy.base + cfg.fy.wobble * osc[2],
    cfg.fy.base + cfg.fy.wobble * osc[3],
    cfg.fy.base + cfg.fy.wobble * osc[0],
  ]

  const drift = cfg.anchorDrift
  const aT = 0.5 + drift * osc[0]
  const aR = 0.5 + drift * osc[1]
  const aB = 0.5 - drift * osc[2]
  const aL = 0.5 - drift * osc[3]

  e.pathEl.setAttribute('d', squirclePath(fx, fy, aT, aR, aB, aL))
}

function squirclePath(
  fx: [number, number, number, number],
  fy: [number, number, number, number],
  aT: number, aR: number, aB: number, aL: number,
): string {
  const Tx = aT, Ty = 0
  const Rx = 1,  Ry = aR
  const Bx = aB, By = 1
  const Lx = 0,  Ly = aL

  return (
    `M${n(Tx)} ${n(Ty)}` +
    `C${n(Tx + fx[0])} ${n(Ty)},${n(Rx)} ${n(Ry - fy[0])},${n(Rx)} ${n(Ry)}` +
    `C${n(Rx)} ${n(Ry + fy[1])},${n(Bx + fx[1])} ${n(By)},${n(Bx)} ${n(By)}` +
    `C${n(Bx - fx[2])} ${n(By)},${n(Lx)} ${n(Ly + fy[2])},${n(Lx)} ${n(Ly)}` +
    `C${n(Lx)} ${n(Ly - fy[3])},${n(Tx - fx[3])} ${n(Ty)},${n(Tx)} ${n(Ty)}Z`
  )
}

function n(v: number): string { return v.toFixed(5) }
