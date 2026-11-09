// Browser-safe. The live FirmDriver: the chain, read and sent through the
// firm's own wallet (EIP-1193) alone. The transport is viem's custom
// transport over that wallet: no CRX server, no RPC URL in the page.
//
//   connect    eth_requestAccounts, eth_chainId, then the Safes' owners. A
//              chain the build does not list: wrong-network. An account that
//              owns none of the Safes: no-seat.
//   fields     each action's inputs, from chain reads (firm-actions).
//   plan       an action's review: title, effect, wait, exact calls and the
//              request's fields at the number start() uses.
//   start      Guardian (threshold 1): one execTransaction with the caller's
//              approved-hash entry (v = 1). Multisig: approveHash of the hash
//              the Safe's own getTransactionHash returns, with the SafeTx
//              fields after the hash, so any reader finds the proposal.
//   requests   ApproveHash logs of the Safes (eth_getLogs, chunks of at most
//              10 000 blocks over a recent window); each proposal's fields
//              from its transaction input; kept at the Safe's current number
//              when the Safe's own hash matches; approvals from
//              approvedHashes, in one Multicall3 eth_call.
//   approve    approveHash, with the fields.
//   execute    execTransaction with one v = 1 entry per approving owner, and
//              the caller's when an owner, owners ascending. A change through
//              the upgrade queue (delay 0) is then run at once: a second send.
//   scheduled  CallScheduled logs of both change queues, still pending.
//   run        execute on the change queue, once its wait is over.
//
// A chain with sends false refuses every send before the wallet sees it. A
// send waits 10 minutes at most for its receipt ("slow").

import { createClient, custom, decodeFunctionResult, encodeFunctionData, getAddress, isAddressEqual, keccak256, type Address, type Hex } from "viem";
import { approvedSignatures, approveWithFields, EXECUTION_SUCCESS_TOPIC, fieldsOfApproval, hashCallData, MULTICALL3_ABI, SAFE_ABI, safeTxArgs, safeTxItem, TIMELOCK_ABI, type HashedSafeTx } from "./firm-abi.ts";
import { actionFields, buildAction, describeOp, describeSafeCall, ERC1967_SLOT, firstCalls, logQuery, secondCalls, stateFrom, type Built, type ChainState, type CodeCheck, type Log, type Op, type Sim } from "./firm-actions.ts";
import type { FirmChain } from "./firm-chains.ts";
import {
  FirmDriverError,
  type ActionField,
  type ActionPlan,
  type ActionValues,
  type Connection,
  type FirmDriver,
  type FirmRequestLive,
  type GroupId,
  type RequestTx,
  type ScheduledChange,
  type Seat,
  type SendResult,
  type WalletAction,
} from "./firm-driver.ts";

/** An EIP-1193 provider. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

/** One wallet an EIP-6963 announcement names. */
export interface AnnouncedWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

/** The wallets that answer an EIP-6963 request within `waitMs`. */
export function discoverWallets(win: Window, waitMs = 300): Promise<AnnouncedWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, AnnouncedWallet>();
    const on = (e: Event) => {
      const d = (e as CustomEvent<AnnouncedWallet>).detail;
      if (d?.info?.uuid && d.provider) found.set(d.info.uuid, d);
    };
    win.addEventListener("eip6963:announceProvider", on);
    win.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      win.removeEventListener("eip6963:announceProvider", on);
      resolve([...found.values()]);
    }, waitMs);
  });
}

/** The first announced wallet, else window.ethereum. Throws no-wallet. */
export async function browserWallet(win: Window): Promise<Eip1193> {
  const [first] = await discoverWallets(win);
  if (first) return first.provider;
  const injected = (win as unknown as { ethereum?: Eip1193 }).ethereum;
  if (injected && typeof injected.request === "function") return injected;
  throw new FirmDriverError("no-wallet");
}

export interface LiveOptions {
  chains: readonly FirmChain[];
  /** The wallet, or how to find it (browserWallet in the page). */
  wallet: Eip1193 | (() => Promise<Eip1193>);
  /** Receipt poll interval in ms. Default 2000. */
  pollMs?: number;
  /** The longest wait for a receipt, in ms. Default 10 minutes. */
  receiptMs?: number;
}

