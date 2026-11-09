/* CRX brand lockup — the fat mark beside the wordmark.
   Single source of truth for both headers and anywhere else the logo appears.

   The fat logo is the THICK ROUNDED-BARS asterisk: three bars 13 units wide
   with rounded ends, crossing at 60°, exactly as served on the crxfx.com
   production landing header. A pointed six-arm filled star circulated in this
   repo for a while under the same "fat" name — that labeling was wrong, and
   the pointed star is eliminated everywhere.

   Colours are the logo kit's (crx-horizontal-light.svg): the mark in flat
   teal, the word in ink. A dark ground sets --crx-logo-ink to white; the
   mark stays teal on every ground. */

// One bar of the asterisk, drawn vertical; the other two are 60° rotations.
const BAR =
  "M6.5,-33.5L6.5,33.5C6.5,37.08995 3.58995,40 0,40C-3.58995,40 -6.5,37.08995 -6.5,33.5L-6.5,-33.5C-6.5,-37.08995 -3.58995,-40 0,-40C3.58995,-40 6.5,-37.08995 6.5,-33.5Z";

const LOGO_MARK = "var(--crx-logo-mark, #00c5c2)";
const LOGO_INK = "var(--crx-logo-ink, #1e1e2a)";

/* The filled CRX mark — the thick rounded-bars asterisk in flat teal on
   every ground. Sized by className. */
export function CrxLogoFilled({ className }: { className?: string }) {
  return (
    <svg viewBox="-40 -44 80 88" className={className} style={{ fill: LOGO_MARK }} role="img" aria-label="CRX">
      <path d={BAR} />
      <path transform="rotate(60)" d={BAR} />
      <path transform="rotate(-60)" d={BAR} />
    </svg>
  );
}

// THE unified header lockup: the fat rounded-bars mark + Montserrat-700 "CRX"
// tracked 0.42em (the production landing's own values), plus an optional teal
// product sub-label (e.g. "Scan", "Portal", "Data Room", "Rates"). Every
// top-nav across the frontend renders this one component so the brand can
// never drift again.
export function Logo({
  className = "",
  markClassName = "h-5 w-5",
  textClassName = "text-[17px]",
  sublabel,
  sublabelClassName = "",
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  sublabel?: string;
  sublabelClassName?: string;
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <CrxLogoFilled className={markClassName} />
      <span
        className={`${textClassName} font-bold`}
        style={{
          fontFamily: "var(--font-mont-brand), system-ui, sans-serif",
          letterSpacing: "0.42em",
          marginRight: "-0.42em",
          color: LOGO_INK,
        }}
      >
        CRX
      </span>
      {sublabel ? (
        <span
          className={`${textClassName} font-semibold ${sublabelClassName}`}
          style={{
            fontFamily: "var(--font-mont-brand), system-ui, sans-serif",
            letterSpacing: "0.06em",
            color: LOGO_MARK,
          }}
        >
          {sublabel}
        </span>
      ) : null}
    </span>
  );
}
