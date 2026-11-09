// Browser-safe. The firm's approvals: the pure walk of
// components/discover/desk/approvals/FirmApprovals. The page's driver
// (lib/discover/safe-panel/firm-driver) reads and sends; this file only
// moves the screens.
//
// The screens (FirmScreen), one at a time:
//
//   connect   the live page before a wallet connects
//   home      the requests waiting for the firm, the firm's own open
//             proposals, the scheduled changes, then the firm's seat: one
//             row per wallet
//   account   one wallet's approvals and keys, then one tile per action
//   inputs    an action's choices (a pair, a member, a key)    step 1 of 3
//   review    a subject's plan: a request, a start or a run    step 1 of 3
//   sign      the wallet step                                  step 2 of 3
//   decline   the decline step (a request, preview only)       step 2 of 3
//   done      the outcome                                      step 3 of 3
//
// Each request walks (FirmRequestStep):
//
//   waiting    the firm has not acted
//   wallet     the firm pressed Approve: the wallet step shows
//   declining  the firm pressed Decline: the decline step shows
//   approved   the firm confirmed in the wallet: one more approval counts
//   declined   the firm confirmed the decline

import { getAddress } from "viem";
import { ET_ZONE, zonedWhen } from "../time-zone.ts";
import { COPY, placesLine, rangeLine } from "./copy.ts";
import { WALLET_ACTIONS, sameAction, type ActionCall, type ActionField, type ActionValues, type FirmRequestLive, type GroupId, type RequestTx, type ScheduledChange, type WalletAction } from "./firm-driver.ts";

export type FirmRequestStep = "waiting" | "wallet" | "declining" | "approved" | "declined";

export type FirmRequestAction = "approve" | "confirm" | "decline" | "confirm-decline" | "cancel";

/** A wallet: its role, the approvals it needs and the keys CRX holds on it.
 *  `firmKeys`: each preview firm holds one key. */
export interface FirmGroup {
  id: GroupId;
  /** The wallet's role name, shown before its label. */
  role: "Guardian" | "Multisig" | "Steward";
  label: string;
  needed: number;
  crxKeys: number;
  firmKeys: boolean;
}

/** The three wallets on Ethereum, in page order. */
export const FIRM_GROUPS: readonly FirmGroup[] = [
  { id: "stop", role: "Guardian", label: "Stop and pause", needed: 1, crxKeys: 3, firmKeys: true },
  { id: "restart", role: "Multisig", label: "Unpause, upgrades and rules", needed: 3, crxKeys: 3, firmKeys: true },
  { id: "members", role: "Steward", label: "Members and prices", needed: 2, crxKeys: 5, firmKeys: false },
];

export function groupOf(id: GroupId): FirmGroup {
  return FIRM_GROUPS.find((g) => g.id === id) ?? FIRM_GROUPS[0];
}

/** A wallet's actions, in page order. */
export function actionsOf(group: GroupId): readonly WalletAction[] {
  return WALLET_ACTIONS.filter((a) => a.group === group);
}

/** Who holds the keys of a wallet, `firms` the preview firms' names:
 *  "CRX 3 · Example 1". */
export function keyHolders(g: FirmGroup, firms: readonly string[]): string {
  return [`CRX ${g.crxKeys}`, ...(g.firmKeys ? firms.map((f) => `${f} 1`) : [])].join(" · ");
}

/** The keys on a wallet: CRX's and, with firm keys, one per preview firm. */
export function keyCount(g: FirmGroup, firms: number): number {
  return g.crxKeys + (g.firmKeys ? firms : 0);
}

/** A seat row's value: the approvals a wallet needs of its keys, "1 of 5";
 *  "CRX only" for a wallet on which the firms hold no key. */
export function seatValue(g: FirmGroup, firms: number): string {
  return g.firmKeys ? `${g.needed} of ${keyCount(g, firms)}` : "CRX only";
}

/** A proposal on a wallet, as the page shows it: its plan's title, effect
 *  and calls. `executes`: the firm's approval executes it. */
