interface AICol {
  icon: string
  label: string
  title: string
  body: string
  quote?: string
}

const COLS: AICol[] = [
  {
    icon: '🎭',
    label: '01 · Identity',
    title: 'Reads your face. Picks your animal.',
    body: 'Vision + your answers feed Claude. It assigns Lion, Owl, or Giraffe — and writes a one-line verdict just for you.',
    quote: '“You blink like someone with secrets. Owl.”',
  },
  {
    icon: '👁️',
    label: '02 · Surveillance',
    title: 'Watches you in real time.',
    body: 'Face mesh and audio detect blinks, head-shakes, and roars. The Monitor locks its gaze on one player at a time and judges compliance.',
  },
  {
    icon: '📢',
    label: '03 · Narration',
    title: 'Speaks like a haunted PA system.',
    body: 'Claude writes Two-Point-Hospital-style commentary; ElevenLabs turns it into the Monitor’s voice — calm, official, lightly menacing.',
    quote: '“Please surrender your eyelids for the next three seconds.”',
  },
]

export function AISlide() {
  return (
    <>
      <h2 className="slide-title pop-in pop-delay-1">
        Where the <em>AI</em> lives
      </h2>
      <p className="slide-subtitle pop-in pop-delay-1">
        Three layers — one warden of the zoo
      </p>

      <div className="ai-row pop-in pop-delay-2" data-parallax="3">
        {COLS.map((c, i) => (
          <div key={i} className="nz-card" style={{ flex: 1 }}>
            <div className="ai-col">
              <div className="ai-col-icon">{c.icon}</div>
              <div className="ai-col-label">{c.label}</div>
              <div className="ai-col-title">{c.title}</div>
              <div className="ai-col-body">{c.body}</div>
              {c.quote && <div className="ai-col-quote">{c.quote}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="ai-stack pop-in pop-delay-3">
        <span className="nz-chip">Claude</span>
        <span className="nz-chip">MediaPipe FaceMesh</span>
        <span className="nz-chip">Web Audio</span>
        <span className="nz-chip">ElevenLabs</span>
      </div>
    </>
  )
}
