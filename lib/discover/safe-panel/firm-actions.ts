// Browser-safe. The catalogue of every wallet action: its inputs from chain
// state, its calls, and the way back from a call on chain to an action.
//
// Routes (how a Safe reaches the call):
//   safe  the Safe calls the target itself
//   tlA   the Safe schedules the call on the 72-hour change queue (TL-A)
//   tlB   the Safe schedules the call on the upgrade change queue (TL-B,
//         no wait today); the page runs it right after
//
// The chain facts come from firm-live in three reads: firstCalls (one
// Multicall3), the logs of logQuery, and secondCalls (one Multicall3). Each
// built action also names the calls to simulate from their real caller
// (`sims`): a revert means the action does not apply now.
//
// Contracts at efb79399: Crx.sol, CurveRegistry.sol, OpenZeppelin
// TimelockController (TL-A, TL-B), Safe 1.4.1. Storage words of the core read
// through Crx.extSloads at the core's storage base (B) + n.
//
// Imports viem alone, so a node test runs it with no loader.

import {
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  isAddress,
  isAddressEqual,
  keccak256,
  pad,
  toBytes,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import pairsConfig from "../../pairs.config.json" with { type: "json" };
import { CONTRACT_NAMES, DONE, FIELD_LABELS, short, WORDS } from "./action-copy.ts";
import { MULTICALL3_ABI, SAFE_ABI, saltOf, SENTINEL_OWNERS, TIMELOCK_ABI, APPROVE_HASH_TOPIC, CALL_SCHEDULED_TOPIC, CALL_SALT_TOPIC } from "./firm-abi.ts";
import type { FirmChain } from "./firm-chains.ts";
import { FirmDriverError, type ActionCall, type ActionField, type ActionId, type ActionPlan, type ActionValues, type FieldOption, type FieldWhen, type GroupId, type WalletAction } from "./firm-driver.ts";

/** The NDF instrument tag of the core's market rows. */
export const NDF = 1;
export const WEEK_SECONDS = 604_800n;
/** An unpause's lift window ends this many seconds after the start or later. */
export const LIFT_LEAD_SECONDS = 3_600n;
/** The core's storage base: the ERC-7201 location of crx.storage.core. */
const B = 0xeb1f1b60e16579ebdde9a2c178b84952f9c0b0169ba3259a0f1eff5c36148100n;
/** AdminLib GUARDIAN_REMOVED_LOCATION: seat → removed by the guardian. */
const GUARDIAN_REMOVED = "0x14b7a42432fef7227f89c3dd177dcb98e348b0edd678da4aaee892939f20a600";
/** PriceLib manual price base: pending proposal root. */
const MANUAL_BASE = "0xd5bc517d852319380748d3095c930b30540e2c0ffd431df4a2857b0b0f2bdd00";
/** A trade hold's expiry tag: (1 << 62) | E. */
export const TRADE_HOLD_TAG = 1n << 62n;
/** A trade price's expiry tag: (1 << 63) | E. */
export const TRADE_PRICE_TAG = 1n << 63n;
/** The six tenors of a curve, in band order, and each band's ceiling. */
export const TENORS = ["ON", "2W", "1M", "2M", "6M", "1Y"] as const;
export const BAND_CEILINGS = [14, 196, 420, 840, 2520, 5110] as const;
/** setParam keys: name, unit, range. */
export const PARAMS = {
  6: { label: "Largest premium", unit: "bp", decimals: 0, min: 1n, max: 10_000n },
  9: { label: "Smallest trade", unit: "USD", decimals: 6, min: 1_000_000n, max: 1_000_000_000_000n },
  10: { label: "Smallest deposit", unit: "USD", decimals: 6, min: 1_000_000n, max: 1_000_000_000_000n },
  12: { label: "Off-market band", unit: "bp", decimals: 0, min: 1n, max: 10_000n },
} as const;
type ParamKey = keyof typeof PARAMS;
/** The scale of a manual price: 10^-8, and the largest price the page takes. */
export const PRICE_DECIMALS = 8;
export const PRICE_MAX = 1_000_000;

/** A raw integer at `decimals` places as a plain decimal: 525000000, 8 → "5.25". */
export function decimalOf(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const a = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = (a / base).toLocaleString("en-US");
  const frac = decimals > 0 ? (a % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** A typed decimal at `decimals` places as a raw integer; null for text that
 *  is not a plain decimal or has more places. "5.25", 8 → 525000000n. */
export function scaled(text: string | undefined, decimals: number): bigint | null {
  const t = (text ?? "").trim().replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
}

/** A parameter value in its unit: "$250", "250 bp". */
export function paramShown(k: ParamKey, raw: bigint): string {
  const p = PARAMS[k];
  return p.unit === "USD" ? `$${decimalOf(raw, p.decimals)}` : `${decimalOf(raw, p.decimals)} ${p.unit}`;
}

const slot = (n: number) => pad(toHex(B + BigInt(n)), { size: 32 });
const mapSlot = (key: Hex, base: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [key, base]));
const addrKey = (a: Address) => pad(a, { size: 32 });

export const CORE_ABI = [
  { type: "function", name: "setHardPause", stateMutability: "nonpayable", inputs: [{ name: "on", type: "bool" }], outputs: [] },
  {
    type: "function",
    name: "setMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "instrument", type: "uint8" },
      { name: "pairId", type: "bytes32" },
      { name: "enabled", type: "bool" },
      { name: "paused", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "liftHardPause",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pausedAtWas", type: "uint256" },
      { name: "notAfter", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reopenMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "instrument", type: "uint8" },
      { name: "pairId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setWhitelist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "enabled", type: "bool" },
    ],
    outputs: [],
  },
  { type: "function", name: "setCrankSeat", stateMutability: "nonpayable", inputs: [{ name: "seat", type: "address" }], outputs: [] },
  {
    type: "function",
    name: "cancelManualPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [],
  },
  { type: "function", name: "setDepositsOpen", stateMutability: "nonpayable", inputs: [{ name: "on", type: "bool" }], outputs: [] },
  {
    type: "function",
    name: "setParam",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "uint8" },
      { name: "val", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    stateMutability: "payable",
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setManualPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "expiry", type: "uint64" },
      { name: "price", type: "int64" },
      { name: "expo", type: "int32" },
      { name: "fwd", type: "int64[6]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "bindCurve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fixTime", type: "uint64" },
      { name: "spotFeedIds", type: "bytes32[]" },
      { name: "updates", type: "bytes[]" },
    ],
    outputs: [],
  },
  { type: "function", name: "hardPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "hardPausedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "roleHolder", stateMutability: "view", inputs: [{ name: "role", type: "uint8" }], outputs: [{ type: "address" }] },
  { type: "function", name: "extSloads", stateMutability: "view", inputs: [{ name: "slots", type: "bytes32[]" }], outputs: [{ name: "res", type: "bytes32[]" }] },
] as const;

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "setPriceAdapter",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spotFeedId", type: "bytes32" },
      { name: "adapter_", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "haltCurveTenor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spotFeedId", type: "bytes32" },
      { name: "tenorIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setCurveBands",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spotFeedId", type: "bytes32" },
      { name: "bands", type: "uint16[6]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "entries",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "spots", type: "bytes32[]" },
      { name: "adapters", type: "address[]" },
      { name: "bands", type: "uint16[6][]" },
    ],
  },
] as const;

/** Every function a plan calls, for the way back from calldata. */
const CALL_ABI = [...CORE_ABI, ...REGISTRY_ABI, ...SAFE_ABI, ...TIMELOCK_ABI] as const;

const t = (sig: string) => keccak256(toBytes(sig));
export const CORE_TOPICS = {
  whitelisted: t("Whitelisted(address,bool)"),
  proposed: t("ManualPriceProposed(address,bytes32,uint64,int64,int32,int64[6],uint64,uint8)"),
  set: t("ManualPriceSet(address,bytes32,uint64,int64,int32,int64[6],uint8)"),
  cancelled: t("ManualPriceCancelled(address,bytes32,uint64)"),
  held: t("TradeHeld(bytes32,uint64,int64,int32)"),
  released: t("TradeHoldReleased(bytes32,uint64,int64,int32)"),
} as const;

interface PairRow {
  symbol: string;
  listed?: boolean;
  feedId?: string;
}

/** The listed pairs, in pairs.config.json order. */
export const LISTED: readonly { symbol: string; feedId: Hex | null }[] = (pairsConfig as { pairs: PairRow[] }).pairs
  .filter((p) => p.listed === true)
  .map((p) => ({ symbol: p.symbol, feedId: p.feedId ? (p.feedId.toLowerCase() as Hex) : null }));
export const LISTED_PAIRS: readonly string[] = LISTED.map((p) => p.symbol);

/** The on-chain pair id: keccak256 of the symbol (lib/twap pairId). */
export function pairIdOf(symbol: string): Hex {
  return keccak256(toBytes(symbol));
}

/** The first k ≥ 1 whose window, pausedAt + 7 d × k, ends 1 h or more after
 *  `nowSec`. */
export function liftWindow(pausedAt: bigint, nowSec: bigint): bigint {
  const need = nowSec + LIFT_LEAD_SECONDS - pausedAt;
  if (need <= WEEK_SECONDS) return 1n;
  return (need + WEEK_SECONDS - 1n) / WEEK_SECONDS;
}

// ---------------------------------------------------------------------------
// Chain state.

export interface SafeFacts {
  group: GroupId;
  safe: Address;
  owners: Address[];
  threshold: number;
  nonce: number;
}

/** A change a queue holds. `readyAt`: getTimestamp (0 unset, 1 done). */
export interface Op {
  queue: Address;
  tl: "A" | "B";
  id: Hex;
  target: Address;
  value: bigint;
  data: Hex;
  predecessor: Hex;
  salt: Hex;
  delay: bigint;
  readyAt: number;
}

export interface Feed {
  feed: Hex;
  label: string;
  adapter: Address;
  bands: number[];
}

export interface PendingPrice {
  feed: Hex;
  expiry: bigint;
  kind: "price" | "hold";
  label: string;
}

export interface Log {
  address: Address;
  topics: Hex[];
  data: Hex;
  transactionHash: Hex;
  blockNumber: Hex;
}

export interface ChainState {
  chainId: number;
  /** The connected account (firm-live sets it); the zero address in a
   *  state read with none. */
  account: Address;
  now: bigint;
  core: Address;
  registry: Address;
  tlA: Address;
  tlB: Address;
  delayA: bigint;
  delayB: bigint;
  safes: SafeFacts[];
  paused: boolean;
  pausedAt: bigint;
  depositsOpen: boolean;
  houseSeat: Address;
  crankSeat: Address;
  /** Listed pairs: market row bits. */
  markets: { pair: string; pairId: Hex; enabled: boolean; paused: boolean }[];
  feeds: Feed[];
  members: Address[];
  removed: Address[];
  pending: PendingPrice[];
  ops: Op[];
  approveLogs: Log[];
  params: Partial<Record<keyof typeof PARAMS, bigint>>;
}

export type Call = { target: Address; callData: Hex };

const GROUPS: readonly GroupId[] = ["stop", "restart", "members"];

/** The first read: Safes, pause, chain time, role holders, registry entries
 *  and core storage words. */
export function firstCalls(chain: FirmChain): Call[] {
  const calls: Call[] = [];
  for (const g of GROUPS) {
    const target = chain.safes[g];
    calls.push({ target, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "getOwners" }) });
    calls.push({ target, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "getThreshold" }) });
    calls.push({ target, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "nonce" }) });
  }
  const core = chain.core;
  calls.push({ target: core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "hardPaused" }) });
  calls.push({ target: core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "hardPausedAt" }) });
  calls.push({ target: core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "roleHolder", args: [5] }) });
  calls.push({ target: core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "roleHolder", args: [7] }) });
  calls.push({ target: chain.multicall, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp" }) });
  calls.push({ target: chain.registry, callData: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "entries" }) });
  calls.push({ target: core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "extSloads", args: [coreWords()] }) });
  return calls;
}