export interface FirmRequest {
  id: string;
  title: string;
  effect: string;
  /** The state once it takes effect (ActionPlan.done). */
  done: string;
  group: GroupId;
  approvals: number;
  needed: number;
  number: number;
  executes: boolean;
  delayHours: number;
  calls: readonly ActionCall[];
  /** The wallet (Safe) the firm's wallet sends to. */
  to: string;
  /** The number of an earlier request this one waits for; null when none. */
  waitsFor: number | null;
  /** The fields `id` hashes, for the check guide. */
  tx: RequestTx;
}

/** The earlier request a request waits for (firm-driver FirmRequestLive
 *  waitsFor); null when none. */
const waitsForOf = (r: FirmRequestLive): number | null => r.waitsFor;

/** True when this account can act on the request: approve it, or execute
 *  it when it waits for no earlier one. */
const actionable = (r: FirmRequestLive) => !r.approvedByMe || (r.canExecute && waitsForOf(r) === null);

function shown(r: FirmRequestLive): FirmRequest {
  const to = r.plan.safe;
  return { id: r.id, title: r.plan.title, effect: r.plan.effect, done: r.plan.done, group: r.group, approvals: r.approvals, needed: r.needed, number: r.number, executes: r.canExecute && waitsForOf(r) === null, delayHours: r.plan.delayHours, calls: r.plan.calls, to, waitsFor: waitsForOf(r), tx: r.tx };
}

export type FirmWalk = Readonly<Record<string, FirmRequestStep>>;

/** The next step of one request. An action that does not fit the step keeps it. */
export function firmNext(step: FirmRequestStep, action: FirmRequestAction): FirmRequestStep {
  switch (step) {
    case "waiting":
      return action === "approve" ? "wallet" : action === "decline" ? "declining" : step;
    case "wallet":
      return action === "confirm" ? "approved" : action === "cancel" ? "waiting" : step;
    case "declining":
      return action === "confirm-decline" ? "declined" : action === "cancel" ? "waiting" : step;
    default:
      return step;
  }
}

/** The walk after `action` on request `id`. One request at a time holds the
 *  wallet or the decline step: an action on another request waits. */
export function firmWalkNext(walk: FirmWalk, id: string, action: FirmRequestAction): FirmWalk {
  const step = walk[id];
  if (step === undefined) return walk;
  const open = Object.entries(walk).find(([k, s]) => k !== id && (s === "wallet" || s === "declining"));
  if (open) return walk;
  const next = firmNext(step, action);
  return next === step ? walk : { ...walk, [id]: next };
}

/** True for a step the firm has decided. */
export function isDecided(step: FirmRequestStep | undefined): step is "approved" | "declined" {
  return step === "approved" || step === "declined";
}

/** The requests still waiting for the firm at this walk, in page order. */
export function waitingRequests(s: FirmState): readonly FirmRequest[] {
  return s.requests.filter((r) => !isDecided(s.walk[r.id]));
}

/** What the page walks: a request on chain, an action the firm starts with
 *  its values (`inputs`: it took choices first), or a scheduled change to run. */
export type FirmSubject =
  | { type: "request"; id: string }
  | { type: "start"; action: WalletAction; values: ActionValues; inputs: boolean }
  | { type: "run"; id: string };

export type FirmScreen =
  | { kind: "connect" }
  | { kind: "home" }
  | { kind: "account"; group: GroupId }
  | { kind: "inputs"; action: WalletAction; values: ActionValues }
  | { kind: "review" | "sign" | "decline" | "done"; subject: FirmSubject };

export type FirmMove =
  | { to: "account"; group: GroupId }
  | { to: "action"; action: WalletAction; inputs: boolean }
  | { to: "value"; id: string; value: string }
  | { to: "continue"; fields: readonly ActionField[] }
  | { to: "run"; id: string }
  | { to: "connected" | "review" | "approve" | "confirm" | "decline" | "confirm-decline" | "back" | "home" };

/** The screen and what the chain last showed: the requests the firm can act
 *  on (and their walk), the firm's own open proposals, the scheduled changes. */
export interface FirmState {
  walk: FirmWalk;
  requests: readonly FirmRequest[];
  others: readonly FirmRequest[];
  scheduled: readonly ScheduledChange[];
  screen: FirmScreen;
}

/** The preview's start: at home, nothing read yet. */
export const FIRM_START: FirmState = { walk: {}, requests: [], others: [], scheduled: [], screen: { kind: "home" } };

/** The live page's start: at Connect. */
export const FIRM_LIVE_START: FirmState = { ...FIRM_START, screen: { kind: "connect" } };

