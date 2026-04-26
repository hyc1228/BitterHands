import { QRCodeSVG } from 'qrcode.react'

/** Live URL the QR encodes. Swap if the host changes. */
const JOIN_URL = 'https://nocturne-zoo.hyc1228.partykit.dev/'
const ROOM_CODE = 'hackathon'
const MAX_PLAYERS = 10

export function QRSlide() {
  return (
    <>
      <span className="hook-bracket hook-bracket--tl" aria-hidden />
      <span className="hook-bracket hook-bracket--tr" aria-hidden />
      <span className="hook-bracket hook-bracket--bl" aria-hidden />
      <span className="hook-bracket hook-bracket--br" aria-hidden />

      <div className="qr-stage">
        <h2 className="qr-headline pop-in pop-delay-1">
          Your phone is the <em>controller</em>.
        </h2>

        <div className="qr-frame pop-in pop-delay-2" data-parallax="4">
          <QRCodeSVG
            value={JOIN_URL}
            level="H"
            marginSize={2}
            bgColor="#f2efe9"
            fgColor="#0a0a0a"
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>

        <p className="qr-cta pop-in pop-delay-3">
          Scan to join ·{' '}
          <span className="qr-url">{JOIN_URL.replace(/^https?:\/\//, '')}</span>
        </p>

        <div className="qr-extras pop-in pop-delay-4">
          <div className="qr-stamp">
            <div className="qr-stamp__label">Room code</div>
            <div className="qr-stamp__code">{ROOM_CODE}</div>
          </div>
          <div className="qr-limit">
            <span className="qr-limit__icon" aria-hidden>👥</span>
            <span className="qr-limit__text">
              First <strong>{MAX_PLAYERS}</strong> players only
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
