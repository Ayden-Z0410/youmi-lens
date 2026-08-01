/**
 * Navy brand panel — a 1:1 React port of `brandPanel()` in landing/app/auth-ui.js.
 *
 * Copy, class names, zone order (top / mid / foot) and the 28-bar waveform are
 * reproduced exactly so Desktop and Website read as one surface. Styling comes
 * entirely from src/styles/auth-shell.css, which is a byte-identical copy of the
 * Website's landing/app/auth-shell.css.
 *
 * Website difference (intentional): the wordmark links home there because those
 * pages carry no marketing nav. In the desktop app there is nowhere to link to,
 * so it renders as a plain image.
 */

/** Same bar heights as the Website's WAVE constant, in the same order. */
const WAVE = [
  7, 13, 22, 12, 19, 30, 15, 9, 24, 34, 20, 12, 17, 27, 14, 8, 20, 31, 17, 11, 23, 16, 9, 6, 15, 25,
  13, 8,
]

export function BrandPanel() {
  return (
    <div className="yl-auth-brand">
      <div className="yl-auth-brandtop">
        <img
          className="yl-auth-logo"
          src="/brand/youmi-lens-wordmark-transparent.png"
          alt="Youmi Lens"
        />
      </div>
      <div className="yl-auth-brandmid">
        <div className="yl-auth-live">
          <span className="yl-auth-rec" />
          <span className="yl-auth-livelabel">Live captions</span>
        </div>
        <p className="yl-auth-caption">Every lecture, captioned in real time.</p>
        <p className="yl-auth-caption dim">Translated as your professor speaks.</p>
        <div className="yl-auth-wave">
          {WAVE.map((h, i) => (
            <span key={i} style={{ height: `${h}px` }} />
          ))}
        </div>
      </div>
      <div className="yl-auth-brandfoot">
        <p className="yl-auth-tagline">One account, every device.</p>
        <p className="yl-auth-desc">
          Your recordings, courses, and plan stay in sync across Mac, Windows, and iPad.
        </p>
      </div>
    </div>
  )
}