/** The state after a read of the chain: the requests the firm can act on
 *  (not yet approved by it, or one execute from done) each waiting, a
 *  decline kept; the firm's own open proposals; the scheduled changes. */
export function firmRead(s: FirmState, requests: readonly FirmRequestLive[] | null, scheduled: readonly ScheduledChange[] | null): FirmState {
  const next = { ...s };
  if (requests) {
    next.requests = requests.filter(actionable).map(shown);
    next.others = requests.filter((r) => !actionable(r)).map(shown);
    next.walk = Object.fromEntries(next.requests.map((r) => [r.id, s.walk[r.id] === "declined" ? ("declined" as const) : ("waiting" as const)]));
  }
  if (scheduled) next.scheduled = scheduled;
  return next;
}

/** The state after `move`. A move that does not fit the screen keeps the
 *  state. Review opens the first request still waiting. An action opens
 *  from its own wallet's screen: its choices first when it takes any;
 *  Continue needs a passing value in each field that shows, and keeps only
 *  those values. Back from the wallet or the
 *  decline step returns to the review; a request returns to waiting. Home
 *  goes home from any screen past Connect. */
export function firmMove(s: FirmState, move: FirmMove): FirmState {
  const sc = s.screen;
  const at = (screen: FirmScreen, walk: FirmWalk = s.walk): FirmState => ({ ...s, walk, screen });
  const onRequest = (id: string, a: FirmRequestAction, kind: "review" | "sign" | "decline" | "done"): FirmState => {
    const walk = firmWalkNext(s.walk, id, a);
    return walk === s.walk ? s : at({ kind, subject: { type: "request", id } }, walk);
  };
  switch (move.to) {
    case "connected":
      return sc.kind === "connect" ? at({ kind: "home" }) : s;
    case "account":
      return sc.kind === "home" ? at({ kind: "account", group: move.group }) : s;
    case "action": {
      if (sc.kind !== "account" || move.action.group !== sc.group || !WALLET_ACTIONS.some((a) => sameAction(a, move.action))) return s;
      const action = { group: move.action.group, id: move.action.id };
      return at(move.inputs ? { kind: "inputs", action, values: {} } : { kind: "review", subject: { type: "start", action, values: {}, inputs: false } });
    }
    case "value":
      return sc.kind === "inputs" && sc.values[move.id] !== move.value ? at({ ...sc, values: { ...sc.values, [move.id]: move.value } }) : s;
    case "continue":
      if (sc.kind !== "inputs" || !fieldsReady(move.fields, sc.values)) return s;
      return at({ kind: "review", subject: { type: "start", action: sc.action, values: shownValues(move.fields, sc.values), inputs: true } });
    case "review": {
      const next = waitingRequests(s)[0];
      return sc.kind === "home" && next ? at({ kind: "review", subject: { type: "request", id: next.id } }) : s;
    }
    case "run":
      return sc.kind === "home" && s.scheduled.some((c) => c.id === move.id) ? at({ kind: "review", subject: { type: "run", id: move.id } }) : s;
    case "approve":
      if (sc.kind !== "review") return s;
      return sc.subject.type === "request" ? onRequest(sc.subject.id, "approve", "sign") : at({ kind: "sign", subject: sc.subject });
    case "confirm":
      if (sc.kind !== "sign") return s;
      return sc.subject.type === "request" ? onRequest(sc.subject.id, "confirm", "done") : at({ kind: "done", subject: sc.subject });
    case "decline":
      return sc.kind === "review" && sc.subject.type === "request" ? onRequest(sc.subject.id, "decline", "decline") : s;
    case "confirm-decline":
      return sc.kind === "decline" && sc.subject.type === "request" ? onRequest(sc.subject.id, "confirm-decline", "done") : s;
    case "home":
      if (sc.kind === "connect" || sc.kind === "home") return s;
      return at({ kind: "home" }, (sc.kind === "sign" || sc.kind === "decline") && sc.subject.type === "request" ? firmWalkNext(s.walk, sc.subject.id, "cancel") : s.walk);
    case "back":
      switch (sc.kind) {
        case "connect":
        case "home":
          return s;
        case "inputs":
          return at({ kind: "account", group: sc.action.group });
        case "sign":
        case "decline":
          return sc.subject.type === "request" ? onRequest(sc.subject.id, "cancel", "review") : at({ kind: "review", subject: sc.subject });
        case "review":
          if (sc.subject.type === "start") {
            const { action, values, inputs } = sc.subject;
            return at(inputs ? { kind: "inputs", action, values } : { kind: "account", group: action.group });
          }
          return at({ kind: "home" });
        default:
          return at({ kind: "home" });
      }
  }
}