/** houseSeat, crankSeat, the deposit gate, the premium and the deposit
 *  floor, then one market row per listed pair. */
function coreWords(): Hex[] {
  const rows = LISTED.map((p) => mapSlot(keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes32" }], [NDF, pairIdOf(p.symbol)])), slot(34)));
  return [slot(41), slot(59), slot(55), slot(33), slot(57), ...rows];
}

/** The logs the state needs, from the core's birth. */
export function logQuery(chain: FirmChain): { addresses: Address[]; topics: Hex[] } {
  return {
    addresses: [chain.core, chain.safes.stop, chain.safes.restart, chain.safes.members, chain.tlA, chain.tlB],
    topics: [...Object.values(CORE_TOPICS), APPROVE_HASH_TOPIC, CALL_SCHEDULED_TOPIC, CALL_SALT_TOPIC],
  };
}

const lastWins = <T>(rows: [string, T][]) => new Map(rows);

/** The members, the queued ops and the price proposals the logs name. */
function fromLogs(chain: FirmChain, logs: readonly Log[]) {
  const on = (a: Address) => (l: Log) => isAddressEqual(l.address, a);
  const core = logs.filter(on(chain.core));
  const accounts = [...lastWins(core.filter((l) => l.topics[0] === CORE_TOPICS.whitelisted).map((l) => [getAddress(`0x${l.topics[1].slice(26)}`), true])).keys()] as Address[];
  const key = (l: Log) => `${l.topics[l.topics[0] === CORE_TOPICS.held || l.topics[0] === CORE_TOPICS.released ? 1 : 2]}:${hexToBigInt(l.topics[l.topics[0] === CORE_TOPICS.held || l.topics[0] === CORE_TOPICS.released ? 2 : 3])}`;
  const proposals = new Map<string, PendingPrice>();
  for (const l of core) {
    const t0 = l.topics[0];
    if (t0 === CORE_TOPICS.proposed) {
      const feed = l.topics[2];
      const expiry = hexToBigInt(l.topics[3]);
      if ((expiry & TRADE_HOLD_TAG) !== 0n && (expiry & TRADE_PRICE_TAG) === 0n) continue;
      proposals.set(key(l), { feed, expiry, kind: "price", label: "" });
    } else if (t0 === CORE_TOPICS.set || t0 === CORE_TOPICS.cancelled) {
      proposals.delete(key(l));
    } else if (t0 === CORE_TOPICS.held) {
      const e = hexToBigInt(l.topics[2]);
      proposals.set(`${l.topics[1]}:${TRADE_HOLD_TAG | e}`, { feed: l.topics[1], expiry: TRADE_HOLD_TAG | e, kind: "hold", label: "" });
    } else if (t0 === CORE_TOPICS.released) {
      proposals.delete(`${l.topics[1]}:${TRADE_HOLD_TAG | hexToBigInt(l.topics[2])}`);
    }
  }
  // The queued ops: CallScheduled (index 0 only) and their salts.
  const salts = new Map<string, Hex>();
  const ops: Op[] = [];
  for (const [tl, queue] of [["A", chain.tlA], ["B", chain.tlB]] as const) {
    for (const l of logs.filter(on(queue))) {
      if (l.topics[0] === CALL_SALT_TOPIC) salts.set(l.topics[1].toLowerCase(), decodeAbiParameters([{ type: "bytes32" }], l.data)[0]);
    }
    for (const l of logs.filter(on(queue))) {
      if (l.topics[0] !== CALL_SCHEDULED_TOPIC || hexToBigInt(l.topics[2]) !== 0n) continue;
      const [target, value, data, predecessor, delay] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "uint256" }],
        l.data,
      );
      ops.push({ queue, tl, id: l.topics[1], target: getAddress(target), value, data, predecessor, salt: pad("0x00", { size: 32 }), delay, readyAt: 0 });
    }
  }
  for (const o of ops) o.salt = salts.get(o.id.toLowerCase()) ?? pad("0x00", { size: 32 });
  const approveLogs = logs.filter((l) => l.topics[0] === APPROVE_HASH_TOPIC);
  return { accounts, proposals: [...proposals.values()], ops, approveLogs };
}

/** The second read: the queues' delays, each logged account's listed and
 *  removed words, each price proposal's word, each op's timestamp. */
export function secondCalls(chain: FirmChain, logs: readonly Log[]): Call[] {
  const f = fromLogs(chain, logs);
  const words: Hex[] = [];
  for (const a of f.accounts) words.push(mapSlot(addrKey(a), slot(24)), mapSlot(addrKey(a), GUARDIAN_REMOVED));
  for (const p of f.proposals) if (p.kind === "price") words.push(pendingSlot(p.feed, p.expiry));
  const calls: Call[] = [
    { target: chain.tlA, callData: encodeFunctionData({ abi: TIMELOCK_ABI, functionName: "getMinDelay" }) },
    { target: chain.tlB, callData: encodeFunctionData({ abi: TIMELOCK_ABI, functionName: "getMinDelay" }) },
    { target: chain.core, callData: encodeFunctionData({ abi: CORE_ABI, functionName: "extSloads", args: [words] }) },
  ];
  for (const o of f.ops) calls.push({ target: o.queue, callData: encodeFunctionData({ abi: TIMELOCK_ABI, functionName: "getTimestamp", args: [o.id] }) });
  return calls;
}

function pendingSlot(feed: Hex, expiry: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [feed, expiry])), MANUAL_BASE]));
}

const word = (w: Hex | undefined) => (w ? hexToBigInt(w) : 0n);
const ET = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "10 Nov 2026, 19:09 ET": an expiry's end second (tags dropped), in New York time. */
const endOf = (expiry: bigint) => `${ET.format(new Date(Number(expiry & ((1n << 40n) - 1n)) * 1000))} ET`;

/** A pending price's choice: "Trade 0xa07e…9931", or the pair of a feed. */
function priceLabel(p: PendingPrice): string {
  return p.kind === "hold" || (p.expiry & TRADE_PRICE_TAG) !== 0n ? `Trade ${short(p.feed)}` : feedLabel(p.feed);
}

