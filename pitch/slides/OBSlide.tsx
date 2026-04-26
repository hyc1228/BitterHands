import obGif from '../assets/ob-audit.gif'

export function OBSlide() {
  return (
    <>
      <div className="ob-eyebrow pop-in pop-delay-1">Cross-track challenge</div>
      <h2 className="slide-title pop-in pop-delay-1">
        How do we know the <em>AI</em> is doing what it should?
      </h2>

      <div className="media-stage pop-in pop-delay-2" data-parallax="3">
        <img
          src={obGif}
          alt="OB dashboard with violation log and live camera feeds"
          className="media-hero"
        />
      </div>

      <div className="ob-bullets pop-in pop-delay-3">
        <span className="ob-bullet">📷 every camera feed</span>
        <span className="ob-bullet">🎯 every Monitor lock</span>
        <span className="ob-bullet">🤖 every Claude verdict</span>
        <span className="ob-bullet">📜 every violation, replayable</span>
      </div>

      <p className="media-caption pop-in pop-delay-4">
        OB — the operator’s dashboard, mirrored live mid-round. Same view that runs the show is the same view that audits it.
      </p>
    </>
  )
}