interface Session {
  client: ReturnType<typeof makeClient>;
  account: Address;
  chain: FirmChain;
}

/** A proposal found on chain, with what its execute needs. */
interface Found extends FirmRequestLive {
  item: HashedSafeTx;
  approvers: Address[];
  op: Op | null;
}

const LOG_CHUNK = 10_000n;
const MIN_CHUNK = 500n;
/** Logs older than this many blocks are final and kept between reads. */
const FINAL_DEPTH = 64n;

/** Final logs by chain and query, shared by every driver of the page. */
const LOG_CACHE = new Map<string, { final: bigint; logs: Log[] }>();

function makeClient(provider: Eip1193) {
  return createClient({ transport: custom(provider, { retryCount: 0 }) });
}

/** The numeric codes along an error's cause chain. */
function codesOf(e: unknown): number[] {
  const out: number[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 8; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "number") out.push(c);
  }
  return out;
}

function textOf(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 8; x = (x as { cause?: unknown }).cause, i++) {
    const m = x as { message?: unknown; details?: unknown };
    if (typeof m.message === "string") parts.push(m.message);
    if (typeof m.details === "string") parts.push(m.details);
  }
  return parts.join(" | ");
}

/** One FirmDriverError for a wallet or chain failure. A read: read-failed.
 *  A send: rejected (the person declined), reverted (the chain refused the
 *  call), else send-refused (the wallet or network refused it). */
export function driverError(e: unknown, send: boolean): FirmDriverError {
  if (e instanceof FirmDriverError) return e;
  const codes = codesOf(e);
  const text = textOf(e);
  if (codes.includes(4001) || codes.includes(4100)) return new FirmDriverError("rejected", text);
  if (!send) return new FirmDriverError("read-failed", text);
  if (codes.includes(3) || /revert/i.test(text)) return new FirmDriverError("reverted", text);
  return new FirmDriverError("send-refused", text);
}

type Call = { target: Address; callData: Hex };