/** "Trade hold · ends 10 Nov 2026, 19:09 ET". */
function priceLine(p: PendingPrice): string {
  const kind = p.kind === "hold" ? "Trade hold" : (p.expiry & TRADE_PRICE_TAG) !== 0n ? "Trade price" : "Manual price";
  return `${kind} · ends ${endOf(p.expiry)}`;
}
const feedLabel = (feed: Hex) => LISTED.find((p) => p.feedId === feed.toLowerCase())?.symbol ?? short(feed);

/** The state from the three reads. Throws read-failed on a bad answer. */
export function stateFrom(chain: FirmChain, first: readonly (Hex | null)[], logs: readonly Log[], second: readonly (Hex | null)[]): ChainState {
  try {
    const need = (h: Hex | null | undefined) => {
      if (!h) throw new Error("a read failed");
      return h;
    };
    const safes = GROUPS.map((group, i) => ({
      group,
      safe: chain.safes[group],
      owners: [...decodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", data: need(first[3 * i]) })].map((o) => getAddress(o)),
      threshold: Number(decodeFunctionResult({ abi: SAFE_ABI, functionName: "getThreshold", data: need(first[3 * i + 1]) })),
      nonce: Number(decodeFunctionResult({ abi: SAFE_ABI, functionName: "nonce", data: need(first[3 * i + 2]) })),
    }));
    let i = 3 * GROUPS.length;
    const paused = decodeFunctionResult({ abi: CORE_ABI, functionName: "hardPaused", data: need(first[i++]) });
    const pausedAt = decodeFunctionResult({ abi: CORE_ABI, functionName: "hardPausedAt", data: need(first[i++]) });
    const tlA = decodeFunctionResult({ abi: CORE_ABI, functionName: "roleHolder", data: need(first[i++]) });
    const tlB = decodeFunctionResult({ abi: CORE_ABI, functionName: "roleHolder", data: need(first[i++]) });
    const now = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp", data: need(first[i++]) });
    const [spots, adapters, bands] = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: "entries", data: need(first[i++]) });
    const w = decodeFunctionResult({ abi: CORE_ABI, functionName: "extSloads", data: need(first[i++]) });
    if (!isAddressEqual(tlA, chain.tlA) || !isAddressEqual(tlB, chain.tlB)) throw new Error("the change queues moved: this build lists others");
    const f = fromLogs(chain, logs);
    const delayA = decodeFunctionResult({ abi: TIMELOCK_ABI, functionName: "getMinDelay", data: need(second[0]) });
    const delayB = decodeFunctionResult({ abi: TIMELOCK_ABI, functionName: "getMinDelay", data: need(second[1]) });
    const w2 = decodeFunctionResult({ abi: CORE_ABI, functionName: "extSloads", data: need(second[2]) });
    const members: Address[] = [];
    const removed: Address[] = [];
    f.accounts.forEach((a, j) => {
      if (word(w2[2 * j]) !== 0n) members.push(a);
      else if (word(w2[2 * j + 1]) !== 0n) removed.push(a);
    });
    let k = 2 * f.accounts.length;
    const pending = f.proposals
      .filter((p) => p.kind === "hold" || (word(w2[k++]) >> 160n) & ((1n << 64n) - 1n))
      .map((p) => ({ ...p, label: priceLabel(p) }));
    const ops = f.ops
      .map((o, j) => ({ ...o, readyAt: Number(decodeFunctionResult({ abi: TIMELOCK_ABI, functionName: "getTimestamp", data: need(second[3 + j]) })) }))
      .filter((o) => o.readyAt > 1);
    const depositsOpen = (word(w[2]) & 0xffn) !== 0n;
    return {
      chainId: chain.chainId,
      account: zeroAddress,
      now,
      core: chain.core,
      registry: chain.registry,
      tlA: getAddress(tlA),
      tlB: getAddress(tlB),
      delayA,
      delayB,
      safes,
      paused,
      pausedAt,
      depositsOpen,
      houseSeat: getAddress(pad(toHex(word(w[0]) & ((1n << 160n) - 1n)), { size: 20 })),
      crankSeat: getAddress(pad(toHex(word(w[1]) & ((1n << 160n) - 1n)), { size: 20 })),
      markets: LISTED.map((p, j) => ({ pair: p.symbol, pairId: pairIdOf(p.symbol), enabled: (word(w[5 + j]) & 0xffn) !== 0n, paused: ((word(w[5 + j]) >> 8n) & 0xffn) !== 0n })),
      feeds: spots.map((feed, j) => ({ feed, label: feedLabel(feed), adapter: getAddress(adapters[j]), bands: [...bands[j]].map(Number) })),
      members,
      removed,
      pending,
      ops,
      approveLogs: f.approveLogs,
      params: { 6: word(w[3]) & 0xffffn, 10: word(w[4]) & ((1n << 64n) - 1n) },
    };
  } catch (e) {
    if (e instanceof FirmDriverError) throw e;
    throw new FirmDriverError("read-failed", e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// The catalogue.

type Route = "safe" | "tlA" | "tlB";
type ContractKey = keyof typeof CONTRACT_NAMES;

/** One target call of an action. */
interface Inner {
  route: Route;
  to: Address;
  name: ContractKey;
  data: Hex;
}

/** What an action builds: its plan, the Safe's call, the queued op and the
 *  calls to simulate from their real caller. */
export interface Built {
  plan: ActionPlan;
  to: Address;
  data: Hex;
  op: Op | null;
  sims: { from: Address; to: Address; data: Hex }[];
  /** Addresses that must hold code (a new version must also answer the
   *  UUPS proxiableUUID with the ERC-1967 slot). The page adds each code
   *  hash to the plan's last call. */
  code: CodeCheck[];
}

export interface CodeCheck {
  address: Address;
  uups: boolean;
}

/** The ERC-1967 implementation slot: a UUPS version's proxiableUUID(). */
export const ERC1967_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** The code a call names: a new version, or a new price source. */
function codeOf(fn: string, args: readonly unknown[]): CodeCheck[] {
  if (fn === "upgradeToAndCall") return [{ address: getAddress(String(args[0])), uups: true }];
  if (fn === "setPriceAdapter" && !isAddressEqual(String(args[1]) as Address, zeroAddress)) return [{ address: getAddress(String(args[1])), uups: false }];
  return [];
}

/** A simulation of one call from one caller: true when it does not revert. */
export type Sim = (from: Address, to: Address, data: Hex) => Promise<boolean>;

interface Words {
  title: string;
  effect: string;
}

interface Def {
  fields(st: ChainState, sim: Sim): Promise<ActionField[]>;
  /** Fields that show only while another field holds one of some values. */
  when?: Readonly<Record<string, FieldWhen>>;
  /** The target call for these values; throws not-now or changed. */
  inner(st: ChainState, v: ActionValues): Inner;
  words(st: ChainState, v: ActionValues): Words;
  /** Values from a target call of this action, or null. */
  match(route: Route, fn: string, args: readonly unknown[], st: ChainState): ActionValues | null;
}

const enc = (abi: Abi, functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi, functionName, args } as never);
const core = (st: ChainState, fn: string, args: readonly unknown[], route: Route = "safe"): Inner => ({ route, to: st.core, name: "core", data: enc(CORE_ABI as Abi, fn, args) });
const registry = (st: ChainState, fn: string, args: readonly unknown[], route: Route = "safe"): Inner => ({ route, to: st.registry, name: "registry", data: enc(REGISTRY_ABI as Abi, fn, args) });

const notNow = (why: string) => new FirmDriverError("not-now", why);
const changed = (why: string) => new FirmDriverError("changed", why);

/** A choice value that must be one of the options. */
function pick(v: ActionValues, id: string, options: readonly FieldOption[]): string {
  const x = v[id];
  if (options.length === 0) throw notNow(`nothing to choose for ${id}`);
  if (x === undefined || !options.some((o) => o.value === x)) throw changed(`${id} ${x ?? "missing"} is not among the current choices`);
  return x;
}

const choice = (id: keyof typeof FIELD_LABELS, options: FieldOption[]): ActionField => ({ id, label: FIELD_LABELS[id], kind: "choice", options });
const pairOptions = (pairs: readonly string[]) => pairs.map((p) => ({ value: p, label: p }));
const memberOptions = (list: readonly Address[]) => list.map((a) => ({ value: a, label: short(a), line: a }));

/** The pairs whose call from `from` does not revert now. */
async function pairsWhere(st: ChainState, sim: Sim, from: Address, data: (pairId: Hex) => Hex): Promise<string[]> {
  const ok = await Promise.all(st.markets.map((m) => sim(from, st.core, data(m.pairId))));
  return st.markets.filter((_, i) => ok[i]).map((m) => m.pair);
}

const safeAddr = (st: ChainState, g: GroupId) => st.safes.find((s) => s.group === g)!;

function keyFields(st: ChainState, g: GroupId): ActionField[] {
  const s = safeAddr(st, g);
  return [
    choice("change", [
      { value: "add", label: WORDS.addKey },
      { value: "remove", label: WORDS.removeKey },
      { value: "replace", label: WORDS.replaceKey },
      { value: "approvals", label: WORDS.setApprovals },
    ]),
    choice("key", memberOptions(s.owners)),
    { id: "newKey", label: FIELD_LABELS.newKey, kind: "address" },
    // The approvals a change may set: up to the keys it leaves.
    {
      id: "approvals",
      label: FIELD_LABELS.approvals,
      kind: "number",
      min: 1,
      max: s.owners.length + 1,
      maxFor: { field: "change", max: { add: s.owners.length + 1, remove: s.owners.length - 1, approvals: s.owners.length } },
    },
  ];
}

function keyInner(st: ChainState, g: GroupId, v: ActionValues): Inner {
  const s = safeAddr(st, g);
  const change = v.change;
  const prevOf = (k: Address) => {
    const i = s.owners.findIndex((o) => isAddressEqual(o, k));
    if (i < 0) throw changed(`${k} holds no key`);
    return i === 0 ? SENTINEL_OWNERS : s.owners[i - 1];
  };
  const n = v.approvals ? Number(v.approvals) : s.threshold;
  const newKey = () => {
    if (!v.newKey || !isAddress(v.newKey, { strict: false }) || isAddressEqual(getAddress(v.newKey), zeroAddress)) throw changed("the new key's address is not a full address");
    const a = getAddress(v.newKey);
    if (s.owners.some((o) => isAddressEqual(o, a))) throw notNow(`${a} already holds a key`);
    return a;
  };
  const self = (fn: string, args: readonly unknown[]): Inner => ({ route: "safe", to: s.safe, name: g, data: enc(SAFE_ABI as Abi, fn, args) });
  if (change === "add") {
    if (n < 1 || n > s.owners.length + 1) throw changed("approvals out of range");
    return self("addOwnerWithThreshold", [newKey(), BigInt(n)]);
  }
  if (change === "remove") {
    const k = getAddress(pick(v, "key", memberOptions(s.owners)));
    const m = Math.min(n, s.owners.length - 1);
    if (s.owners.length <= 1 || m < 1) throw notNow("the last key cannot go");
    return self("removeOwner", [prevOf(k), k, BigInt(m)]);
  }
  if (change === "replace") {
    const k = getAddress(pick(v, "key", memberOptions(s.owners)));
    return self("swapOwner", [prevOf(k), k, newKey()]);
  }
  if (change === "approvals") {
    if (n < 1 || n > s.owners.length) throw changed("approvals out of range");
    if (n === s.threshold) throw notNow(`the wallet already needs ${n}`);
    return self("changeThreshold", [BigInt(n)]);
  }
  throw changed(`change ${change ?? "missing"}`);
}

function keyWords(st: ChainState, g: GroupId, v: ActionValues): Words {
  const s = safeAddr(st, g);
  const n = v.approvals ? Number(v.approvals) : s.threshold;
  const role = CONTRACT_NAMES[g];
  const keys = (k: number) => `${k} ${k === 1 ? "key" : "keys"}`;
  const needs = (k: number) => `${k} ${k === 1 ? "approval" : "approvals"} needed`;
  if (v.change === "add") return { title: `Add key ${short(v.newKey ?? "")}`, effect: `${role}: ${keys(s.owners.length + 1)}, ${needs(n)}.` };
  if (v.change === "remove") return { title: `Remove key ${short(v.key ?? "")}`, effect: `${role}: ${keys(s.owners.length - 1)}, ${needs(Math.min(n, s.owners.length - 1))}.` };
  if (v.change === "replace") return { title: `Replace key ${short(v.key ?? "")}`, effect: `${role}: ${short(v.newKey ?? "")} holds the key of ${short(v.key ?? "")}.` };
  return { title: `Change the approvals needed to ${n}`, effect: `${role}: ${n} of ${s.owners.length} approvals needed.` };
}

function keyMatch(fn: string, args: readonly unknown[]): ActionValues | null {
  if (fn === "addOwnerWithThreshold") return { change: "add", newKey: String(args[0]), approvals: String(args[1]) };
  if (fn === "removeOwner") return { change: "remove", key: String(args[1]), approvals: String(args[2]) };
  if (fn === "swapOwner") return { change: "replace", key: String(args[1]), newKey: String(args[2]) };
  if (fn === "changeThreshold") return { change: "approvals", approvals: String(args[0]) };
  return null;
}

const listedPair = (st: ChainState, pairId: unknown) => st.markets.some((m) => m.pairId.toLowerCase() === String(pairId).toLowerCase());
const pairOf = (st: ChainState, pairId: unknown) => st.markets.find((m) => m.pairId.toLowerCase() === String(pairId).toLowerCase())?.pair ?? short(String(pairId));

const stopAll = (route: Route): Def => ({
  async fields() {
    return [];
  },
  inner(st) {
    if (st.paused) throw notNow("trading is already stopped");
    return core(st, "setHardPause", [true], route);
  },
  words: () => ({ title: "Stop all trading on CRX", effect: "Trading on CRX stops. Only the Multisig unpauses it." }),
  match: (r, fn, args) => (r === route && fn === "setHardPause" && args[0] === true ? {} : null),
});

/** The rule changes the 72-hour queue takes from the Multisig. */
async function ruleOptions(st: ChainState, sim: Sim): Promise<FieldOption[]> {
  const out: FieldOption[] = [];
  const opens = await pairsWhere(st, sim, st.tlA, (id) => enc(CORE_ABI as Abi, "setMarket", [NDF, id, true, false]));
  const delists = await pairsWhere(st, sim, st.tlA, (id) => enc(CORE_ABI as Abi, "setMarket", [NDF, id, false, false]));
  for (const p of opens) if (!st.markets.find((m) => m.pair === p && m.enabled && !m.paused)) out.push({ value: `open:${p}`, label: `Open ${p}` });
  for (const p of delists) out.push({ value: `delist:${p}`, label: `Delist ${p}`, line: "All open trades on the pair then end at a final price." });
  for (const f of st.feeds) if (f.bands.some((b) => b === 0)) out.push({ value: `bands:${f.feed}`, label: `Restore the halted tenors of ${f.label}`, line: "Each halted tenor returns at its widest band." });
  for (const [k, p] of Object.entries(PARAMS)) {
    const cur = st.params[Number(k) as keyof typeof PARAMS];
    out.push({ value: `param:${k}`, label: `Set: ${p.label}`, line: cur !== undefined ? `Now ${paramShown(Number(k) as ParamKey, cur)}` : undefined });
  }
  return out;
}

function ruleInner(st: ChainState, v: ActionValues): Inner {
  const rule = v.rule ?? "";
  const [kind, arg] = [rule.slice(0, rule.indexOf(":")), rule.slice(rule.indexOf(":") + 1)];
  if (kind === "open" || kind === "delist") {
    const m = st.markets.find((x) => x.pair === arg);
    if (!m) throw changed(`pair ${arg}`);
    return core(st, "setMarket", [NDF, m.pairId, kind === "open", false], "tlA");
  }
  if (kind === "bands") {
    const f = st.feeds.find((x) => x.feed.toLowerCase() === arg.toLowerCase());
    if (!f) throw changed(`source ${arg}`);
    if (!f.bands.some((b) => b === 0)) throw notNow("no tenor of this source is halted");
    return registry(st, "setCurveBands", [f.feed, f.bands.map((b, i) => (b === 0 ? BAND_CEILINGS[i] : b))], "tlA");
  }
  if (kind === "param") {
    const k = Number(arg) as ParamKey;
    const p = PARAMS[k];
    if (!p) throw changed(`parameter ${arg}`);
    const raw = scaled(v[`value:${k}`], p.decimals);
    if (raw === null) throw changed(`${p.label}: a number with up to ${p.decimals} decimal places`);
    if (raw < p.min || raw > p.max) throw changed(`${p.label}: ${paramShown(k, p.min)} to ${paramShown(k, p.max)}`);
    return core(st, "setParam", [k, raw], "tlA");
  }
  throw changed(`rule ${rule || "missing"}`);
}

function ruleWords(st: ChainState, v: ActionValues): Words {
  const rule = v.rule ?? "";
  const arg = rule.slice(rule.indexOf(":") + 1);
  if (rule.startsWith("open:")) return { title: `Open ${arg}`, effect: `${arg} opens for trading.` };
  if (rule.startsWith("delist:")) return { title: `Delist ${arg}`, effect: `${arg} closes. Its open trades end at a final price.` };
  if (rule.startsWith("bands:")) return { title: `Restore the halted tenors of ${st.feeds.find((f) => f.feed.toLowerCase() === arg.toLowerCase())?.label ?? short(arg)}`, effect: "Each halted tenor returns at its widest band." };
  const p = PARAMS[Number(arg) as keyof typeof PARAMS];
  const raw = p ? scaled(v[`value:${arg}`], p.decimals) : null;
  const shown = p && raw !== null ? paramShown(Number(arg) as ParamKey, raw) : (v[`value:${arg}`] ?? "");
  return { title: `Set ${p?.label ?? `parameter ${arg}`} to ${shown}`, effect: `${p?.label ?? "The parameter"} becomes ${shown}.` };
}

function ruleMatch(route: Route, fn: string, args: readonly unknown[], st: ChainState): ActionValues | null {
  if (route !== "tlA") return null;
  if (fn === "setMarket" && args[0] === NDF && args[3] === false && listedPair(st, args[1])) return { rule: `${args[2] ? "open" : "delist"}:${pairOf(st, args[1])}` };
  if (fn === "setCurveBands") {
    // Only the catalogue's exact bands: each halted tenor at its ceiling.
    const f = st.feeds.find((x) => x.feed.toLowerCase() === String(args[0]).toLowerCase());
    const want = f?.bands.map((b, i) => (b === 0 ? BAND_CEILINGS[i] : b));
    const got = [...(args[1] as readonly number[])].map(Number);
    return want && want.length === got.length && want.every((b, i) => b === got[i]) ? { rule: `bands:${String(args[0])}` } : null;
  }
  if (fn === "setParam") {
    const p = PARAMS[Number(args[0]) as ParamKey];
    return p ? { rule: `param:${String(args[0])}`, [`value:${String(args[0])}`]: decimalOf(BigInt(String(args[1])), p.decimals).replace(/,/g, "") } : null;
  }
  return null;
}

/** The sources a feed can take: each source a listed feed reads now, or none. */
function sourceOptions(st: ChainState, feed: Feed): FieldOption[] {
  const known = [...new Map(st.feeds.filter((f) => f.adapter !== zeroAddress).map((f) => [f.adapter.toLowerCase(), f.adapter])).values()];
  const serves = (a: Address) => st.feeds.filter((f) => isAddressEqual(f.adapter, a)).map((f) => f.label).join(", ");
  const out: FieldOption[] = known.filter((a) => !isAddressEqual(a, feed.adapter)).map((a) => ({ value: a, label: short(a), line: `Serves ${serves(a)}` }));
  if (feed.adapter !== zeroAddress) out.push({ value: zeroAddress, label: WORDS.none });
  return out;
}

/** The field id of a pair's new source: one field per pair, shown while
 *  that pair is the chosen source. */
const newSourceId = (feed: Hex) => `newSource:${feed.toLowerCase()}`;

const tenorOptions = () => [{ value: "all", label: WORDS.allTenors }, ...TENORS.map((name, i) => ({ value: String(i), label: name }))];

const DEFS: Record<string, Def> = {
  "stop:stop-all": stopAll("safe"),
  "stop:pause-pair": {
    async fields(st, sim) {
      return [choice("pair", pairOptions(await pairsWhere(st, sim, safeAddr(st, "stop").safe, (id) => enc(CORE_ABI as Abi, "setMarket", [NDF, id, true, true]))))];
    },
    inner(st, v) {
      const m = st.markets.find((x) => x.pair === v.pair);
      if (!m) throw changed(`pair ${v.pair ?? "missing"}`);
      if (!m.enabled || m.paused) throw notNow(`${m.pair} is not open`);
      return core(st, "setMarket", [NDF, m.pairId, true, true]);
    },
    words: (_st, v) => ({ title: `Pause ${v.pair}`, effect: `${v.pair} stops trading. The Multisig reopens it.` }),
    match: (r, fn, args, st) => (r === "safe" && fn === "setMarket" && args[0] === NDF && args[2] === true && args[3] === true && listedPair(st, args[1]) ? { pair: pairOf(st, args[1]) } : null),
  },
  "stop:remove-member": {
    async fields(st) {
      return [choice("member", memberOptions(st.members))];
    },
    inner(st, v) {
      return core(st, "setWhitelist", [getAddress(pick(v, "member", memberOptions(st.members))), false]);
    },
    words: (_st, v) => ({ title: `Remove member ${short(v.member ?? "")}`, effect: "The member can no longer trade. Only a 72-hour change re-admits it." }),
    match: (r, fn, args) => (r === "safe" && fn === "setWhitelist" && args[1] === false ? { member: getAddress(String(args[0])) } : null),
  },
  "stop:halt-source": {
    async fields(st) {
      return [choice("source", st.feeds.filter((f) => f.adapter !== zeroAddress).map((f) => ({ value: f.feed, label: f.label }))), choice("tenor", tenorOptions())];
    },
    inner(st, v) {
      const f = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase());
      if (!f) throw changed(`source ${v.source ?? "missing"}`);
      if (f.adapter === zeroAddress) throw notNow(`${f.label} is already halted`);
      if (v.tenor === "all") return registry(st, "setPriceAdapter", [f.feed, zeroAddress]);
      const i = Number(v.tenor);
      if (!Number.isInteger(i) || i < 0 || i >= TENORS.length) throw changed(`tenor ${v.tenor ?? "missing"}`);
      if (f.bands[i] === 0) throw notNow(`${f.label} ${TENORS[i]} is already halted`);
      return registry(st, "haltCurveTenor", [f.feed, i]);
    },
    words: (st, v) => {
      const label = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase())?.label ?? short(v.source ?? "");
      return v.tenor === "all"
        ? { title: `Halt the ${label} price source`, effect: `${label} prices stop. Only a 72-hour change restores the source.` }
        : { title: `Halt the ${TENORS[Number(v.tenor)] ?? v.tenor} tenor of ${label}`, effect: `The ${TENORS[Number(v.tenor)] ?? v.tenor} tenor of ${label} stops. Only a 72-hour change restores it.` };
    },
    match: (r, fn, args) => {
      if (r !== "safe") return null;
      if (fn === "setPriceAdapter" && isAddressEqual(String(args[1]) as Address, zeroAddress)) return { source: String(args[0]), tenor: "all" };
      if (fn === "haltCurveTenor") return { source: String(args[0]), tenor: String(args[1]) };
      return null;
    },
  },
  "stop:cancel-hold": {
    async fields(st) {
      return [choice("hold", st.pending.map((p) => ({ value: `${p.feed}:${p.expiry}`, label: p.label, line: priceLine(p) })))];
    },
    inner(st, v) {
      const opts = st.pending.map((p) => ({ value: `${p.feed}:${p.expiry}`, label: p.label }));
      const [feed, expiry] = pick(v, "hold", opts).split(":");
      return core(st, "cancelManualPrice", [feed as Hex, BigInt(expiry)]);
    },
    words: (st, v) => {
      const p = st.pending.find((x) => `${x.feed}:${x.expiry}` === v.hold);
      return p?.kind === "hold"
        ? { title: `Release the hold of trade ${short(p.feed)}`, effect: "The trade settles on its pair's own prices. The release is final." }
        : { title: `Cancel the manual price of ${p?.label ?? "the pair"}`, effect: "The manual price never takes effect." };
    },
    match: (r, fn, args) => (r === "safe" && fn === "cancelManualPrice" ? { hold: `${String(args[0])}:${String(args[1])}` } : null),
  },
  "stop:backup-operator": {
    async fields() {
      return [];
    },
    inner(st) {
      if (isAddressEqual(st.crankSeat, st.houseSeat)) throw notNow("settlement already runs from the backup operator");
      return core(st, "setCrankSeat", [st.houseSeat]);
    },
    words: () => ({ title: "Move settlement to the backup operator", effect: "Settlement runs from the CRX backup operator. A 72-hour change moves it back." }),
    match: (r, fn, args, st) => (r === "safe" && fn === "setCrankSeat" && isAddressEqual(String(args[0]) as Address, st.houseSeat) ? {} : null),
  },
  // The Guardian (one approval) takes one key change from the page: the
  // caller replaces its own key. Other key changes stay on the Multisig.
  "stop:wallet-keys": {
    async fields() {
      return [{ id: "newKey", label: FIELD_LABELS.newKey, kind: "address" }];
    },
    inner(st, v) {
      const s = safeAddr(st, "stop");
      if (!s.owners.some((o) => isAddressEqual(o, st.account))) throw notNow("this wallet holds no Guardian key");
      return keyInner(st, "stop", { change: "replace", key: st.account, newKey: v.newKey ?? "" });
    },
    words: (st, v) => ({ title: `Replace your key with ${short(v.newKey ?? "")}`, effect: `Guardian: ${short(v.newKey ?? "")} holds the key of ${short(st.account)}. This wallet no longer approves on the Guardian.` }),
    // Only the caller's own key: another key's swap reads as Other.
    match: (r, fn, args, st) => (r === "safe" && fn === "swapOwner" && isAddressEqual(String(args[1]) as Address, st.account) ? { newKey: getAddress(String(args[2])) } : null),
  },

  "restart:restart": {
    async fields() {
      return [];
    },
    inner(st) {
      if (!st.paused) throw notNow("trading is not stopped");
      return core(st, "liftHardPause", [st.pausedAt, st.pausedAt + WEEK_SECONDS * liftWindow(st.pausedAt, st.now)]);
    },
    words: () => ({ title: "Unpause trading on CRX", effect: "Trading on CRX resumes." }),
    match: (r, fn, args, st) => (r === "safe" && fn === "liftHardPause" && BigInt(String(args[0])) === st.pausedAt ? {} : null),
  },
  "restart:reopen-pair": {
    async fields(st, sim) {
      return [choice("pair", pairOptions(await pairsWhere(st, sim, safeAddr(st, "restart").safe, (id) => enc(CORE_ABI as Abi, "reopenMarket", [NDF, id]))))];
    },
    inner(st, v) {
      const m = st.markets.find((x) => x.pair === v.pair);
      if (!m) throw changed(`pair ${v.pair ?? "missing"}`);
      if (st.paused) throw notNow("trading is stopped: unpause first");
      if (!m.enabled || !m.paused) throw notNow(`${m.pair} is not paused`);
      return core(st, "reopenMarket", [NDF, m.pairId]);
    },
    words: (_st, v) => ({ title: `Reopen ${v.pair}`, effect: `${v.pair} reopens for trading.` }),
    match: (r, fn, args, st) => (r === "safe" && fn === "reopenMarket" && args[0] === NDF && listedPair(st, args[1]) ? { pair: pairOf(st, args[1]) } : null),
  },
  "restart:stop-all": stopAll("tlB"),
  "restart:deposits": {
    async fields(st) {
      return [choice("state", [st.depositsOpen ? { value: "close", label: WORDS.close } : { value: "open", label: WORDS.open }])];
    },
    inner(st, v) {
      const open = v.state === "open";
      if (v.state !== "open" && v.state !== "close") throw changed(`state ${v.state ?? "missing"}`);
      if (open === st.depositsOpen) throw notNow(`deposits are already ${open ? "open" : "closed"}`);
      return core(st, "setDepositsOpen", [open], "tlB");
    },
    words: (_st, v) => (v.state === "open" ? { title: "Open deposits", effect: "Members can deposit." } : { title: "Close deposits", effect: "New deposits stop. Withdrawals go on." }),
    match: (r, fn, args) => (r === "tlB" && fn === "setDepositsOpen" ? { state: args[0] ? "open" : "close" } : null),
  },
  "restart:price-source": {
    async fields(st) {
      return [
        choice("source", st.feeds.map((f) => ({ value: f.feed, label: f.label, line: f.adapter === zeroAddress ? "Halted" : `Source ${short(f.adapter)}` }))),
        ...st.feeds.map((f): ActionField => ({ ...choice("feedSource", sourceOptions(st, f)), id: newSourceId(f.feed), when: { field: "source", in: [f.feed] } })),
      ];
    },
    inner(st, v) {
      const f = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase());
      if (!f) throw changed(`source ${v.source ?? "missing"}`);
      const a = getAddress(pick(v, newSourceId(f.feed), sourceOptions(st, f)));
      if (isAddressEqual(a, f.adapter)) throw notNow(`${f.label} already reads that source`);
      // A halt goes through the upgrade queue (registry owner); a repoint of
      // a listed feed through the 72-hour queue.
      return registry(st, "setPriceAdapter", [f.feed, a], a === zeroAddress ? "tlB" : "tlA");
    },
    words: (st, v) => {
      const label = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase())?.label ?? short(v.source ?? "");
      const to = v[newSourceId((v.source ?? "0x") as Hex)] ?? "";
      return to && isAddressEqual(to as Address, zeroAddress)
        ? { title: `Halt the ${label} price source`, effect: `${label} prices stop.` }
        : { title: `Set the ${label} price source to ${short(to)}`, effect: `${label} prices come from ${short(to)}.` };
    },
    // A halt through the upgrade queue, a repoint through the 72-hour queue.
    match: (r, fn, args) => {
      if (fn !== "setPriceAdapter") return null;
      const halt = isAddressEqual(String(args[1]) as Address, zeroAddress);
      return (halt && r === "tlB") || (!halt && r === "tlA") ? { source: String(args[0]), [newSourceId(String(args[0]) as Hex)]: getAddress(String(args[1])) } : null;
    },
  },
  "restart:upgrade": {
    async fields() {
      return [{ id: "version", label: FIELD_LABELS.version, kind: "address" }];
    },
    inner(st, v) {
      if (!v.version || !isAddress(v.version, { strict: false })) throw changed("the new version's address is not a full address");
      return core(st, "upgradeToAndCall", [getAddress(v.version), "0x"], "tlB");
    },
    words: (_st, v) => ({ title: `Upgrade the settlement system to ${short(v.version ?? "")}`, effect: `The CRX settlement contract runs the code at ${short(v.version ?? "")}.` }),
    // Only an upgrade with no call: a call in the data runs with the queue's power.
    match: (r, fn, args) => (r === "tlB" && fn === "upgradeToAndCall" && args[1] === "0x" ? { version: getAddress(String(args[0])) } : null),
  },
  "restart:schedule-rule": {
    when: Object.fromEntries(Object.keys(PARAMS).map((k) => [`value:${k}`, { field: "rule", in: [`param:${k}`] }])),
    async fields(st, sim) {
      const values: ActionField[] = (Object.entries(PARAMS) as [string, (typeof PARAMS)[ParamKey]][]).map(([k, p]) => ({
        id: `value:${k}`,
        label: FIELD_LABELS.value,
        kind: "number",
        min: Number(decimalOf(p.min, p.decimals).replace(/,/g, "")),
        max: Number(decimalOf(p.max, p.decimals).replace(/,/g, "")),
        unit: p.unit,
        decimals: p.decimals,
      }));
      return [choice("rule", await ruleOptions(st, sim)), ...values];
    },
    inner: ruleInner,
    words: ruleWords,
    match: ruleMatch,
  },
  "restart:readmit-member": {
    async fields(st) {
      return [choice("member", memberOptions(st.removed))];
    },
    inner(st, v) {
      return core(st, "setWhitelist", [getAddress(pick(v, "member", memberOptions(st.removed))), true], "tlA");
    },
    words: (_st, v) => ({ title: `Re-admit member ${short(v.member ?? "")}`, effect: "The member can trade again." }),
    match: (r, fn, args) => (r === "tlA" && fn === "setWhitelist" && args[1] === true ? { member: getAddress(String(args[0])) } : null),
  },
  "restart:cancel-scheduled": {
    async fields(st) {
      return [choice("scheduled", st.ops.map((o) => ({ value: o.id, label: describeOp(o, st).title, line: `${o.tl === "A" ? CONTRACT_NAMES.tlA : CONTRACT_NAMES.tlB} · ${o.id.slice(0, 10)}` })))];
    },
    inner(st, v) {
      const o = st.ops.find((x) => x.id.toLowerCase() === (v.scheduled ?? "").toLowerCase());
      if (!o) throw changed(`scheduled change ${v.scheduled ?? "missing"}`);
      return { route: "safe", to: o.queue, name: o.tl === "A" ? "tlA" : "tlB", data: enc(TIMELOCK_ABI as Abi, "cancel", [o.id]) };
    },
    words: (st, v) => {
      const o = st.ops.find((x) => x.id.toLowerCase() === (v.scheduled ?? "").toLowerCase());
      return { title: `Cancel: ${o ? describeOp(o, st).title : short(v.scheduled ?? "")}`, effect: "The scheduled change never runs." };
    },
    match: (r, fn, args) => (r === "safe" && fn === "cancel" ? { scheduled: String(args[0]) } : null),
  },
  "restart:wallet-keys": {
    fields: async (st) => keyFields(st, "restart"),
    when: {
      key: { field: "change", in: ["remove", "replace"] },
      newKey: { field: "change", in: ["add", "replace"] },
      approvals: { field: "change", in: ["add", "remove", "approvals"] },
    },
    inner: (st, v) => keyInner(st, "restart", v),
    words: (st, v) => keyWords(st, "restart", v),
    // A key change runs from the Safe itself; through a queue it reverts.
    match: (r, fn, args) => (r === "safe" ? keyMatch(fn, args) : null),
  },

  // The Steward wallet: the firms hold no key; the plan shows what CRX runs.
  "members:admit-remove": {
    when: { member: { field: "change", in: ["remove"] }, newMember: { field: "change", in: ["admit"] } },
    async fields(st) {
      return [choice("change", [{ value: "admit", label: WORDS.admit }, { value: "remove", label: WORDS.remove }]), choice("member", memberOptions(st.members)), { id: "newMember", label: FIELD_LABELS.newMember, kind: "address" }];
    },
    inner(st, v) {
      if (v.change === "remove") return core(st, "setWhitelist", [getAddress(pick(v, "member", memberOptions(st.members))), false]);
      if (!v.newMember || !isAddress(v.newMember, { strict: false })) throw changed("the new member's address is not a full address");
      return core(st, "setWhitelist", [getAddress(v.newMember), true]);
    },
    words: (_st, v) =>
      v.change === "remove"
        ? { title: `Remove member ${short(v.member ?? "")}`, effect: "The member can no longer trade." }
        : { title: `Admit member ${short(v.newMember ?? "")}`, effect: "The member can trade. Its key must be on record first." },
    match: (r, fn, args): ActionValues | null => (r === "safe" && fn === "setWhitelist" ? (args[1] ? { change: "admit", newMember: String(args[0]) } : { change: "remove", member: String(args[0]) }) : null),
  },
  "members:publish-prices": {
    async fields() {
      return [];
    },
    inner: (st) => core(st, "bindCurve", [st.now, st.feeds.map((f) => f.feed), []]),
    words: () => ({ title: "Publish prices", effect: "The signed prices of every source take effect." }),
    match: (r, fn) => (r === "safe" && fn === "bindCurve" ? {} : null),
  },
  "members:manual-price": {
    async fields(st) {
      return [choice("source", st.feeds.map((f) => ({ value: f.feed, label: f.label }))), { id: "price", label: FIELD_LABELS.price, kind: "number", min: 0.00000001, max: PRICE_MAX, decimals: PRICE_DECIMALS }];
    },
    inner(st, v) {
      const f = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase());
      if (!f) throw changed(`source ${v.source ?? "missing"}`);
      const price = scaled(v.price, PRICE_DECIMALS);
      if (price === null || price <= 0n || price > BigInt(PRICE_MAX) * 10n ** BigInt(PRICE_DECIMALS)) throw changed(`price: above 0 and at most ${PRICE_MAX.toLocaleString("en-US")}, up to ${PRICE_DECIMALS} decimal places`);
      return core(st, "setManualPrice", [f.feed, st.now, price, -PRICE_DECIMALS, [0n, 0n, 0n, 0n, 0n, 0n]]);
    },
    words: (st, v) => {
      const price = scaled(v.price, PRICE_DECIMALS);
      const label = st.feeds.find((x) => x.feed.toLowerCase() === (v.source ?? "").toLowerCase())?.label ?? "";
      return { title: `Set a manual price of ${price === null ? "—" : decimalOf(price, PRICE_DECIMALS)} for ${label}`.trim(), effect: "The price takes effect after a 2 h wait. The Guardian can cancel it." };
    },
    match: (r, fn, args) =>
      r === "safe" && fn === "setManualPrice" && (BigInt(String(args[1])) & (TRADE_HOLD_TAG | TRADE_PRICE_TAG)) === 0n && Number(args[3]) === -PRICE_DECIMALS
        ? { source: String(args[0]), price: decimalOf(BigInt(String(args[2])), PRICE_DECIMALS).replace(/,/g, "") }
        : null,
  },
  "members:hold-trade": {
    async fields() {
      return [];
    },
    inner: (st) => core(st, "setManualPrice", [pad("0x00", { size: 32 }), TRADE_HOLD_TAG, 1n, -8, [0n, 0n, 0n, 0n, 0n, 0n]]),
    words: () => ({ title: "Hold a trade, then set its price", effect: "The trade waits for its own price, set after a 2 h wait." }),
    match: (r, fn, args) => (r === "safe" && fn === "setManualPrice" && (BigInt(String(args[1])) & (TRADE_HOLD_TAG | TRADE_PRICE_TAG)) !== 0n ? {} : null),
  },
};