/** The step bar of a subject's screens: its three labels and the part the
 *  screen stands on (0, 1, 2); null off a subject. The choices count as the
 *  review's part. A decline's middle step has no wallet. */
export function stepBar(s: FirmState): { labels: readonly [string, string, string]; at: 0 | 1 | 2 } | null {
  const sc = s.screen;
  if (sc.kind === "connect" || sc.kind === "home" || sc.kind === "account") return null;
  if (sc.kind === "inputs") return { labels: ["Review", "Confirm in wallet", "Done"], at: 0 };
  const declined = sc.subject.type === "request" && (sc.kind === "decline" || (sc.kind === "done" && s.walk[sc.subject.id] === "declined"));
  const labels = ["Review", declined ? "Confirm" : "Confirm in wallet", "Done"] as const;
  return { labels, at: sc.kind === "review" ? 0 : sc.kind === "done" ? 2 : 1 };
}

/** A time in ET with its day word, `atMs` against `nowMs`: "Today, 14:20
 *  ET", "Tomorrow, 09:00 ET", "Yesterday, 23:12 ET", "3 Nov 2026, 14:20 ET". */
export function etWhen(nowMs: number, atMs: number): string {
  const at = zonedWhen(atMs, ET_ZONE);
  const day = (ms: number) => zonedWhen(ms, ET_ZONE)?.day;
  if (!at) return "—";
  const word = at.day === day(nowMs) ? "Today" : at.day === day(nowMs + 86_400_000) ? "Tomorrow" : at.day === day(nowMs - 86_400_000) ? "Yesterday" : at.day;
  return `${word}, ${at.hm} ET`;
}

/** A field value's check: null when it passes, else the line to show. An
 *  empty value shows no line. An address needs 0x and 40 characters, and a
 *  mixed-case one its checksum; a number at most its field's decimal places
 *  (none by default) and its range; a choice one of its options. */
export function fieldProblem(f: ActionField, v: string | undefined): string | null {
  if (!v) return null;
  if (f.kind === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return COPY.ADDRESS_FULL;
    const hex = v.slice(2);
    return hex === hex.toLowerCase() || hex === hex.toUpperCase() || getAddress(v) === v ? null : COPY.FIRM_ADDRESS_CHECKSUM;
  }
  if (f.kind === "number") {
    const places = f.decimals ?? 0;
    const m = /^\d+(?:\.(\d+))?$/.exec(v);
    if (m && (m[1]?.length ?? 0) > places) return placesLine(places);
    const n = Number(v);
    return m && n >= f.min && n <= f.max ? null : rangeLine(f.min, f.max, f.unit);
  }
  return f.options.some((o) => o.value === v) ? null : COPY.FIRM_EMPTY_CHOICE;
}

/** The fields that show at these values: a field with `when` shows only
 *  while its named field holds one of `when.in`. A number field with
 *  `maxFor` takes the ceiling its named field's value sets. */
export function shownFields(list: readonly ActionField[], values: ActionValues): ActionField[] {
  return list
    .filter((f) => !f.when || f.when.in.includes(values[f.when.field] ?? ""))
    .map((f) => (f.kind === "number" && f.maxFor ? { ...f, max: f.maxFor.max[values[f.maxFor.field] ?? ""] ?? f.max } : f));
}

/** True when every field that shows holds a value that passes its check. */
export function fieldsReady(list: readonly ActionField[], values: ActionValues): boolean {
  return shownFields(list, values).every((f) => !!values[f.id] && fieldProblem(f, values[f.id]) === null);
}

/** The values of the fields that show: a hidden field's value is dropped. */
export function shownValues(list: readonly ActionField[], values: ActionValues): ActionValues {
  return Object.fromEntries(shownFields(list, values).flatMap((f) => (values[f.id] ? [[f.id, values[f.id]]] : [])));
}
