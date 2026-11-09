"use client";

// One plain line under a control of the firm approvals page
// (lib/discover/safe-panel/action-hints). The control holds it as its last
// child and names it in aria-describedby; the line is aria-hidden, so the
// control's name stays its label. approvals.css draws it:
//
//   hover pointer  a tip over the control: in after 600 ms of hover, at once
//                  on keyboard focus; opacity only; Escape hides it until
//                  the pointer or the focus comes back
//   touch          small secondary text under the label, always shown

import { useEffect, useRef, useState } from "react";

/** The id of a control's line, for its aria-describedby. */
export const hintId = (key: string) => `sec-hint-${key.replace(/[^a-z0-9]+/gi, "-")}`;

export function ActionHint({ id, text }: { id: string; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    const owner = ref.current?.parentElement;
    if (!owner) return;
    const hide = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOff(true);
    };
    const reset = () => setOff(false);
    document.addEventListener("keydown", hide);
    owner.addEventListener("pointerenter", reset);
    owner.addEventListener("focus", reset);
    return () => {
      document.removeEventListener("keydown", hide);
      owner.removeEventListener("pointerenter", reset);
      owner.removeEventListener("focus", reset);
    };
  }, []);
  return (
    <span ref={ref} id={id} className="sec-ahint" aria-hidden="true" data-off={off || undefined}>
      {text}
    </span>
  );
}
