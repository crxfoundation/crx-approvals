"use client";

// The firm's approvals, in the KYB client frame: the navy band with the CRX
// lockup, the firm's wordmark (its name in a pill without one) and one
// title; one narrow panel under it; one primary button at the panel's foot,
// right. The screens and their order are lib/discover/safe-panel/
// firm-view's (FirmScreen, firmMove):
//
//   connect   live only: Connect wallet
//   home      the requests waiting for the firm (Review request), the
//             firm's own open proposals, the scheduled changes (Run once
//             ready), then "Your seat": one row per wallet, with its icon
//   account   the wallet's approvals and keys, then a tile per action
//   inputs    step 1 of 3: the action's choices
//   review    step 1 of 3: the plan, its effect, Needed, Takes effect and
//             the exact calls under Details; Approve (or Execute), Run or
//             Continue; Decline in the staff preview only
//   sign      step 2 of 3: the wallet step, with the address the wallet
//             sends to
//   decline   step 2 of 3: the decline line and an optional reason
//   done      step 3 of 3: the outcome
//
// The driver (lib/discover/safe-panel/firm-driver) reads and sends. The
// preview driver (`preview` set) runs on sample facts: "Mark as signed" in
// CRX's preview line under the panel stands in for the wallet. The live
// driver (`preview` null) reads and sends through the firm's own wallet
// alone, and every screen shows the wallets' full addresses for Safe{Wallet}.
// An action on a wallet the connected wallet holds no key on shows its plan
// and takes no start. A network that takes no send turns every send button
// off. This file and its imports load no next/* module: the static page
// bundles them as they are.
//
// A screen's buttons take no click in their first 300 ms, so a double click
// stops at the screen it opened. On a screen change the band's title takes
// focus. The times print from the server's clock (`now`), so the server's
// markup and the browser's agree.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { Hex } from "viem";
import { CrxLogoFilled } from "@/components/Logo";
import {
  actionTitle,
  COPY,
  DRIVER_ERRORS,
  neededOf,
  noKeyLine,
  othersLine,
  outcomeLine,
  previewBanner,
  rangeLine,
  shortAddress,
  takesEffectLine,
  waitingLine,
  waitsLine,
} from "@/lib/discover/safe-panel/copy";
import type {
  ActionCall,
  ActionField,
  ActionPlan,
  Connection,
  FirmDriver,
  GroupId,
  ScheduledChange,
  Seat,
  SendResult,
  WalletAction,
} from "@/lib/discover/safe-panel/firm-driver";
import {
  FIRM_LIVE_START,
  FIRM_START,
  actionsOf,
  etWhen,
  fieldProblem,
  fieldsReady,
  firmMove,
  shownFields,
  shownValues,
  firmRead,
  groupOf,
  keyHolders,
  stepBar,
  waitingRequests,
  type FirmMove,
  type FirmRequest,
  type FirmScreen,
  type FirmState,
  type FirmSubject,
} from "@/lib/discover/safe-panel/firm-view";
import type { PreviewDriver } from "@/lib/discover/safe-panel/firm-preview";
import { ActionIcon, GroupIcon } from "./firm-icons";
import { ActionHint, hintId } from "./ActionHint";
import {
  actionHint,
  BUTTON_HINTS,
  SCHEDULED_HINT,
  SEAT_HINTS,
} from "@/lib/discover/safe-panel/action-hints";
import { WalletKeys } from "./WalletKeys";
import { VerifyGuide } from "./VerifyGuide";
import { verifyGuide } from "@/lib/discover/safe-panel/verify-guide";
import "./approvals.css";

const GUARD_MS = 300;

/** A firm the preview line links to: its key, its name and its page. */
export interface ApprovalsFirm {
  key: string;
  label: string;
  href: string;
}

/** The preview's frame: the firm shown, its wordmark, the other preview
 *  firms and the address of Close preview. */
export interface ApprovalsPreview {
  firm: string;
  firmKey: string;
  /** The firm's wordmark address; null shows the name in the pill. */
  logo?: string | null;
  firms: readonly ApprovalsFirm[];
  closeHref: string;
  /** False: no CRX preview line under the panel (the demo). */
  staff?: boolean;
}

/** A wallet's full address, for the live page's Safe{Wallet} line. */
export interface SafeLink {
  group: GroupId;
  address: string;
}

type Row = { label: string; value: ReactNode };

const actionKey = (a: WalletAction) => `${a.group}:${a.id}`;
const subjectKey = (x: FirmSubject) =>
  x.type === "start"
    ? `start:${actionKey(x.action)}:${JSON.stringify(x.values)}`
    : `${x.type}:${x.id}`;

/** A failure's code and its line: one per driver code. */
function failOf(e: unknown): { code: string | null; line: string } {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && Object.hasOwn(DRIVER_ERRORS, code)
    ? { code, line: DRIVER_ERRORS[code as keyof typeof DRIVER_ERRORS] }
    : { code: null, line: COPY.WALLET_FAILED };
}

