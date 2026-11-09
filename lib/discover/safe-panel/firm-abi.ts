// Browser-safe. The ABIs the live approvals page reads and calls: the Safe
// 1.4.1 functions and events, the two timelocks (OpenZeppelin
// TimelockController), Multicall3, and the SafeTx fields a proposer's
// approveHash carries after the hash.
//
// Imports viem alone, so a node test runs it with no loader.

import { concatHex, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, pad, toBytes, toHex, zeroAddress, type Address, type Hex } from "viem";
import { safeTxHash, type SafeTxItem } from "./safe-tx.ts";

const SAFE_TX_INPUTS = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" },
  { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" },
] as const;

/** The Safe 1.4.1 functions the page reads or calls. */
export const SAFE_ABI = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTransactionHash", stateMutability: "view", inputs: [...SAFE_TX_INPUTS, { name: "_nonce", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "approvedHashes",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "hash", type: "bytes32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "approveHash", stateMutability: "nonpayable", inputs: [{ name: "hashToApprove", type: "bytes32" }], outputs: [] },
  { type: "function", name: "execTransaction", stateMutability: "payable", inputs: [...SAFE_TX_INPUTS, { name: "signatures", type: "bytes" }], outputs: [{ name: "success", type: "bool" }] },
  {
    type: "function",
    name: "addOwnerWithThreshold",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "_threshold", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "removeOwner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prevOwner", type: "address" },
      { name: "owner", type: "address" },
      { name: "_threshold", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapOwner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prevOwner", type: "address" },
      { name: "oldOwner", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
  },
  { type: "function", name: "changeThreshold", stateMutability: "nonpayable", inputs: [{ name: "_threshold", type: "uint256" }], outputs: [] },
] as const;

/** keccak256("ApproveHash(bytes32,address)"): approvedHash and owner indexed. */
export const APPROVE_HASH_TOPIC = keccak256(toBytes("ApproveHash(bytes32,address)"));
/** keccak256("ExecutionSuccess(bytes32,uint256)"). */
export const EXECUTION_SUCCESS_TOPIC = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";
/** The Safe's owner list sentinel: the previous owner of the first owner. */
export const SENTINEL_OWNERS = "0x0000000000000000000000000000000000000001" as Address;

/** OpenZeppelin TimelockController (TL-A and TL-B). */
export const TIMELOCK_ABI = [
  {
    type: "function",
    name: "schedule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "delay", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTimestamp", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "hashOperation",
    stateMutability: "pure",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/** CallScheduled(bytes32 indexed id, uint256 indexed index, address target,
 *  uint256 value, bytes data, bytes32 predecessor, uint256 delay). */
export const CALL_SCHEDULED_TOPIC = keccak256(toBytes("CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)"));
/** CallSalt(bytes32 indexed id, bytes32 salt). */
export const CALL_SALT_TOPIC = keccak256(toBytes("CallSalt(bytes32,bytes32)"));

export const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
  { type: "function", name: "getCurrentBlockTimestamp", stateMutability: "view", inputs: [], outputs: [{ name: "timestamp", type: "uint256" }] },
] as const;

/** A SafeTx with its EIP-712 hash. */
export type HashedSafeTx = SafeTxItem & { safeTxHash: Hex };

/** The SafeTx of one call from a Safe at its number: no value, no refund.
 *  Operation 0 (call). */
export function safeTxItem(chainId: number, safe: Address, to: Address, data: Hex, nonce: number): HashedSafeTx {
  const item: SafeTxItem = {
    chainId,
    safe,
    tx: { to, value: "0", data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: zeroAddress, refundReceiver: zeroAddress, nonce },
  };
  return { ...item, safeTxHash: safeTxHash(item) };
}

/** The getTransactionHash and execTransaction arguments before the last one. */
export function safeTxArgs(item: SafeTxItem) {
  const t = item.tx;
  return [getAddress(t.to), BigInt(t.value), t.data as Hex, t.operation, BigInt(t.safeTxGas), BigInt(t.baseGas), BigInt(t.gasPrice), getAddress(t.gasToken), getAddress(t.refundReceiver)] as const;
}

/** The Safe's own getTransactionHash call for an item. */
export function hashCallData(item: SafeTxItem): Hex {
  return encodeFunctionData({ abi: SAFE_ABI, functionName: "getTransactionHash", args: [...safeTxArgs(item), BigInt(item.tx.nonce)] });
}

const APPENDED = [...SAFE_TX_INPUTS, { name: "nonce", type: "uint256" }] as const;

/** approveHash(hash) with the SafeTx fields after it, ABI-encoded. The Safe
 *  reads the hash alone; a reader finds the proposal's call in the bytes. */
export function approveWithFields(item: HashedSafeTx): Hex {
  const call = encodeFunctionData({ abi: SAFE_ABI, functionName: "approveHash", args: [item.safeTxHash] });
  return concatHex([call, encodeAbiParameters(APPENDED, [...safeTxArgs(item), BigInt(item.tx.nonce)])]);
}

/** The hash and the SafeTx fields of an approveHash input that carries them;
 *  null for any other input. */
export function fieldsOfApproval(input: Hex): { hash: Hex; to: Address; value: bigint; data: Hex; operation: number; nonce: number } | null {
  const sel = encodeFunctionData({ abi: SAFE_ABI, functionName: "approveHash", args: [pad("0x00", { size: 32 })] }).slice(0, 10);
  if (!input.toLowerCase().startsWith(sel) || input.length <= 10 + 64) return null;
  try {
    const hash = `0x${input.slice(10, 74)}` as Hex;
    const f = decodeAbiParameters(APPENDED, `0x${input.slice(74)}` as Hex);
    if (f[4] !== 0n || f[5] !== 0n || f[6] !== 0n || f[7] !== zeroAddress || f[8] !== zeroAddress) return null;
    return { hash, to: getAddress(f[0]), value: f[1], data: f[2], operation: f[3], nonce: Number(f[9]) };
  } catch {
    return null;
  }
}

/** execTransaction's `signatures`: one approved-hash entry per owner (r = the
 *  owner, s = 0, v = 1), owners ascending, each once. */
export function approvedSignatures(owners: readonly Address[]): Hex {
  const one = [...new Map(owners.map((o) => [o.toLowerCase(), getAddress(o)])).values()];
  one.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  return one.length === 0 ? "0x" : concatHex(one.map((o) => concatHex([pad(o, { size: 32 }), pad("0x00", { size: 32 }), toHex(1, { size: 1 })])));
}

/** The timelock salt of a proposal: its Safe number, as a word. Two changes
 *  with the same call and number never meet: the number moves on each send. */
export function saltOf(nonce: number): Hex {
  return pad(toHex(nonce), { size: 32 });
}
