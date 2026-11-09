// Browser-safe. The check guide of a send (components/discover/desk/
// approvals/VerifyGuide): numbered steps that compare what the firm's wallet
// shows with the send, one of them a check outside this page.
//
// What the firm's wallet sends (firm-live), amount 0:
//
//   approve   approveHash(hash) on the wallet (Safe), with the request's
//             fields after the hash: a Multisig start or approval
//   execute   execTransaction on the wallet with the request's to, value,
//             data and operation: a Guardian start, or the approval that
//             executes. A change through a queue with no wait then runs at
//             once: a second send, execute on the queue
//   run       execute(target, value, data, predecessor, salt) on the queue
//             of a scheduled change. No wallet hash: three steps
//
// The hash an approve or execute guide shows is the EIP-712 SafeTx hash of
// the fields it shows, recomputed here. `matches` false: the request carries
// another hash; the page shows the stop line and no steps, and takes no send.

import { toFunctionSelector, type Address, type Hex } from "viem";
import type { ActionCall, RequestTx, RunTx } from "./firm-driver.ts";
import { safeTxHash, ZERO_ADDRESS } from "./safe-tx.ts";

export type SendKind = "approve" | "execute" | "run";

/** What a guide reads: a request or a start on its wallet (`hash`: the hash
 *  a request carries; none for a start), or a scheduled change's run.
 *  `calls`, `delayHours`: the plan's, for the function name and an
 *  execute's second send. */
export type GuideInput =
  | { kind: "approve" | "execute"; safe: string; tx: RequestTx; hash?: string; calls?: readonly ActionCall[]; delayHours?: number }
  | { kind: "run"; op: RunTx; calls?: readonly ActionCall[] };

/** One value to compare: its label and its full text. */
export interface GuideValue {
  label: string;
  value: string;
}

/** One step: a title, one line and at most two values, none repeated in
 *  another step. `more`: values under a closed section. */
export interface GuideStep {
  title: string;
  line: string;
  /** The row of the wallet's screen this step checks. */
  row: string;
  values: readonly GuideValue[];
  more?: { label: string; values: readonly GuideValue[] };
  /** An outside check's address, on its own row under the line. */
  link?: string;
}

export interface VerifyGuideModel {
  title: string;
  /** Plays once per key per page load: the SafeTx hash, or the run's id. */
  key: string;
  /** The SafeTx hash; null for a run. */
  hash: Hex | null;
  matches: boolean;
  steps: readonly GuideStep[];
}

export const GUIDE_WORDS = {
  title: "Check before you confirm",
  mismatch: "The request hash does not match its details. Do not confirm it.",
} as const;

/** The outside check, shown in full in step 3 so that no search leads to a
 *  copy of the site. */
export const SAFE_UTILS = "https://safeutils.openzeppelin.com";

const APPROVE_FN = "approveHash(bytes32)";
const EXECUTE_FN = "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)";
const RUN_FN = "execute(address,uint256,bytes,bytes32,bytes32)";

const NETWORKS: Readonly<Record<number, string>> = { 1: "Ethereum", 31337: "Ethereum fork" };

/** "Ethereum (chain ID 1)". */
export function networkLine(chainId: number): string {
  return `${NETWORKS[chainId] ?? "Network"} (chain ID ${chainId})`;
}

/** The request's EIP-712 SafeTx hash on `safe`: no refund, no gas fields. */
export function requestHash(safe: string, tx: RequestTx): Hex {
  return safeTxHash({
    chainId: tx.chainId,
    safe,
    tx: { to: tx.to, value: tx.value, data: tx.data, operation: tx.operation as 0 | 1, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce: tx.nonce },
  });
}

/** The function `data` runs on `to`: the plan's signature for it when that
 *  signature gives the data's selector, else the selector alone. */