function defOf(a: WalletAction): Def {
  const d = DEFS[`${a.group}:${a.id}`];
  if (!d) throw new FirmDriverError("not-now", `${a.group}:${a.id} is not an action of that wallet`);
  return d;
}

/** An action's inputs from chain state, each with its `when`. */
export async function actionFields(a: WalletAction, st: ChainState, sim: Sim): Promise<ActionField[]> {
  const d = defOf(a);
  return (await d.fields(st, sim)).map((f) => (d.when?.[f.id] ? { ...f, when: d.when[f.id] } : f));
}

/** The values without those of hidden fields. */
function shownValues(d: Def, v: ActionValues): ActionValues {
  if (!d.when) return v;
  return Object.fromEntries(Object.entries(v).filter(([id]) => {
    const w = d.when?.[id];
    return !w || w.in.includes(v[w.field] ?? "");
  }));
}

/** The Details rows of one call. */
function callRows(st: ChainState, to: Address, data: Hex): ActionCall {
  const name = nameOf(st, to);
  try {
    const d = decodeFunctionData({ abi: CALL_ABI, data });
    const item = (CALL_ABI as Abi).find((x) => x.type === "function" && x.name === d.functionName && x.inputs.length === (d.args?.length ?? 0)) as { inputs: readonly { name?: string; type: string }[] };
    const fn = `${d.functionName}(${item.inputs.map((i) => i.type).join(",")})`;
    const all = (d.args ?? []) as readonly unknown[];
    const args = item.inputs.map((inp, i) => ({ name: inp.name ?? `arg${i}`, value: argShown(st, d.functionName, inp.name ?? "", all[i], all) }));
    return { name, to, fn, args };
  } catch {
    return { name, to, fn: data.slice(0, 10), args: [{ name: "data", value: data }] };
  }
}

