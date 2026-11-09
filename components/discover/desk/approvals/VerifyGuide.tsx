"use client";

// The check guide under a send's plan and on the wallet step
// (lib/discover/safe-panel/verify-guide): a wallet's screen with one row per
// step (To, Function, Hash or Data, Amount), beside the numbered steps. Each
// step holds a title, one line and at most two full values, as text to
// select and copy; longer value lists sit in a closed section. Step 3 links the
// outside check by its full address, on its own row.
//
// When all the steps are in view, they light up in turn, 1.2 s each, each
// with its row of the screen: once per guide key (the request hash) per page
// load, so a revisit shows at rest. With reduced motion nothing moves. A
// request whose hash differs from its fields shows the stop line alone.

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  GUIDE_WORDS,
  type GuideValue,
  type VerifyGuideModel,
} from "@/lib/discover/safe-panel/verify-guide";

/** The guide keys that played in this page load. */
const PLAYED = new Set<string>();

function Values({ values }: { values: readonly GuideValue[] }) {
  if (values.length === 0) return null;
  return (
    <dl className="sec-vg-values">
      {values.map((v) => (
        <div className="sec-vg-value" key={v.label}>
          <dt>{v.label}</dt>
          <dd>
            <code>{v.value}</code>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function VerifyGuide({ model }: { model: VerifyGuideModel }) {
  const list = useRef<HTMLOListElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const key = model.key;
  useEffect(() => {
    // A browser without IntersectionObserver shows the guide at rest.
    const el = list.current;
    if (!el || PLAYED.has(key) || typeof IntersectionObserver === "undefined")
      return;
    const io = new IntersectionObserver(
      (seen) => {
        if (!seen.some((e) => e.isIntersecting) || PLAYED.has(key)) return;
        PLAYED.add(key);
        setPlaying(key);
        io.disconnect();
      },
      { threshold: 1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [key]);

  if (!model.matches)
    return (
      <p className="sec-error" role="alert">
        {GUIDE_WORDS.mismatch}
      </p>
    );
  return (
    <section
      className={
        playing === key ? "sec-box sec-vg sec-vg-on" : "sec-box sec-vg"
      }
      aria-labelledby="sec-vg-head"
    >
      <h2 className="sec-box-head" id="sec-vg-head">
        {model.title}
      </h2>
      <div className="sec-vg-grid">
        <div className="sec-vg-device" aria-hidden="true">
          <span className="sec-vg-speaker" />
          <span className="sec-vg-screen">
            {model.steps.map((s) => (
              <span className="sec-vg-row" key={s.row}>
                <span className="sec-vg-row-label">{s.row}</span>
                <span className="sec-vg-bar" />
              </span>
            ))}
          </span>
        </div>
        <ol className="sec-vg-steps" ref={list}>
          {model.steps.map((s, i) => (
            <li className="sec-vg-step" key={s.title}>
              <span className="sec-vg-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="sec-vg-text">
                <h3 className="sec-vg-title">{s.title}</h3>
                <p className="sec-vg-line">{s.line}</p>
                {s.link && (
                  <p className="sec-vg-line sec-vg-link">
                    <a href={s.link} target="_blank" rel="noopener noreferrer">
                      {s.link}
                    </a>
                  </p>
                )}
                <Values values={s.values} />
                {s.more && (
                  <details className="sec-vg-more">
                    <summary>
                      {s.more.label}
                      <ChevronDown className="sec-chev" aria-hidden="true" />
                    </summary>
                    <Values values={s.more.values} />
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