function callOf(to: Address, data: Hex, calls: readonly ActionCall[]): string {
  const sel = data.slice(0, 10).toLowerCase();
  const named = calls.find((c) => {
    try {
      return c.to.toLowerCase() === to.toLowerCase() && /^[A-Za-z_]\w*\(/.test(c.fn) && toFunctionSelector(c.fn) === sel;
    } catch {
      return false;
    }
  });
  return named ? `${named.fn} · ${sel}` : sel;
}

const operationOf = (op: number) => `${op} (${op === 0 ? "call" : "delegatecall"})`;

const ADDRESS_LINE = "Check every character.";
const AMOUNT: GuideStep = { title: "Amount: 0 ETH", line: "If any value differs, reject it in your wallet.", row: "Amount", values: [] };

/** The guide for one send. */
export function verifyGuide(g: GuideInput): VerifyGuideModel {
  const calls = g.calls ?? [];
  const run = `execute · ${toFunctionSelector(RUN_FN)}`;
  if (g.kind === "run") {
    const { op } = g;
    return {
      title: GUIDE_WORDS.title,
      key: `run:${op.queue}:${op.target}:${op.data}:${op.predecessor}:${op.salt}`.toLowerCase(),
      hash: null,
      matches: true,
      steps: [
        { title: "Address", line: ADDRESS_LINE, row: "To", values: [{ label: "Sends to", value: op.queue }] },
        {
          title: "Function and call",
          line: "Your wallet shows this function, then this target and the call data.",
          row: "Function",
          values: [
            { label: "Function", value: run },
            { label: "Target", value: op.target },
          ],
          more: {
            label: "Call data",
            values: [
              { label: "Call", value: callOf(op.target, op.data, calls) },
              { label: "Data", value: op.data },
              { label: "Value", value: op.value },
            ],
          },
        },
        AMOUNT,
      ],
    };
  }
  const { safe, tx } = g;
  const queue = g.kind === "execute" && g.delayHours === 0 && calls.length === 2 && calls[0].fn.startsWith("schedule(") ? calls[0] : null;
  const hash = requestHash(safe, tx);
  const matches = g.hash === undefined || g.hash.toLowerCase() === hash.toLowerCase();
  const approve = g.kind === "approve";
  const fn = `${approve ? "approveHash" : "execTransaction"} · ${toFunctionSelector(approve ? APPROVE_FN : EXECUTE_FN)}`;
  const steps: GuideStep[] = [
    { title: "Address", line: ADDRESS_LINE, row: "To", values: [{ label: "Sends to", value: safe }] },
    {
      title: "Function and hash",
      line: approve
        ? "Your wallet shows this function and hash. In raw data, the hash follows the function code."
        : queue
          ? "Your wallet shows this function with the To and Data under Values to enter, step 3, then execute on the queue."
          : "Your wallet shows this function with the To and Data under Values to enter, step 3.",
      row: "Function",
      values: [
        { label: "Function", value: fn },
        { label: "Request hash", value: hash },
        ...(queue
          ? [
              { label: "Then function", value: run },
              { label: "Then sends to", value: queue.to },
            ]
          : []),
      ],
    },
    {
      title: "Same request outside this page",
      line: `This page alone is not proof. At the link, enter step 1's address and the values below: the decoded call must be this change, and the hash must match ${approve ? "your wallet's" : "step 2's"}.`,
      link: SAFE_UTILS,
      row: approve ? "Hash" : "Data",
      values: [],
      more: {
        label: "Values to enter",
        values: [
          { label: "Network", value: networkLine(tx.chainId) },
          { label: "Request number (nonce)", value: String(tx.nonce) },
          { label: "To", value: tx.to },
          { label: "Data", value: tx.data },
          { label: "Value", value: tx.value },
          { label: "Operation", value: operationOf(tx.operation) },
          { label: "Other fields", value: "0 and the zero address" },
        ],
      },
    },
    AMOUNT,
  ];
  return { title: GUIDE_WORDS.title, key: hash.toLowerCase(), hash, matches, steps };
}