/** "9 Nov 2026, 19:15 ET" for a unix second. */
const etTime = (sec: bigint) => `${ET.format(new Date(Number(sec) * 1000))} ET`;

/** A queued call in one line: "CRX settlement contract · setParam(Off-market band, 250 bp)". */
function queuedShown(st: ChainState, target: Address, data: Hex): string {
  try {
    const d = decodeFunctionData({ abi: CALL_ABI, data });
    const item = (CALL_ABI as Abi).find((x) => x.type === "function" && x.name === d.functionName) as { inputs: readonly { name?: string }[] };
    const all = (d.args ?? []) as readonly unknown[];
    return `${nameOf(st, target)} · ${d.functionName}(${item.inputs.map((inp, i) => argShown(st, d.functionName, inp.name ?? "", all[i], all)).join(", ")})`;
  } catch {
    return `${nameOf(st, target)} · ${data}`;
  }
}

/** One argument in human units, with the raw value where a unit applies. */
function argShown(st: ChainState, fn: string, name: string, x: unknown, all: readonly unknown[]): string {
  const big = () => BigInt(String(x));
  switch (`${fn}.${name}`) {
    case "schedule.data":
    case "execute.payload":
      return queuedShown(st, getAddress(String(all[0])), x as Hex);
    case "schedule.delay": {
      const sec = big();
      return `${sec} s (${Number(sec) / 3600} h)`;
    }
    case "setParam.key":
      return `${String(x)} (${PARAMS[Number(x) as ParamKey]?.label ?? "parameter"})`;
    case "setParam.val": {
      const p = PARAMS[Number(all[0]) as ParamKey];
      return p ? `${paramShown(Number(all[0]) as ParamKey, big())} (raw ${big()})` : show(x);
    }
    case "setManualPrice.price":
      return `${decimalOf(big(), -Number(all[3]))} (raw ${big()})`;
    case "setManualPrice.fwd":
      return `[${(x as readonly bigint[]).map((f) => decimalOf(f, -Number(all[3]))).join(", ")}]`;
    case "setManualPrice.expiry":
    case "cancelManualPrice.expiry": {
      const e = big();
      const tag = (e & TRADE_HOLD_TAG) !== 0n ? "trade hold, ends " : (e & TRADE_PRICE_TAG) !== 0n ? "trade price, ends " : "";
      return `${e} (${tag}${endOf(e)})`;
    }
    case "liftHardPause.pausedAtWas":
    case "liftHardPause.notAfter":
    case "bindCurve.fixTime":
      return `${big()} (${etTime(big())})`;
    case "setMarket.instrument":
    case "reopenMarket.instrument":
      return Number(x) === NDF ? `${NDF} (NDF)` : show(x);
    case "setMarket.pairId":
    case "reopenMarket.pairId":
      return listedPair(st, x) ? `${pairOf(st, x)} (${String(x)})` : show(x);
    case "setPriceAdapter.spotFeedId":
    case "haltCurveTenor.spotFeedId":
    case "setCurveBands.spotFeedId": {
      const f = st.feeds.find((y) => y.feed.toLowerCase() === String(x).toLowerCase());
      return f ? `${f.label} (${String(x)})` : show(x);
    }
    case "haltCurveTenor.tenorIndex":
      return `${String(x)} (${TENORS[Number(x)] ?? "tenor"})`;
    case "setCurveBands.bands":
      return `${show(x)} bp`;
    case "addOwnerWithThreshold._threshold":
    case "removeOwner._threshold":
    case "changeThreshold._threshold":
      return `${String(x)} ${String(x) === "1" ? "approval" : "approvals"}`;
    case "upgradeToAndCall.data":
      return x === "0x" ? "none (0x)" : show(x);
  }
  return show(x);
}

