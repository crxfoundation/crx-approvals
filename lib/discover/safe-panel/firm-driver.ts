// Browser-safe. The source of a firm approvals page's facts and sends
// (components/discover/desk/approvals/FirmApprovals). Two drivers fill it:
//
//   preview  sample facts for a CRX viewer; the staff line stands in for
//            the wallet (lib/discover/safe-panel/firm-preview)
//   live     the chain, read and sent through the firm's own wallet
//            (EIP-1193) only: no CRX server, no CRX RPC
//            (lib/discover/safe-panel/firm-live)
//
// A driver call that fails throws FirmDriverError with one code. The page
// maps each code to one line of copy.

import type { Address, Hex } from "viem";

/** The three CRX wallets (Safes), by the page's group ids. */
export type GroupId = "stop" | "restart" | "members";

/** Every action of the three wallets. A wallet's list is WALLET_ACTIONS;
 *  the titles are copy.ts ACTION_TITLES. */
export type ActionId =
  | "stop-all"
  | "pause-pair"
  | "remove-member"
  | "halt-source"
  | "cancel-hold"
  | "backup-operator"
  | "wallet-keys"
  | "restart"
  | "reopen-pair"
  | "deposits"
  | "price-source"
  | "upgrade"
  | "schedule-rule"
  | "readmit-member"
  | "cancel-scheduled"
  | "admit-remove"
  | "publish-prices"
  | "manual-price"
  | "hold-trade";

/** One action on one wallet. "stop-all" and "wallet-keys" sit on two. */
export interface WalletAction {
  group: GroupId;
  id: ActionId;
}

/** The actions of each wallet, in page order. Each starts in the page for a
 *  seat on that wallet. The firms hold no key on "members". */
export const WALLET_ACTIONS: readonly WalletAction[] = [
  ...(["stop-all", "pause-pair", "remove-member", "halt-source", "cancel-hold", "backup-operator", "wallet-keys"] as const).map((id) => ({ group: "stop" as const, id })),
  ...(["restart", "wallet-keys", "reopen-pair", "stop-all", "deposits", "price-source", "upgrade", "schedule-rule", "readmit-member", "cancel-scheduled"] as const).map((id) => ({ group: "restart" as const, id })),
  ...(["admit-remove", "publish-prices", "manual-price", "hold-trade"] as const).map((id) => ({ group: "members" as const, id })),
];

export function sameAction(a: WalletAction, b: WalletAction): boolean {
  return a.group === b.group && a.id === b.id;
}

/** One choice of a field: "USD/BRL", a member, a scheduled change. */
export interface FieldOption {
  value: string;
  label: string;
  line?: string;
}

/** An input an action takes before its review. A choice lists what the
 *  chain holds (pairs, members, owners, price sources, scheduled changes);
 *  an empty list means the action has nothing to act on. An address field
 *  only where no list exists (a new key, a new version of the system). */
export type ActionField =
  | { id: string; label: string; kind: "choice"; options: readonly FieldOption[]; when?: FieldWhen }
  | { id: string; label: string; kind: "address"; when?: FieldWhen }
  | {
      id: string;
      label: string;
      kind: "number";
      /** Human units, as typed: "250" (USD), "5.25" (a price). */
      min: number;
      max: number;
      unit?: string;
      /** The places a value may have; the driver scales it. A value with
       *  more places is refused with a field line and never sent. */
      decimals?: number;
      when?: FieldWhen;
      maxFor?: FieldMax;
    };

/** A field that shows, and is required, only while the field named `field`
 *  holds one of `in`. plan() and start() ignore the value of a hidden field. */
export interface FieldWhen {
  field: string;
  in: readonly string[];
}

/** A number field's ceiling that follows another field: `max[v]` while the
 *  field named `field` holds `v`; the field's own `max` for any other value. */
export interface FieldMax {
  field: string;
  max: Readonly<Record<string, number>>;
}

/** The values of an action's fields, by field id. */
export type ActionValues = Readonly<Record<string, string>>;

/** One call of the plan, for the Details list: the contract's plain name,
 *  its full address, the function signature and each argument. */
export interface ActionCall {
  name: string;
  to: Address;
  fn: string;
  args: readonly { name: string; value: string }[];
}

/** What an action does once its approvals are in. `delayHours` > 0: a
 *  scheduled change that runs after the wait. */
export interface ActionPlan {
  /** The wallet (Safe) the call goes through, for the wallet step. */
  safe: Address;
  title: string;
  effect: string;
  /** The state once the action takes effect, one plain sentence: "Trading
   *  on CRX is stopped." */
  done: string;
  needed: number;
  delayHours: number;
  calls: readonly ActionCall[];
  /** The Safe request number this action uses: for a start, the next free
   *  number, the one start() picks; null when no Safe request is made (a
   *  run of a scheduled change). */
  number: number | null;
  /** A start's request, from the driver's plan(): the fields the wallet
   *  signs, at `number`. */
  tx?: RequestTx;
}

