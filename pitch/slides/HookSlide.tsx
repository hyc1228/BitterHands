export function HookSlide() {
  return (
    <>
      <span className="hook-bracket hook-bracket--tl" aria-hidden />
      <span className="hook-bracket hook-bracket--tr" aria-hidden />
      <span className="hook-bracket hook-bracket--bl" aria-hidden />
      <span className="hook-bracket hook-bracket--br" aria-hidden />

      <div className="hook-rec pop-in pop-delay-1" aria-hidden>
        REC · LIVE
      </div>

      <div className="hook-stage">
        <div className="hook-eyebrow pop-in pop-delay-1">Junction 2026</div>

        <h1 className="hook-title pop-in pop-delay-2" data-parallax="3">
          NOCTURNE ZOO
        </h1>

        <div className="hook-animals pop-in pop-delay-3" data-parallax="6">
          <span className="hook-animal" role="img" aria-label="lion">🦁</span>
          <span className="hook-animal" role="img" aria-label="owl">🦉</span>
          <span className="hook-animal" role="img" aria-label="giraffe">🦒</span>
        </div>

        <p className="hook-tag pop-in pop-delay-4">
          A <em>2-minute</em> AI horror social game — played on your phone.
        </p>

        <p className="hook-foot pop-in pop-delay-5">
          5–10 players · obey the rules · survive the gaze
        </p>
      </div>
    </>
  )
}