export function liveDriver(opts: LiveOptions): FirmDriver {
  const pollMs = opts.pollMs ?? 2000;
  const receiptMs = opts.receiptMs ?? 600_000;
  let session: Session | null = null;
  /** The request number each reviewed action showed, by action and values:
   *  start() sends at that number or not at all. */
  const reviewed = new Map<string, number | null>();
  const reviewKey = (a: WalletAction, v: ActionValues) => `${a.group}:${a.id}:${JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]))}`;
  const sentListeners = new Set<(tx: Hex) => void>();

  async function wallet(): Promise<Eip1193> {
    if (typeof opts.wallet !== "function") return opts.wallet;
    return opts.wallet();
  }

  async function rpc<T>(s: Pick<Session, "client">, method: string, params: unknown, send = false): Promise<T> {
    try {
      return (await s.client.request({ method, params } as never)) as T;
    } catch (e) {
      throw driverError(e, send);
    }
  }

  /** One Multicall3 eth_call. With `soft`, a failed call answers null. */
  async function multicall(s: Session, calls: readonly Call[], soft = false): Promise<(Hex | null)[]> {
    if (calls.length === 0) return [];
    const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls.map((c) => ({ ...c, allowFailure: soft }))] });
    const raw = await rpc<Hex>(s, "eth_call", [{ to: s.chain.multicall, data }, "latest"]);
    try {
      const rows = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw });
      if (rows.length !== calls.length) throw new Error("multicall: row count");
      return rows.map((r) => (r.success ? r.returnData : null));
    } catch (e) {
      throw new FirmDriverError("read-failed", textOf(e));
    }
  }

  /** The logs of `addresses` with a first topic in `topics`, from the
   *  chain's `fromBlock`, in calls of at most 10 000 blocks. Final logs stay
   *  in LOG_CACHE; each read scans only the blocks after them. */
  async function logsOf(s: Session, addresses: readonly Address[], topics: readonly Hex[]): Promise<Log[]> {
    const head = BigInt(await rpc<Hex>(s, "eth_blockNumber", undefined));
    const key = `${s.chain.chainId}|${addresses.join(",")}|${topics.join(",")}`.toLowerCase();
    const cached = LOG_CACHE.get(key) ?? { final: BigInt(s.chain.fromBlock) - 1n, logs: [] };
    const fresh: Log[] = [];
    let chunk = LOG_CHUNK;
    for (let from = cached.final + 1n; from <= head; ) {
      const to = from + chunk - 1n < head ? from + chunk - 1n : head;
      try {
        fresh.push(...(await rpc<Log[]>(s, "eth_getLogs", [{ address: addresses, topics: [topics], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }])));
        from = to + 1n;
      } catch (e) {
        // A wallet's network that caps the range: half the range, to 500.
        if (chunk > MIN_CHUNK && /range|limit|block|too many|exceed/i.test(textOf(e))) chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
        else throw e;
      }
    }
    const final = head > FINAL_DEPTH ? head - FINAL_DEPTH : 0n;
    if (final > cached.final) LOG_CACHE.set(key, { final, logs: [...cached.logs, ...fresh.filter((l) => BigInt(l.blockNumber) <= final)] });
    return [...cached.logs, ...fresh];
  }

  /** Every fact the catalogue reads: two Multicall3 calls and the logs. */
  async function readState(s: Session): Promise<ChainState> {
    const first = await multicall(s, firstCalls(s.chain), true);
    const q = logQuery(s.chain);
    const logs = await logsOf(s, q.addresses, q.topics);
    const second = await multicall(s, secondCalls(s.chain, logs), true);
    return { ...stateFrom(s.chain, first, logs, second), account: s.account };
  }

  /** One eth_call from `from`: false when it reverts. */
  const simOf =
    (s: Session): Sim =>
    async (from, to, data) => {
      try {
        await s.client.request({ method: "eth_call", params: [{ from, to, data }, "latest"] } as never);
        return true;
      } catch (e) {
        if (codesOf(e).includes(3) || /revert/i.test(textOf(e))) return false;
        throw driverError(e, false);
      }
    };

  /** Each named address's code hash, added to the plan's last call. A
   *  missing contract, or a version that does not answer proxiableUUID with
   *  the ERC-1967 slot: an error line in strict mode, a note otherwise. */
  async function codeChecks(s: Session, plan: ActionPlan, checks: readonly CodeCheck[], strict: boolean): Promise<ActionPlan> {
    if (checks.length === 0) return plan;
    const rows: { name: string; value: string }[] = [];
    for (const c of checks) {
      const code = await rpc<Hex>(s, "eth_getCode", [c.address, "latest"]);
      let problem = code === "0x" ? `no contract at ${c.address}` : null;
      if (!problem && c.uups) {
        try {
          const uuid = await s.client.request({ method: "eth_call", params: [{ to: c.address, data: "0x52d1902d" }, "latest"] } as never);
          if (String(uuid).toLowerCase() !== ERC1967_SLOT) problem = `${c.address} is not an upgradeable version (proxiableUUID)`;
        } catch {
          problem = `${c.address} is not an upgradeable version (proxiableUUID)`;
        }
      }
      if (problem && strict) throw new FirmDriverError("not-now", problem);
      rows.push({ name: `code hash of ${c.address}`, value: problem ?? keccak256(code) });
    }
    const calls = plan.calls.map((call, i) => (i === plan.calls.length - 1 ? { ...call, args: [...call.args, ...rows] } : call));
    return { ...plan, calls };
  }

  /** Refuses a built action whose calls revert now, or whose new code does
   *  not check; returns the plan with each code hash. */
  async function applies(s: Session, b: Built): Promise<ActionPlan> {
    const sim = simOf(s);
    for (const c of b.sims) if (!(await sim(c.from, c.to, c.data))) throw new FirmDriverError("not-now", `${b.plan.title}: the call reverts now`);
    return codeChecks(s, b.plan, b.code, true);
  }

  const owns = (s: Session, owners: readonly Address[]) => owners.some((o) => isAddressEqual(o, s.account));
  const safeOf = (st: ChainState, g: GroupId) => st.safes.find((x) => x.group === g)!;

  async function connect(): Promise<Connection> {
    const provider = await wallet();
    const client = makeClient(provider);
    const accounts = await rpc<string[]>({ client }, "eth_requestAccounts", undefined);
    if (!Array.isArray(accounts) || accounts.length === 0) throw new FirmDriverError("rejected");
    const chainId = Number(await rpc<string>({ client }, "eth_chainId", undefined));
    const chain = opts.chains.find((c) => c.chainId === chainId);
    if (!chain) throw new FirmDriverError("wrong-network", `chain ${chainId}`);
    const s: Session = { client, account: getAddress(accounts[0]), chain };
    const owners = await multicall(
      s,
      Object.values(chain.safes).map((safe) => ({ target: safe, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "getOwners" }) })),
    );
    const any = owners.some((o) => o && owns(s, decodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", data: o })));
    if (!any) throw new FirmDriverError("no-seat");
    session = s;
    const firm = chain.seats[s.account.toLowerCase()];
    return { account: s.account, chainId, sends: chain.sends, firm: firm ? { key: firm.key, label: firm.label, logo: firm.logo ?? null } : null };
  }

  async function current(): Promise<Session> {
    if (!session) await connect();
    return session!;
  }

  /** Refuses a send on a chain with sends off. */
  async function sendable(): Promise<Session> {
    const s = await current();
    if (!s.chain.sends) throw new FirmDriverError("sends-off");
    return s;
  }

  type Receipt = { status?: string; logs?: { address: string; topics: string[] }[] };

  /** Sends one call from the account; waits for its receipt (10 min at most). */
  async function send(s: Session, to: Address, data: Hex): Promise<{ tx: Hex; receipt: Receipt }> {
    // The wallet's network and account read again at the send: a wallet that
    // moved since the review gets no transaction. The transaction names its
    // chain, so the wallet refuses it on any other.
    const chainId = Number(await rpc<string>(s, "eth_chainId", undefined));
    if (chainId !== s.chain.chainId) throw new FirmDriverError("wrong-network", `chain ${chainId}`);
    const accounts = await rpc<string[]>(s, "eth_accounts", undefined);
    if (!Array.isArray(accounts) || !accounts[0] || !isAddressEqual(accounts[0] as Address, s.account)) throw new FirmDriverError("no-seat", "the wallet's account changed");
    const tx = await rpc<Hex>(s, "eth_sendTransaction", [{ from: s.account, to, data, chainId: `0x${s.chain.chainId.toString(16)}` }], true);
    for (const l of sentListeners) {
      try {
        l(tx);
      } catch {
        // A listener's failure does not stop the send's wait.
      }
    }
    const until = Date.now() + receiptMs;
    for (;;) {
      const r = await rpc<Receipt | null>(s, "eth_getTransactionReceipt", [tx]);
      if (r) {
        if (r.status !== "0x1") throw new FirmDriverError("reverted", `transaction ${tx}`);
        return { tx, receipt: r };
      }
      if (Date.now() >= until) throw new FirmDriverError("slow", `transaction ${tx}`);
      await new Promise((ok) => setTimeout(ok, pollMs));
    }
  }

  const executedIn = (r: Receipt, safe: Address, hash: Hex) =>
    (r.logs ?? []).some((l) => isAddressEqual(l.address as Address, safe) && l.topics[0] === EXECUTION_SUCCESS_TOPIC && l.topics[1]?.toLowerCase() === hash.toLowerCase());

  /** The proposals of the Safes at their current numbers, from the
   *  ApproveHash logs and the fields each proposer's input carries. */
  async function findRequests(s: Session, st: ChainState): Promise<Found[]> {
    // Each hash with its logs: the first log whose transaction carries
    // fields that hash to it names the proposal.
    const byHash = new Map<string, { safe: Address; txs: Hex[] }>();
    for (const l of st.approveLogs) {
      const key = `${l.address.toLowerCase()}|${l.topics[1].toLowerCase()}`;
      const at = byHash.get(key) ?? { safe: getAddress(l.address), txs: [] };
      if (!at.txs.includes(l.transactionHash)) at.txs.push(l.transactionHash);
      byHash.set(key, at);
    }
    const rows: { group: GroupId; item: HashedSafeTx; owners: Address[]; threshold: number; current: number }[] = [];
    for (const [key, at] of byHash) {
      const hash = key.split("|")[1];
      const f = st.safes.find((x) => isAddressEqual(x.safe, at.safe));
      if (!f) continue;
      for (const txh of at.txs) {
        const t = await rpc<{ input?: Hex } | null>(s, "eth_getTransactionByHash", [txh]);
        const fields = t?.input ? fieldsOfApproval(t.input) : null;
        // A proposal at the Safe's current number or later; an earlier one is spent.
        if (!fields || fields.nonce < f.nonce || fields.operation !== 0 || fields.value !== 0n || fields.hash.toLowerCase() !== hash) continue;
        const item = safeTxItem(s.chain.chainId, f.safe, fields.to, fields.data, fields.nonce);
        if (item.safeTxHash.toLowerCase() !== hash) continue;
        rows.push({ group: f.group, item, owners: f.owners, threshold: f.threshold, current: f.nonce });
        break;
      }
    }
    const calls: Call[] = [];
    for (const r of rows) {
      calls.push({ target: r.item.safe as Address, callData: hashCallData(r.item) });
      for (const o of r.owners) calls.push({ target: r.item.safe as Address, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "approvedHashes", args: [o, r.item.safeTxHash] }) });
    }
    const out = await multicall(s, calls);
    const found: Found[] = [];
    let i = 0;
    for (const r of rows) {
      const onChain = decodeFunctionResult({ abi: SAFE_ABI, functionName: "getTransactionHash", data: out[i++]! });
      const approvers = r.owners.filter(() => decodeFunctionResult({ abi: SAFE_ABI, functionName: "approvedHashes", data: out[i++]! }) !== 0n);
      if (onChain.toLowerCase() !== r.item.safeTxHash.toLowerCase() || approvers.length === 0) continue;
      const d = describeSafeCall(r.group, r.item.tx.to as Address, r.item.tx.data as Hex, st, r.item.tx.nonce);
      d.plan = await codeChecks(s, d.plan, d.code, false);
      const approvedByMe = approvers.some((a) => isAddressEqual(a, s.account));
      const mine = owns(s, r.owners) && !approvedByMe ? 1 : 0;
      found.push({
        id: r.item.safeTxHash,
        group: r.group,
        action: d.action,
        plan: d.plan,
        approvals: approvers.length,
        needed: r.threshold,
        number: r.item.tx.nonce,
        approvedByMe,
        canExecute: r.item.tx.nonce === r.current && approvers.length + mine >= r.threshold,
        waitsFor: r.item.tx.nonce > r.current ? r.item.tx.nonce - 1 : null,
        tx: txOf(r.item),
        item: r.item,
        approvers,
        op: d.op,
      });
    }
    return found;
  }

  async function byId(s: Session, id: Hex): Promise<{ r: Found; st: ChainState }> {
    const st = await readState(s);
    const r = (await findRequests(s, st)).find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!r) throw new FirmDriverError("changed", `no request ${id} at the Safe's number`);
    return { r, st };
  }

  /** Runs a change the upgrade queue holds with no wait, right after its
   *  schedule. */
  async function runNow(s: Session, op: Op): Promise<Hex> {
    const { tx } = await send(s, op.queue, encodeFunctionData({ abi: TIMELOCK_ABI, functionName: "execute", args: [op.target, op.value, op.data, op.predecessor, op.salt] }));
    return tx;
  }

  function execData(item: HashedSafeTx, signers: Address[]): Hex {
    return encodeFunctionData({ abi: SAFE_ABI, functionName: "execTransaction", args: [...safeTxArgs(item), approvedSignatures(signers)] });
  }

  /** The request number a start uses: the Safe's number for a wallet that
   *  executes alone; else the first number at or above it with no waiting
   *  proposal (contiguous). Refuses the same change waiting already. */
  async function startNumber(s: Session, st: ChainState, action: WalletAction, values: ActionValues): Promise<number> {
    const f = safeOf(st, action.group);
    if (f.threshold <= 1) return f.nonce;
    const waiting = (await findRequests(s, st)).filter((r) => r.group === action.group);
    const probe = buildAction(action, st, values);
    const same = waiting.find((r) =>
      r.op && probe.op
        ? isAddressEqual(r.op.queue, probe.op.queue) && isAddressEqual(r.op.target, probe.op.target) && r.op.data.toLowerCase() === probe.op.data.toLowerCase()
        : !r.op && !probe.op && isAddressEqual(r.item.tx.to as Address, probe.to) && r.item.tx.data.toLowerCase() === probe.data.toLowerCase(),
    );
    if (same) throw new FirmDriverError("changed", `this change waits as request ${same.number}`);
    const taken = new Set(waiting.map((r) => r.number));
    let n = f.nonce;
    while (taken.has(n)) n++;
    return n;
  }

  /** Executes a proposal whose approvals are in; then a no-wait change runs. */
  async function executeFound(s: Session, r: Found, signers: Address[]): Promise<SendResult> {
    const { tx, receipt } = await send(s, r.item.safe as Address, execData(r.item, signers));
    if (!executedIn(receipt, r.item.safe as Address, r.item.safeTxHash)) throw new FirmDriverError("reverted", `no ExecutionSuccess in ${tx}`);
    const count = new Set(signers.map((a) => a.toLowerCase())).size;
    // A direct call took effect; a 72-hour change is scheduled (plan.delayHours).
    if (!r.op || r.plan.delayHours > 0) return { tx, executed: true, approvals: count, needed: r.needed };
    const ran = await runNow(s, r.op);
    return { tx: ran, executed: true, approvals: count, needed: r.needed };
  }

  return {
    kind: "live",
    connect,

    onSent(listener: (tx: Hex) => void): () => void {
      sentListeners.add(listener);
      return () => {
        sentListeners.delete(listener);
      };
    },

    async seats(): Promise<readonly Seat[]> {
      const s = await current();
      const st = await readState(s);
      return st.safes.map((f) => ({ group: f.group, safe: f.safe, needed: f.threshold, keys: f.owners.length, mine: owns(s, f.owners), nonce: f.nonce, owners: [...f.owners] }));
    },

    async requests(): Promise<readonly FirmRequestLive[]> {
      const s = await current();
      return (await findRequests(s, await readState(s))).map(({ item: _i, approvers: _a, op: _o, ...r }) => r);
    },

    async fields(action: WalletAction): Promise<readonly ActionField[]> {
      const s = await current();
      return actionFields(action, await readState(s), simOf(s));
    },

    async plan(action: WalletAction, values: ActionValues): Promise<ActionPlan> {
      const s = await current();
      const st = await readState(s);
      const f = safeOf(st, action.group);
      // The Steward: firms hold no key, so its plan shows what CRX runs and
      // never refuses for the state now.
      if (action.group === "members") {
        const b = buildAction(action, st, values);
        return { ...b.plan, tx: txOf(safeTxItem(s.chain.chainId, f.safe, b.to, b.data, b.plan.number ?? f.nonce)) };
      }
      // The request start() makes: the reviewed number, so the same hash.
      const number = await startNumber(s, st, action, values);
      const b = buildAction(action, st, values, number);
      const plan = await applies(s, b);
      reviewed.set(reviewKey(action, values), plan.number);
      return { ...plan, tx: txOf(safeTxItem(s.chain.chainId, f.safe, b.to, b.data, number)) };
    },

    async start(action: WalletAction, values: ActionValues): Promise<SendResult> {
      const s = await sendable();
      const st = await readState(s);
      const f = safeOf(st, action.group);
      if (!owns(s, f.owners)) throw new FirmDriverError("no-seat");
      const nonce = await startNumber(s, st, action, values);
      // A proposal that landed since the review moves the next free number:
      // the review no longer names this request, so nothing is sent.
      const shown = reviewed.get(reviewKey(action, values));
      if (shown !== undefined && shown !== nonce) throw new FirmDriverError("changed", `the request number moved from ${shown} to ${nonce} since the review`);
      const b = buildAction(action, st, values, nonce);
      b.plan = await applies(s, b);
      const item = safeTxItem(s.chain.chainId, f.safe, b.to, b.data, nonce);
      const [onChain, mine] = await multicall(s, [
        { target: f.safe, callData: hashCallData(item) },
        { target: f.safe, callData: encodeFunctionData({ abi: SAFE_ABI, functionName: "approvedHashes", args: [s.account, item.safeTxHash] }) },
      ]);
      if (decodeFunctionResult({ abi: SAFE_ABI, functionName: "getTransactionHash", data: onChain! }).toLowerCase() !== item.safeTxHash.toLowerCase()) {
        throw new FirmDriverError("read-failed", `hash differs on ${f.safe}`);
      }
      if (f.threshold <= 1) {
        return executeFound(s, { ...stub(item, f.threshold), plan: b.plan, op: b.op }, [s.account]);
      }
      if (decodeFunctionResult({ abi: SAFE_ABI, functionName: "approvedHashes", data: mine! }) !== 0n) throw new FirmDriverError("changed", "this wallet already proposed this change");
      const { tx } = await send(s, f.safe, approveWithFields(item));
      const after = (await findRequests(s, await readState(s))).find((r) => r.id.toLowerCase() === item.safeTxHash.toLowerCase());
      return { tx, executed: false, approvals: after?.approvals ?? 1, needed: f.threshold };
    },

    async approve(id: Hex): Promise<SendResult> {
      const s = await sendable();
      const { r } = await byId(s, id);
      const f = r.item;
      if (r.approvedByMe) throw new FirmDriverError("changed", "this wallet already approved");
      const { owners } = (await readState(s)).safes.find((x) => x.group === r.group)!;
      if (!owns(s, owners)) throw new FirmDriverError("no-seat");
      const { tx } = await send(s, f.safe as Address, approveWithFields(f));
      return { tx, executed: false, approvals: r.approvals + 1, needed: r.needed };
    },

    async execute(id: Hex): Promise<SendResult> {
      const s = await sendable();
      const { r, st } = await byId(s, id);
      if (r.number !== safeOf(st, r.group).nonce) throw new FirmDriverError("not-now", `request ${r.number} runs after request ${r.number - 1}`);
      const signers = owns(s, safeOf(st, r.group).owners) ? [...r.approvers, s.account] : [...r.approvers];
      const count = new Set(signers.map((a) => a.toLowerCase())).size;
      if (count < r.needed) throw new FirmDriverError("changed", `${count} of ${r.needed} approvals`);
      return executeFound(s, r, signers);
    },

    async scheduled(): Promise<readonly ScheduledChange[]> {
      const s = await current();
      const st = await readState(s);
      return st.ops.map((o) => ({
        id: o.id,
        plan: describeOp(o, st),
        readyAt: o.readyAt,
        ready: o.readyAt <= Number(st.now),
        op: { queue: o.queue, target: o.target, value: o.value.toString(), data: o.data, predecessor: o.predecessor, salt: o.salt },
      }));
    },

    async run(id: Hex): Promise<SendResult> {
      const s = await sendable();
      const st = await readState(s);
      const op = st.ops.find((o) => o.id.toLowerCase() === id.toLowerCase());
      if (!op) throw new FirmDriverError("changed", `no scheduled change ${id}`);
      if (op.readyAt > Number(st.now)) throw new FirmDriverError("not-now", `ready at ${op.readyAt}`);
      const tx = await runNow(s, op);
      return { tx, executed: true, approvals: 0, needed: 0 };
    },
  };
}

/** A Found for a Safe the caller executes alone (threshold 1). */
function stub(item: HashedSafeTx, threshold: number): Omit<Found, "plan" | "op"> {
  return { id: item.safeTxHash, group: "stop", action: null, approvals: 1, needed: threshold, number: item.tx.nonce, approvedByMe: true, canExecute: true, waitsFor: null, tx: txOf(item), item, approvers: [] };
}

/** The fields a request's hash binds, as the page shows them. */
function txOf(item: HashedSafeTx): RequestTx {
  return { chainId: item.chainId, to: getAddress(item.tx.to), value: item.tx.value, data: item.tx.data as Hex, operation: item.tx.operation, nonce: item.tx.nonce };
}