function show(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(show).join(", ")}]`;
  if (typeof x === "bigint") return x.toString();
  return String(x);
}

function nameOf(st: ChainState, to: Address): string {
  if (isAddressEqual(to, st.core)) return CONTRACT_NAMES.core;
  if (isAddressEqual(to, st.registry)) return CONTRACT_NAMES.registry;
  if (isAddressEqual(to, st.tlA)) return CONTRACT_NAMES.tlA;
  if (isAddressEqual(to, st.tlB)) return CONTRACT_NAMES.tlB;
  const s = st.safes.find((x) => isAddressEqual(x.safe, to));
  return s ? CONTRACT_NAMES[s.group] : CONTRACT_NAMES.other;
}

const queueOf = (st: ChainState, r: Route) => (r === "tlA" ? { queue: st.tlA, tl: "A" as const, delay: st.delayA } : { queue: st.tlB, tl: "B" as const, delay: st.delayB });

/** The op a schedule of `inner` makes at the Safe's number. */
function opOf(st: ChainState, inner: Inner, nonce: number): Op {
  const q = queueOf(st, inner.route);
  const salt = saltOf(nonce);
  const predecessor = pad("0x00", { size: 32 });
  const id = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }], [inner.to, 0n, inner.data, predecessor, salt]));
  return { queue: q.queue, tl: q.tl, id, target: inner.to, value: 0n, data: inner.data, predecessor, salt, delay: q.delay, readyAt: 0 };
}

/** The state once an action with these values takes effect. */
function doneOf(group: GroupId, id: ActionId, st: ChainState, v: ActionValues): string {
  const label = (feed?: string) => st.feeds.find((f) => f.feed.toLowerCase() === (feed ?? "").toLowerCase())?.label ?? short(feed ?? "");
  const s = (a?: string) => short(a ?? "");
  switch (id) {
    case "stop-all":
      return DONE.stopped;
    case "restart":
      return DONE.restarted;
    case "pause-pair":
      return DONE.paused(v.pair ?? "");
    case "reopen-pair":
      return DONE.open(v.pair ?? "");
    case "remove-member":
      return DONE.removed(s(v.member));
    case "readmit-member":
      return DONE.memberAgain(s(v.member));
    case "halt-source":
      return v.tenor === "all" ? DONE.sourceHalted(label(v.source)) : DONE.tenorHalted(TENORS[Number(v.tenor)] ?? String(v.tenor), label(v.source));
    case "cancel-hold": {
      const p = st.pending.find((x) => `${x.feed}:${x.expiry}` === v.hold);
      return p?.kind === "hold" ? DONE.holdReleased(short(p.feed)) : DONE.priceCancelled(p?.label ?? "the pair");
    }
    case "backup-operator":
      return DONE.backupOperator;
    case "wallet-keys":
      if (group === "stop") return DONE.yourKey;
      if (v.change === "add") return DONE.keyAdded(s(v.newKey));
      if (v.change === "remove") return DONE.removed(s(v.key));
      if (v.change === "replace") return DONE.keyReplaced(s(v.key), s(v.newKey));
      return DONE.approvals(Number(v.approvals));
    case "deposits":
      return v.state === "open" ? DONE.depositsOpen : DONE.depositsClosed;
    case "price-source":
    {
      const to = v[newSourceId((v.source ?? "0x") as Hex)];
      return to && isAddressEqual(to as Address, zeroAddress) ? DONE.sourceHalted(label(v.source)) : DONE.sourceSet(label(v.source), s(to));
    }
    case "upgrade":
      return DONE.upgraded(s(v.version));
    case "schedule-rule": {
      const rule = v.rule ?? "";
      const arg = rule.slice(rule.indexOf(":") + 1);
      if (rule.startsWith("open:")) return DONE.open(arg);
      if (rule.startsWith("delist:")) return DONE.delisted(arg);
      if (rule.startsWith("bands:")) return DONE.tenorsRestored(label(arg));
      const p = PARAMS[Number(arg) as keyof typeof PARAMS];
      const raw = p ? scaled(v[`value:${arg}`], p.decimals) : null;
      return DONE.param(p?.label ?? `Parameter ${arg}`, p && raw !== null ? paramShown(Number(arg) as ParamKey, raw) : (v[`value:${arg}`] ?? ""));
    }
    case "cancel-scheduled":
      return DONE.cancelled;
    case "admit-remove":
      return v.change === "remove" ? DONE.removed(s(v.member)) : DONE.member(s(v.newMember));
    case "publish-prices":
      return DONE.published;
    case "manual-price":
      return DONE.manualPrice(label(v.source));
    case "hold-trade":
      return DONE.held;
  }
}

/** An action with these values: its plan, the Safe's call and its sims.
 *  Throws not-now (the action does not apply now) or changed (a value is no
 *  longer among the choices). */
export function buildAction(a: WalletAction, st: ChainState, values: ActionValues, nonce?: number): Built {
  const d = defOf(a);
  const v = shownValues(d, values);
  const s = safeAddr(st, a.group);
  const inner = d.inner(st, v);
  const w = d.words(st, v);
  const dec = decodeFunctionData({ abi: CALL_ABI, data: inner.data });
  const code = codeOf(dec.functionName, (dec.args ?? []) as readonly unknown[]);
  if (inner.route === "safe") {
    return {
      plan: { safe: s.safe, title: w.title, effect: w.effect, done: doneOf(a.group, a.id, st, v), needed: s.threshold, delayHours: 0, calls: [callRows(st, inner.to, inner.data)], number: nonce ?? s.nonce },
      to: inner.to,
      data: inner.data,
      op: null,
      sims: [{ from: s.safe, to: inner.to, data: inner.data }],
      code,
    };
  }
  const op = opOf(st, inner, nonce ?? s.nonce);
  const data = enc(TIMELOCK_ABI as Abi, "schedule", [op.target, 0n, op.data, op.predecessor, op.salt, op.delay]);
  return {
    plan: { safe: s.safe, title: w.title, effect: w.effect, done: doneOf(a.group, a.id, st, v), needed: s.threshold, delayHours: Number(op.delay) / 3600, calls: [callRows(st, op.queue, data), callRows(st, inner.to, inner.data)], number: nonce ?? s.nonce },
    to: op.queue,
    data,
    op,
    sims: [
      { from: s.safe, to: op.queue, data },
      { from: op.queue, to: inner.to, data: inner.data },
    ],
    code,
  };
}

/** The contract each catalogue function lives on. A call to any other
 *  address reads as "Other request". */
const FN_TARGET: Readonly<Record<string, "core" | "registry" | "self" | "queue">> = {
  setHardPause: "core",
  setMarket: "core",
  liftHardPause: "core",
  reopenMarket: "core",
  setWhitelist: "core",
  setCrankSeat: "core",
  cancelManualPrice: "core",
  setDepositsOpen: "core",
  setParam: "core",
  upgradeToAndCall: "core",
  setManualPrice: "core",
  bindCurve: "core",
  setPriceAdapter: "registry",
  haltCurveTenor: "registry",
  setCurveBands: "registry",
  addOwnerWithThreshold: "self",
  removeOwner: "self",
  swapOwner: "self",
  changeThreshold: "self",
  cancel: "queue",
};

function targetKind(st: ChainState, group: GroupId, to: Address): string {
  if (isAddressEqual(to, st.core)) return "core";
  if (isAddressEqual(to, st.registry)) return "registry";
  if (isAddressEqual(to, safeAddr(st, group).safe)) return "self";
  if (isAddressEqual(to, st.tlA) || isAddressEqual(to, st.tlB)) return "queue";
  return "other";
}

/** The action a Safe's call names, its plan, and the op it schedules. A
 *  call the catalogue does not list: action null, "Other request". */
export function describeSafeCall(group: GroupId, to: Address, data: Hex, st: ChainState, number: number | null = null): { action: ActionId | null; plan: ActionPlan; op: Op | null; code: CodeCheck[] } {
  const s = safeAddr(st, group);
  let route: Route = "safe";
  let target = to;
  let inner = data;
  let op: Op | null = null;
  let delay = 0;
  try {
    const top = decodeFunctionData({ abi: TIMELOCK_ABI, data });
    if (top.functionName === "schedule" && (isAddressEqual(to, st.tlA) || isAddressEqual(to, st.tlB))) {
      const [t2, value, d2, predecessor, salt, dl] = top.args as readonly [Address, bigint, Hex, Hex, Hex, bigint];
      route = isAddressEqual(to, st.tlA) ? "tlA" : "tlB";
      target = getAddress(t2);
      inner = d2;
      delay = Number(dl);
      const id = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }], [target, value, d2, predecessor, salt]));
      op = { queue: getAddress(to), tl: route === "tlA" ? "A" : "B", id, target, value, data: d2, predecessor, salt, delay: dl, readyAt: 0 };
    }
  } catch {
    // Not a queue call.
  }
  const calls = op ? [callRows(st, to, data), callRows(st, target, inner)] : [callRows(st, to, data)];
  try {
    const dec = decodeFunctionData({ abi: CALL_ABI, data: inner });
    const args = (dec.args ?? []) as readonly unknown[];
    if (FN_TARGET[dec.functionName] !== targetKind(st, group, target)) throw new Error("not the action's contract");
    for (const [key, def] of Object.entries(DEFS)) {
      const [g, id] = key.split(":") as [GroupId, ActionId];
      if (g !== group) continue;
      const v = def.match(route, dec.functionName, args, st);
      if (!v) continue;
      const w = def.words(st, v);
      return { action: id, plan: { safe: s.safe, title: w.title, effect: w.effect, done: doneOf(group, id, st, v), needed: s.threshold, delayHours: delay / 3600, calls, number }, op, code: codeOf(dec.functionName, args) };
    }
  } catch {
    // Unknown function.
  }
  return { action: null, plan: { safe: s.safe, title: WORDS.otherTitle, effect: WORDS.otherEffect, done: DONE.other, needed: s.threshold, delayHours: delay / 3600, calls, number }, op, code: [] };
}

/** The plan of a change a queue holds. */
export function describeOp(o: Op, st: ChainState): ActionPlan {
  const data = enc(TIMELOCK_ABI as Abi, "schedule", [o.target, o.value, o.data, o.predecessor, o.salt, o.delay]);
  const run = enc(TIMELOCK_ABI as Abi, "execute", [o.target, o.value, o.data, o.predecessor, o.salt]);
  const plan = describeSafeCall("restart", o.queue, data, st).plan;
  // The call a run sends: the queue's execute, the queued call under it.
  return { ...plan, calls: [callRows(st, o.queue, run), callRows(st, o.target, o.data)], number: null };
}