/** The SafeTx fields of a request on its wallet (Safe). safeTxGas, baseGas
 *  and gasPrice are 0; gasToken and refundReceiver the zero address.
 *  `value`: wei, in decimal. `operation`: 0 (call). */
export interface RequestTx {
  chainId: number;
  to: Address;
  value: string;
  data: Hex;
  operation: number;
  nonce: number;
}

/** The connected wallet. `firm` null: the address is on no seat list entry
 *  of this build. `firm.logo`: the logo's address in the bundle, or null.
 *  `sends` false: this network takes no send from the page. */
export interface Connection {
  account: Address;
  chainId: number;
  sends: boolean;
  firm: { key: string; label: string; logo: string | null } | null;
}

/** One wallet as the chain shows it. `mine`: the account is an owner. */
export interface Seat {
  group: GroupId;
  safe: Address;
  needed: number;
  keys: number;
  mine: boolean;
  /** The Safe's next transaction number. */
  nonce: number;
  /** The Safe's owners, in getOwners order. */
  owners: Address[];
}

/** A proposal on chain that this build's action list names. */
export interface FirmRequestLive {
  /** The SafeTx hash. */
  id: Hex;
  group: GroupId;
  /** Null: a call this page's catalogue does not list ("Other request";
   *  the plan's calls show it). */
  action: ActionId | null;
  plan: ActionPlan;
  approvals: number;
  needed: number;
  /** The Safe transaction number. */
  number: number;
  approvedByMe: boolean;
  /** True when one execute by this account reaches the threshold and the
   *  request holds the Safe's current number. */
  canExecute: boolean;
  /** The request number that must run first (this one's number minus one),
   *  or null when this request holds the Safe's current number. */
  waitsFor: number | null;
  /** The fields `id` hashes. */
  tx: RequestTx;
}

/** A send's outcome. `executed`: the Safe ran the action in this send. A
 *  change through the 72-hour queue is then scheduled; it takes effect when
 *  run after plan.delayHours. */
export interface SendResult {
  tx: Hex;
  executed: boolean;
  approvals: number;
  needed: number;
}

export type FirmDriverErrorCode =
  | "no-wallet" // no EIP-1193 wallet in the browser
  | "rejected" // the wallet declined the request
  | "wrong-network" // the wallet is on a network this build does not list
  | "no-seat" // the account owns none of the wallets
  | "read-failed" // a read through the wallet failed
  | "sends-off" // this network takes no send from the page
  | "reverted" // the transaction failed on chain
  | "send-refused" // the wallet or network refused the send (no funds for the fee)
  | "changed" // the request or chain state changed since the review
  | "not-now" // the action does not apply to the chain's state now
  | "slow"; // no receipt after 10 min; the send may still land

export class FirmDriverError extends Error {
  readonly code: FirmDriverErrorCode;
  constructor(code: FirmDriverErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface FirmDriver {
  readonly kind: "preview" | "live";
  connect(): Promise<Connection>;
  seats(): Promise<readonly Seat[]>;
  requests(): Promise<readonly FirmRequestLive[]>;
  /** The action's inputs, read from the chain. */
  fields(action: WalletAction): Promise<readonly ActionField[]>;
  /** The review of an action with these values. */
  plan(action: WalletAction, values: ActionValues): Promise<ActionPlan>;
  /** Guardian: one transaction, executed. Multisig: a new proposal at the
   *  Safe's current number, approved by this account. */
  start(action: WalletAction, values: ActionValues): Promise<SendResult>;
  approve(id: Hex): Promise<SendResult>;
  execute(id: Hex): Promise<SendResult>;
  /** Scheduled changes on the timelocks: waiting, ready to run. */
  scheduled(): Promise<readonly ScheduledChange[]>;
  /** Runs a scheduled change whose wait is over; any account may. */
  run(id: Hex): Promise<SendResult>;
  /** Calls `listener` with each transaction hash the wallet returns, before
   *  its receipt, for start, approve, execute and run. Returns the
   *  unsubscribe. */
  onSent(listener: (tx: Hex) => void): () => void;
}

/** A change a timelock holds. `readyAt`: unix seconds. */
export interface ScheduledChange {
  id: Hex;
  plan: ActionPlan;
  readyAt: number;
  ready: boolean;
  /** What its run sends. */
  op: RunTx;
}

/** A scheduled change's run: execute(target, value, data, predecessor,
 *  salt) on its queue. `value`: wei, in decimal. */
export interface RunTx {
  queue: Address;
  target: Address;
  value: string;
  data: Hex;
  predecessor: Hex;
  salt: Hex;
}
