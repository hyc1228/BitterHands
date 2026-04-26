import playOnboardGif from '../assets/play-onboard.gif'
import playRoundGif from '../assets/play-round.gif'
import faceDetectMov from '../assets/face-detect.mov'

export function LiveSlide() {
  return (
    <>
      <h2 className="slide-title pop-in pop-delay-1">Live <em>demo</em></h2>
      <p className="slide-subtitle pop-in pop-delay-1">
        Three White Lions · 2 minutes · the Monitor never blinks
      </p>

      <div className="media-stage pop-in pop-delay-2" data-parallax="3">
        <div className="media-row">
          <figure className="media-cell">
            <img
              src={playOnboardGif}
              alt="Players onboarding — face scan and identity reveal"
              className="media-hero media-hero--row"
            />
            <figcaption className="media-cell-label">Onboard</figcaption>
          </figure>
          <figure className="media-cell">
            <img
              src={playRoundGif}
              alt="A live round in progress"
              className="media-hero media-hero--row"
            />
            <figcaption className="media-cell-label">Round</figcaption>
          </figure>
          <figure className="media-cell">
            <video
              src={faceDetectMov}
              className="media-hero media-hero--row"
              autoPlay
              loop
              muted
              playsInline
            />
            <figcaption className="media-cell-label">Face detect</figcaption>
          </figure>
        </div>
      </div>

      <p className="media-caption pop-in pop-delay-3">
        Onboard → 2-minute round → face detection in the loop · the Monitor never blinks
      </p>
    </>
  )
}