/** A field's chosen value as the review shows it: the option's label; an
 *  option whose line is an address (a key, a member), that address in full. */
function shownValue(f: ActionField, v: string | undefined): string {
  if (!v) return COPY.UNKNOWN;
  if (f.kind === "choice") {
    const o = f.options.find((x) => x.value === v);
    if (!o) return v;
    return o.line && /^0x[0-9a-fA-F]{40}$/.test(o.line) ? o.line : o.label;
  }
  return f.kind === "number" && f.unit ? `${v} ${f.unit}` : v;
}

function Box({
  head,
  label,
  rows,
}: {
  head?: string;
  label?: string;
  rows: readonly Row[];
}) {
  return (
    <section className="sec-box" aria-label={head ?? label}>
      {head && <h2 className="sec-box-head">{head}</h2>}
      <dl className="sec-rows">
        {rows.map((r) => (
          <div className="sec-row" key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Steps({ labels, at }: { labels: readonly string[]; at: number }) {
  return (
    <>
      <ol
        className="sec-progress"
        aria-label={`Step ${at + 1} of ${labels.length}`}
      >
        {labels.map((l, i) => (
          <li
            key={l}
            className={
              i < at || at === labels.length - 1 ? "sec-done" : undefined
            }
            aria-current={i === at ? "step" : undefined}
          >
            <span>{l}</span>
          </li>
        ))}
      </ol>
      <p className="sec-step-of" aria-hidden="true">
        Step {at + 1} of {labels.length}: {labels[at]}
      </p>
    </>
  );
}

/** The exact calls of a plan, collapsed. */
function Details({ calls }: { calls: readonly ActionCall[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="sec-details">
      <summary>
        {COPY.FIRM_DETAILS}
        <ChevronDown className="sec-chev" aria-hidden="true" />
      </summary>
      {calls.map((c, i) => (
        <dl className="sec-call" key={`${c.to}:${c.fn}:${i}`}>
          <dt>{COPY.FIRM_CONTRACT}</dt>
          <dd>
            {c.name}
            <code>{c.to}</code>
          </dd>
          <dt>{COPY.FIRM_FUNCTION}</dt>
          <dd>
            <code>{c.fn}</code>
          </dd>
          {c.args.map((a) => (
            <div className="sec-row" key={a.name}>
              <dt>{a.name}</dt>
              <dd>
                <code>{a.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </details>
  );
}

/** One field of an action's choices: choice tiles, an address or a number. */
function Field({
  field,
  value,
  onValue,
}: {
  field: ActionField;
  value: string | undefined;
  onValue: (v: string) => void;
}) {
  const problem = fieldProblem(field, value);
  if (field.kind === "choice") {
    return (
      <fieldset className="sec-choices-set">
        <legend className="sec-field-label">{field.label}</legend>
        {field.options.length === 0 ? (
          <p className="sec-none">{COPY.FIRM_EMPTY_CHOICE}</p>
        ) : (
          <div className="sec-choices">
            {field.options.map((o) => (
              <label key={o.value} className="sec-choice">
                <input
                  type="radio"
                  name={`sec-${field.id}`}
                  value={o.value}
                  checked={value === o.value}
                  onChange={() => onValue(o.value)}
                />
                <span className="sec-choice-title">{o.label}</span>
                {o.line && <span className="sec-choice-line">{o.line}</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    );
  }
  const id = `sec-f-${field.id}`;
  return (
    <div className="sec-field">
      <label className="sec-field-label" htmlFor={id}>
        {field.label}
      </label>
      <input
        id={id}
        className="sec-input"
        type="text"
        inputMode={field.kind === "number" ? "decimal" : "text"}
        autoComplete="off"
        spellCheck={false}
        value={value ?? ""}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-line`}
        onChange={(e) => onValue(e.target.value.trim())}
      />
      <p id={`${id}-line`} className={problem ? "sec-field-error" : "sec-hint"}>
        {problem ??
          (field.kind === "number"
            ? rangeLine(field.min, field.max, field.unit)
            : COPY.ADDRESS_FULL)}
      </p>
    </div>
  );
}

/** A wallet's page in Safe{Wallet}. */
const safeHref = (address: string) =>
  `https://app.safe.global/home?safe=eth:${address}`;

export function FirmApprovals({
  driver,
  preview,
  now,
  safes = [],
}: {
  driver: FirmDriver;
  preview: ApprovalsPreview | null;
  now: number;
  safes?: readonly SafeLink[];
}) {
  const live = preview === null;
  const [state, setState] = useState<FirmState>(
    live ? FIRM_LIVE_START : FIRM_START,
  );
  const [run, setRun] = useState(0);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [seats, setSeats] = useState<readonly Seat[] | null>(null);
  const [readFail, setReadFail] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectFail, setConnectFail] = useState<string | null>(null);
  const [fields, setFields] = useState<{
    key: string;
    list: readonly ActionField[];
  } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFail, setOpenFail] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ key: string; plan: ActionPlan } | null>(
    null,
  );
  const [planFail, setPlanFail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [inputFail, setInputFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [fail, setFail] = useState<{
    code: string | null;
    line: string;
  } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const changed = useRef(0);
  const call = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const names = preview ? preview.firms.map((f) => f.label) : [];
  const sends = live ? connection?.sends === true : true;

  const guarded = () => Date.now() - changed.current < GUARD_MS;
  const moveTo = (next: FirmState) => {
    changed.current = Date.now();
    setState(next);
  };
  const dropSend = () => {
    call.current++;
    setBusy(false);
    setSent(false);
    setFail(null);
  };

  const go = (move: FirmMove) => () => {
    if (guarded()) return;
    const next = firmMove(state, move);
    if (next === state) return;
    if (move.to === "back") dropSend();
    moveTo(next);
  };

  const seatOf = (g: GroupId) => seats?.find((s) => s.group === g) ?? null;
  /** True when the connected wallet holds a key on the wallet. */
  const holdsKey = (g: GroupId) => seatOf(g)?.mine === true;

  // A send starts in the click that opens the wallet step, so the wallet's
  // window opens on the firm's own press. A result after Back is dropped.
  const send = (sc: FirmScreen, s: FirmState) => {
    if (sc.kind !== "sign") return;
    const x = sc.subject;
    let p: Promise<SendResult>;
    try {
      if (x.type === "start") p = driver.start(x.action, x.values);
      else if (x.type === "run") p = driver.run(x.id as Hex);
      else
        p = s.requests.find((r) => r.id === x.id)?.executes
          ? driver.execute(x.id as Hex)
          : driver.approve(x.id as Hex);
    } catch (e) {
      p = Promise.reject(e);
    }
    const id = ++call.current;
    setBusy(true);
    setSent(false);
    setFail(null);
    setResult(null);
    p.then(
      (r) => {
        if (id !== call.current) return;
        setBusy(false);
        setResult(r);
        changed.current = Date.now();
        setState((st) => firmMove(st, { to: "confirm" }));
      },
      (e: unknown) => {
        if (id !== call.current) return;
        setBusy(false);
        setFail(failOf(e));
      },
    );
  };

  useEffect(() => {
    const off = driver.onSent(() => setSent(true));
    return () => {
      off();
    };
  }, [driver]);

  const toWallet = () => {
    if (guarded() || !sends) return;
    const next = firmMove(state, { to: "approve" });
    if (next === state) return;
    moveTo(next);
    send(next.screen, next);
  };

  const openAction = (a: WalletAction) => {
    if (guarded() || opening) return;
    const key = actionKey(a);
    setOpening(key);
    setOpenFail(null);
    driver.fields(a).then(
      (list) => {
        setOpening(null);
        setFields({ key, list });
        moveTo(
          firmMove(state, { to: "action", action: a, inputs: list.length > 0 }),
        );
      },
      (e: unknown) => {
        setOpening(null);
        setOpenFail(failOf(e).line);
      },
    );
  };

  const setValue = (id: string, value: string) => {
    setInputFail(null);
    setState((s) => firmMove(s, { to: "value", id, value }));
  };

  // Continue from the choices reads the plan first: a choice the action
  // needs and lacks, or an action that does not apply now, shows its line
  // here.
  const toReview = () => {
    const sc = state.screen;
    if (guarded() || checking || sc.kind !== "inputs") return;
    const list = fields?.key === actionKey(sc.action) ? fields.list : [];
    const values = shownValues(list, sc.values);
    setChecking(true);
    setInputFail(null);
    driver.plan(sc.action, values).then(
      (p) => {
        setChecking(false);
        setPlan({
          key: subjectKey({
            type: "start",
            action: sc.action,
            values,
            inputs: true,
          }),
          plan: p,
        });
        setPlanFail(null);
        moveTo(firmMove(state, { to: "continue", fields: list }));
      },
      (e: unknown) => {
        setChecking(false);
        const f = failOf(e);
        setInputFail(
          f.code === "changed"
            ? COPY.FIRM_FILL_FIELDS
            : f.code === null
              ? COPY.FIRM_PLAN_FAILED
              : f.line,
        );
      },
    );
  };

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectFail(null);
    try {
      const c = await driver.connect();
      setConnection(c);
      moveTo(firmMove(state, { to: "connected" }));
    } catch (e) {
      setConnectFail(failOf(e).line);
    } finally {
      setConnecting(false);
    }
  };

  // Home reads the wallets, the requests and the scheduled changes, each
  // on its own: a part that reads shows when another fails.
  const read = useCallback(async () => {
    setReading(true);
    setReadFail(null);
    const [s, r, c] = await Promise.allSettled([
      driver.seats(),
      driver.requests(),
      driver.scheduled(),
    ]);
    if (s.status === "fulfilled") setSeats(s.value);
    setState((st) =>
      st.screen.kind === "home"
        ? firmRead(
            st,
            r.status === "fulfilled" ? r.value : null,
            c.status === "fulfilled" ? c.value : null,
          )
        : st,
    );
    const failed = [s, r, c].find((x) => x.status === "rejected");
    setReadFail(
      failed ? failOf((failed as PromiseRejectedResult).reason).line : null,
    );
    setReading(false);
  }, [driver]);

  const atHome = state.screen.kind === "home";
  useEffect(() => {
    if (atHome && (!live || connection)) void read();
  }, [live, connection, atHome, read]);

  // A start's plan, read for its values on the review.
  const sc = state.screen;
  const startSubject =
    sc.kind !== "connect" &&
    sc.kind !== "home" &&
    sc.kind !== "account" &&
    sc.kind !== "inputs" &&
    sc.subject.type === "start"
      ? sc.subject
      : null;
  const startKey = startSubject ? subjectKey(startSubject) : null;
  useEffect(() => {
    if (!startSubject || !startKey || plan?.key === startKey) return;
    let gone = false;
    setPlanFail(null);
    driver.plan(startSubject.action, startSubject.values).then(
      (p) => {
        if (!gone) setPlan({ key: startKey, plan: p });
      },
      (e: unknown) => {
        if (!gone) {
          const f = failOf(e);
          setPlanFail(f.code === null ? COPY.FIRM_PLAN_FAILED : f.line);
        }
      },
    );
    return () => {
      gone = true;
    };
  }, [startKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new screen: its title takes focus and names the tab, so a screen
  // reader reads it first. A choice stays on its screen.
  const screenKey =
    sc.kind === "account"
      ? `account:${sc.group}`
      : sc.kind === "inputs"
        ? `inputs:${actionKey(sc.action)}`
        : sc.kind === "connect" || sc.kind === "home"
          ? sc.kind
          : `${sc.kind}:${subjectKey(sc.subject)}`;
  useEffect(() => {
    const bar = stepBar(state);
    const h = title.current?.textContent ?? "";
    document.title = `${bar ? `Step ${bar.at + 1} of 3: ` : ""}${h} · CRX`;
    if (first.current) {
      first.current = false;
      return;
    }
    title.current?.focus();
    title.current?.closest(".sec-flow")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [screenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    dropSend();
    setResult(null);
    setState(FIRM_START);
    setRun((n) => n + 1);
  };

  const markSigned = () => {
    if (guarded() || driver.kind !== "preview") return;
    (driver as PreviewDriver).markSigned();
  };

  const toHome = () => {
    dropSend();
    moveTo(firmMove(state, { to: "home" }));
  };

  const firmLabel = preview
    ? preview.firm
    : connection
      ? (connection.firm?.label ?? shortAddress(connection.account))
      : null;
  const logo = preview
    ? (preview.logo ?? null)
    : (connection?.firm?.logo ?? null);
  const waiting = waitingRequests(state);
  const backLink = (
    <button type="button" className="sec-link" onClick={go({ to: "back" })}>
      {COPY.FIRM_BACK}
    </button>
  );
  const offLine = (g: GroupId, all = false) => (
    <p className="sec-note">
      {groupOf(g).firmKeys
        ? noKeyLine(groupOf(g).role)
        : all
          ? COPY.FIRM_START_OFF_CRX_ALL
          : COPY.FIRM_START_OFF_CRX}
    </p>
  );

  /** The subject of a review, wallet or done screen, as the page shows it. */
  const subjectView = (
    x: FirmSubject,
  ): {
    title: string;
    effect: string;
    done: string;
    group: GroupId | null;
    needed: number;
    delayHours: number;
    calls: readonly ActionCall[];
    to: string | null;
    number: number | null;
    request: FirmRequest | null;
    change: ScheduledChange | null;
  } | null => {
    if (x.type === "request") {
      const r = state.requests.find((q) => q.id === x.id) ?? null;
      return (
        r && {
          title: r.title,
          effect: r.effect,
          done: r.done,
          group: r.group,
          needed: r.needed,
          delayHours: r.delayHours,
          calls: r.calls,
          to: r.to,
          number: r.number,
          request: r,
          change: null,
        }
      );
    }
    if (x.type === "run") {
      const c = state.scheduled.find((q) => q.id === x.id) ?? null;
      return (
        c && {
          title: c.plan.title,
          effect: c.plan.effect,
          done: c.plan.done,
          group: null,
          needed: c.plan.needed,
          delayHours: c.plan.delayHours,
          calls: c.plan.calls,
          to: c.plan.safe,
          number: null,
          request: null,
          change: c,
        }
      );
    }
    const p = plan?.key === subjectKey(x) ? plan.plan : null;
    const seat = seatOf(x.action.group);
    return {
      title: p?.title ?? actionTitle(x.action),
      effect: p?.effect ?? "",
      done: p?.done ?? "",
      group: x.action.group,
      needed: p?.needed ?? groupOf(x.action.group).needed,
      delayHours: p?.delayHours ?? 0,
      calls: p?.calls ?? [],
      to: p?.safe ?? seat?.safe ?? null,
      number: p ? p.number : null,
      request: null,
      change: null,
    };
  };

  let head: string = COPY.FIRM_TITLE;
  let body: ReactNode = null;
  let foot: ReactNode = null;

  if (sc.kind === "connect") {
    body = (
      <>
        <p className="sec-none">{COPY.FIRM_CONNECT_LINE}</p>
        {connectFail && (
          <p className="sec-error" role="alert">
            {connectFail}
          </p>
        )}
      </>
    );
    foot = (
      <button
        type="button"
        className="sec-cta"
        onClick={connect}
        disabled={connecting}
      >
        {COPY.CONNECT_WALLET}
      </button>
    );
  } else if (sc.kind === "home") {
    const next = waiting[0];
    const rows = (seats ?? []).map((s) => ({
      group: s.group,
      value: groupOf(s.group).firmKeys
        ? `${s.needed} of ${s.keys}`
        : COPY.FIRM_CRX_ONLY,
      noKey: groupOf(s.group).firmKeys && !s.mine,
    }));
    body = (
      <>
        {readFail && (
          <>
            <p className="sec-error" role="alert">
              {readFail}
            </p>
            <div className="sec-foot sec-foot-tight">
              <button
                type="button"
                className="sec-btn"
                onClick={() => void read()}
                disabled={reading}
              >
                {COPY.READ_AGAIN}
              </button>
            </div>
          </>
        )}
        {seats === null && !readFail ? (
          <p className="sec-none">{COPY.FIRM_READING}</p>
        ) : next ? (
          <>
            <p className="sec-eyebrow">{waitingLine(waiting.length)}</p>
            <Box
              head={next.title}
              rows={[
                { label: COPY.FIRM_ACCOUNT, value: groupOf(next.group).role },
                {
                  label: COPY.FIRM_APPROVED_SO_FAR,
                  value: neededOf(next.approvals, next.needed),
                },
                ...(next.waitsFor !== null
                  ? [{ label: COPY.FIRM_WAITS, value: waitsLine(next.waitsFor) }]
                  : []),
              ]}
            />
            <div className="sec-foot sec-foot-tight">
              <button
                type="button"
                className="sec-cta"
                onClick={go({ to: "review" })}
                aria-describedby={hintId("review")}
              >
                {COPY.FIRM_REVIEW}
                <ActionHint
                  id={hintId("review")}
                  text={BUTTON_HINTS.review}
                />
              </button>
            </div>
          </>
        ) : (
          seats !== null && <p className="sec-none">{COPY.FIRM_NONE_WAITING}</p>
        )}
        {state.others.length > 0 && (
          <section className="sec-box" aria-labelledby="sec-others">
            <h2 className="sec-box-head" id="sec-others">
              {COPY.FIRM_OTHERS_HEAD}
            </h2>
            <ul className="sec-acts">
              {state.others.map((r) => (
                <li key={r.id} className="sec-act">
                  <GroupIcon group={r.group} />
                  <span className="sec-act-title">{r.title}</span>
                  <span className="sec-act-value">
                    {othersLine(r.approvals, r.needed)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {state.scheduled.length > 0 && (
          <section className="sec-box" aria-labelledby="sec-scheduled">
            <h2 className="sec-box-head" id="sec-scheduled">
              {COPY.FIRM_SCHEDULED_HEAD}
            </h2>
            <ul className="sec-seat">
              {state.scheduled.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="sec-seat-row sec-sched-row"
                    onClick={go({ to: "run", id: c.id })}
                    aria-describedby={hintId(`sched-${c.id}`)}
                  >
                    <span className="sec-seat-role">{c.plan.title}</span>
                    <span className="sec-seat-value">
                      {c.ready ? (
                        <span className="sec-tag sec-tag-on">
                          {COPY.FIRM_READY}
                        </span>
                      ) : (
                        etWhen(now, c.readyAt * 1000)
                      )}
                      <ChevronRight className="sec-chev" aria-hidden="true" />
                    </span>
                    <ActionHint
                      id={hintId(`sched-${c.id}`)}
                      text={SCHEDULED_HINT}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {rows.length > 0 && (
          <section className="sec-box" aria-labelledby="sec-seat">
            <h2 className="sec-box-head" id="sec-seat">
              {COPY.FIRM_SEAT_HEAD}
            </h2>
            <ul className="sec-seat">
              {rows.map((r) => (
                <li key={r.group}>
                  <button
                    type="button"
                    className="sec-seat-row sec-seat-icon"
                    onClick={go({ to: "account", group: r.group })}
                    aria-describedby={hintId(`seat-${r.group}`)}
                  >
                    <GroupIcon group={r.group} />
                    <span className="sec-seat-role">
                      {groupOf(r.group).role}
                    </span>
                    <span className="sec-seat-value">
                      <span>
                        {r.value}
                        {r.noKey && (
                          <span className="sec-tag">{COPY.FIRM_NO_KEY}</span>
                        )}
                      </span>
                      <ChevronRight className="sec-chev" aria-hidden="true" />
                    </span>
                    <ActionHint
                      id={hintId(`seat-${r.group}`)}
                      text={SEAT_HINTS[r.group]}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  } else if (sc.kind === "account") {
    const g = groupOf(sc.group);
    const seat = seatOf(g.id);
    const needed = seat ? `${seat.needed} of ${seat.keys}` : COPY.UNKNOWN;
    const keys = live
      ? seat
        ? String(seat.keys)
        : COPY.UNKNOWN
      : keyHolders(g, names);
    head = g.role;
    body = (
      <>
        <Box
          head={g.label}
          rows={[
            { label: COPY.FIRM_NEEDED, value: needed },
            { label: COPY.FIRM_KEYS, value: keys },
          ]}
        />
        {!holdsKey(g.id) && offLine(g.id, true)}
        {openFail && (
          <p className="sec-error" role="alert">
            {openFail}
          </p>
        )}
        <section aria-labelledby="sec-actions">
          <h2 className="sec-box-head" id="sec-actions">
            {COPY.FIRM_ACTIONS}
          </h2>
          <ul className="sec-tiles">
            {actionsOf(g.id).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="sec-tile"
                  onClick={() => openAction(a)}
                  disabled={opening !== null}
                  aria-busy={opening === actionKey(a) || undefined}
                  aria-describedby={hintId(`tile-${actionKey(a)}`)}
                >
                  <ActionIcon action={a.id} />
                  <span className="sec-tile-title">{actionTitle(a)}</span>
                  <ActionHint
                    id={hintId(`tile-${actionKey(a)}`)}
                    text={actionHint(a)}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </>
    );
    foot = backLink;
  } else if (sc.kind === "inputs") {
    const list = fields?.key === actionKey(sc.action) ? fields.list : [];
    head = actionTitle(sc.action);
    body = (
      <>
        <WalletKeys
          action={sc.action}
          seat={seatOf(sc.action.group)}
          account={
            connection?.account ??
            (driver.kind === "preview"
              ? (driver as PreviewDriver).account
              : null)
          }
        />
        <div className="sec-inputs">
          {shownFields(list, sc.values).map((f) => (
            <Field
              key={f.id}
              field={f}
              value={sc.values[f.id]}
              onValue={(v) => setValue(f.id, v)}
            />
          ))}
        </div>
        {inputFail && (
          <p className="sec-error sec-error-after" role="alert">
            {inputFail}
          </p>
        )}
      </>
    );
    foot = (
      <>
        {backLink}
        <button
          type="button"
          className="sec-cta"
          onClick={toReview}
          disabled={!fieldsReady(list, sc.values) || checking}
          aria-describedby={hintId("choices")}
        >
          {COPY.FIRM_CONTINUE}
          <ActionHint id={hintId("choices")} text={BUTTON_HINTS.choices} />
        </button>
      </>
    );
  } else {
    const x = sc.subject;
    const v = subjectView(x);
    const role = v?.group ? groupOf(v.group).role : null;
    const seat = v?.group ? seatOf(v.group) : null;
    const valueRows: Row[] =
      x.type === "start"
        ? shownFields(
            fields?.key === actionKey(x.action) ? fields.list : [],
            x.values,
          ).map((f) => ({
            label: f.label,
            value: shownValue(f, x.values[f.id]),
          }))
        : [];
    const planRows = (): Row[] => {
      if (!v) return [];
      const rows: Row[] = [...valueRows];
      if (role) rows.push({ label: COPY.FIRM_ACCOUNT, value: role });
      if (v.request)
        rows.push({
          label: COPY.FIRM_APPROVED_SO_FAR,
          value: neededOf(v.request.approvals, v.request.needed),
        });
      else if (x.type === "start")
        rows.push({
          label: COPY.FIRM_NEEDED,
          value: seat ? `${seat.needed} of ${seat.keys}` : String(v.needed),
        });
      if (v.change)
        rows.push({
          label: COPY.FIRM_CAN_RUN,
          value: v.change.ready
            ? COPY.FIRM_NOW
            : etWhen(now, v.change.readyAt * 1000),
        });
      else
        rows.push({
          label: COPY.FIRM_TAKES_EFFECT,
          value: takesEffectLine(v.needed, v.delayHours),
        });
      if (v.number !== null)
        rows.push({ label: COPY.FIRM_NUMBER, value: String(v.number) });
      if (v.request?.waitsFor != null)
        rows.push({ label: COPY.FIRM_WAITS, value: waitsLine(v.request.waitsFor) });
      return rows;
    };
    const planReady = x.type !== "start" || plan?.key === subjectKey(x);
    // The check guide of the send: a request's fields, a start's plan's or
    // a scheduled change's run. A hash that differs from its fields takes
    // no send. A start on a wallet the account holds no key on sends
    // nothing, so it shows no guide.
    const startTx = x.type === "start" && planReady && holdsKey(x.action.group) ? plan?.plan.tx : undefined;
    const checks = !v
      ? null
      : v.change
        ? verifyGuide({ kind: "run", op: v.change.op, calls: v.calls })
        : v.request
          ? verifyGuide({ kind: v.request.executes ? "execute" : "approve", safe: v.request.to, tx: v.request.tx, hash: v.request.id, calls: v.calls, delayHours: v.delayHours })
          : v.to && startTx
            ? verifyGuide({ kind: v.needed <= 1 ? "execute" : "approve", safe: v.to, tx: startTx, calls: v.calls, delayHours: v.delayHours })
            : null;
    const guide = checks && <VerifyGuide model={checks} />;
    if (!v) {
      head = COPY.FIRM_TITLE;
      body = <p className="sec-none">{DRIVER_ERRORS.changed}</p>;
      foot = (
        <button type="button" className="sec-cta" onClick={toHome}>
          {COPY.FIRM_DONE}
        </button>
      );
    } else if (sc.kind === "review") {
      head = v.title;
      const canSend =
        x.type === "run"
          ? v.change?.ready === true
          : x.type === "start"
            ? holdsKey(x.action.group)
            : true;
      const keyOff = x.type === "start" && !holdsKey(x.action.group);
      body = planFail ? (
        keyOff ? (
          offLine(x.action.group)
        ) : (
          <p className="sec-error" role="alert">
            {planFail}
          </p>
        )
      ) : !planReady ? (
        <p className="sec-none">{COPY.FIRM_PLAN_READING}</p>
      ) : (
        <>
          {v.effect && <p className="sec-lead">{v.effect}</p>}
          <Box label={v.title} rows={planRows()} />
          <Details calls={v.calls} />
          {guide}
          {keyOff && offLine(x.action.group)}
        </>
      );
      const step =
        x.type === "run"
          ? "run"
          : x.type === "start"
            ? "start"
            : v.request?.executes
              ? "execute"
              : "approve";
      const label = {
        run: COPY.FIRM_RUN,
        start: COPY.FIRM_CONTINUE,
        execute: COPY.FIRM_EXECUTE,
        approve: COPY.FIRM_APPROVE,
      }[step];
      foot = (
        <>
          {backLink}
          <span className="sec-foot-right">
            {preview && preview.staff !== false && x.type === "request" && (
              <button
                type="button"
                className="sec-btn"
                onClick={go({ to: "decline" })}
                aria-describedby={hintId("decline")}
              >
                {COPY.FIRM_DECLINE}
                <ActionHint
                  id={hintId("decline")}
                  text={BUTTON_HINTS.decline}
                />
              </button>
            )}
            <button
              type="button"
              className="sec-cta"
              onClick={toWallet}
              disabled={
                !sends ||
                !canSend ||
                !planReady ||
                planFail !== null ||
                checks?.matches === false
              }
              aria-describedby={hintId("send")}
            >
              {label}
              <ActionHint id={hintId("send")} text={BUTTON_HINTS[step]} />
            </button>
          </span>
        </>
      );
    } else if (sc.kind === "sign") {
      head = COPY.FIRM_WALLET_TITLE;
      body = (
        <>
          <div className="sec-wait">
            <span className="sec-ring" aria-hidden="true">
              <span className="sec-ring-in">
                <CrxLogoFilled className="sec-ring-mark" />
              </span>
            </span>
            <p className="sec-wait-head">
              {sent
                ? COPY.FIRM_SENT
                : v.to
                  ? COPY.FIRM_WALLET_LINE
                  : COPY.STEP_SEND}
            </p>
            {v.to && (
              <code className={sent ? "sec-to sec-to-sent" : "sec-to"}>
                {v.to.slice(0, Math.ceil(v.to.length / 2))}
                <wbr />
                {v.to.slice(Math.ceil(v.to.length / 2))}
              </code>
            )}
          </div>
          {fail && (
            <div className="sec-fail">
              <p className="sec-error" role="alert">
                {fail.line}
              </p>
              {(fail.code === "slow" || fail.code === "changed") && (
                <button type="button" className="sec-btn" onClick={toHome}>
                  {fail.code === "slow" ? COPY.READ_AGAIN : COPY.FIRM_DONE}
                </button>
              )}
            </div>
          )}
          <Box
            head={v.title}
            rows={[
              ...(role ? [{ label: COPY.FIRM_ACCOUNT, value: role }] : []),
              ...(v.number !== null
                ? [{ label: COPY.FIRM_NUMBER, value: String(v.number) }]
                : []),
            ]}
          />
          {guide}
        </>
      );
      foot = live && busy ? null : backLink;
    } else if (sc.kind === "decline" && v.request) {
      head = COPY.FIRM_DECLINE_TITLE;
      body = (
        <>
          <Box
            head={v.title}
            rows={[
              ...(role ? [{ label: COPY.FIRM_ACCOUNT, value: role }] : []),
              { label: COPY.FIRM_NUMBER, value: String(v.request.number) },
            ]}
          />
          <label className="sec-field">
            <span className="sec-field-label">{COPY.FIRM_DECLINE_REASON}</span>
            <input
              className="sec-input"
              type="text"
              maxLength={200}
              autoComplete="off"
            />
          </label>
        </>
      );
      foot = (
        <>
          {backLink}
          <button
            type="button"
            className="sec-cta"
            onClick={go({ to: "confirm-decline" })}
          >
            {COPY.FIRM_DECLINE_CONFIRM}
          </button>
        </>
      );
    } else if (sc.kind === "done") {
      const declined = x.type === "request" && state.walk[x.id] === "declined";
      const r = result ?? { executed: false, approvals: 0, needed: v.needed };
      head = declined
        ? COPY.FIRM_DECLINED_WORD
        : r.executed
          ? v.delayHours > 0 && x.type !== "run"
            ? COPY.FIRM_SCHEDULED_WORD
            : COPY.FIRM_EXECUTED_WORD
          : x.type === "start"
            ? COPY.FIRM_PROPOSED_WORD
            : COPY.FIRM_APPROVED_WORD;
      body = (
        <>
          <div className="sec-wait">
            <span className="sec-tick" aria-hidden="true">
              <Check className="sec-tick-icon" />
            </span>
            <p className="sec-wait-head">
              {declined
                ? COPY.FIRM_DECLINED_LINE
                : outcomeLine(
                    x.type === "start" ? "start" : "request",
                    x.type === "run" ? 0 : v.delayHours,
                    r,
                    v.done,
                  )}
            </p>
          </div>
          <Box
            label={v.title}
            rows={[
              ...(x.type !== "run" && !declined
                ? [
                    {
                      label: COPY.FIRM_APPROVED_SO_FAR,
                      value: neededOf(r.approvals, r.needed),
                    },
                  ]
                : []),
              ...(role ? [{ label: COPY.FIRM_ACCOUNT, value: role }] : []),
              ...(v.number !== null
                ? [{ label: COPY.FIRM_NUMBER, value: String(v.number) }]
                : []),
            ]}
          />
        </>
      );
      foot = (
        <button type="button" className="sec-cta" onClick={go({ to: "back" })}>
          {COPY.FIRM_DONE}
        </button>
      );
    }
  }

  const other = preview
    ? preview.firms.filter((f) => f.key !== preview.firmKey)
    : [];
  const bar = stepBar(state);

  return (
    <div className="sec-flow" key={run}>
      <header className="sec-band">
        <div className="sec-band-in">
          <div className="sec-band-top">
            <span className="sec-lockup">
              <CrxLogoFilled className="sec-mark" />
              <span className="sec-word" aria-hidden="true">
                CRX
              </span>
            </span>
            {firmLabel &&
              (logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the static page has no next/image
                <img className="sec-wordmark" src={logo} alt={firmLabel} />
              ) : (
                <span className="sec-firm" title={firmLabel}>
                  {firmLabel}
                </span>
              ))}
          </div>
          <p className="sec-title" aria-hidden="true">
            {head}
          </p>
          <h1 className="dsk-sr" ref={title} tabIndex={-1}>
            {head}
          </h1>
        </div>
      </header>
      <main className="sec-shell">
        <div className="sec-card">
          {bar && <Steps labels={bar.labels} at={bar.at} />}
          <div className="sec-body">
            {live && connection && !sends && (
              <p className="sec-note">{COPY.FIRM_SENDS_OFF}</p>
            )}
            {body}
            {foot && <div className="sec-foot">{foot}</div>}
          </div>
        </div>
        {preview
          ? preview.staff !== false && (
              <footer className="sec-staff" aria-label={COPY.PREVIEW_AS}>
                <p>{previewBanner(preview.firm)}</p>
                <nav className="sec-staff-links" aria-label={COPY.PREVIEW_AS}>
                  {other.map((f) => (
                    <a key={f.key} href={f.href}>
                      {COPY.PREVIEW_AS} {f.label}
                    </a>
                  ))}
                  {sc.kind === "sign" && (
                    <button
                      type="button"
                      className="sec-staff-btn sec-staff-sign"
                      onClick={markSigned}
                    >
                      {COPY.FIRM_SIGNED}
                    </button>
                  )}
                  <button
                    type="button"
                    className="sec-staff-btn"
                    onClick={reset}
                  >
                    {COPY.PREVIEW_RESET}
                  </button>
                  <a href={preview.closeHref}>{COPY.PREVIEW_CLOSE}</a>
                </nav>
              </footer>
            )
          : safes.length > 0 && (
              <footer className="sec-fallback">
                <p>{COPY.FIRM_FALLBACK}</p>
                <ul>
                  {safes.map((s) => (
                    <li key={s.address}>
                      <span className="sec-fallback-role">
                        {groupOf(s.group).role}
                      </span>
                      <a
                        href={safeHref(s.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.address}
                      </a>
                    </li>
                  ))}
                </ul>
              </footer>
            )}
      </main>
    </div>
  );
}
