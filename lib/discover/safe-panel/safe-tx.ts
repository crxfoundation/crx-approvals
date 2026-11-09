// The Safe 1.4.1 transaction an approval signs, its hash, the approver a
// signature recovers to, and the signature bytes execTransaction takes.
//
// The typed data is EIP-712 with domain {chainId, verifyingContract: safe}
// and type SafeTx(address to,uint256 value,bytes data,uint8 operation,
// uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,
// address refundReceiver,uint256 nonce). A wallet signs it with
// eth_signTypedData_v4.
//
// An approval is a 65-byte r,s,v signature with v 27 or 28, r and s non-zero
// and s in the lower half of the curve order. Every other form is refused:
// v 0 (contract signature), v 1 (approved hash), v 31 or 32 (personal-message
// signature).
//
// Browser-safe: viem only.

import { getAddress, hashTypedData, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** The Safe functions and events the panel reads or calls. */
export const SAFE_ABI = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    type: "event",
    name: "ExecutionSuccess",
    inputs: [
      { name: "txHash", type: "bytes32", indexed: true },
      { name: "payment", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ExecutionFailure",
    inputs: [
      { name: "txHash", type: "bytes32", indexed: true },
      { name: "payment", type: "uint256", indexed: false },
    ],
  },
] as const;

/** keccak256("ExecutionSuccess(bytes32,uint256)"). */
export const EXECUTION_SUCCESS_TOPIC = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";
/** keccak256("ExecutionFailure(bytes32,uint256)"). */
export const EXECUTION_FAILURE_TOPIC = "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23";

/** The SafeTx fields as stored: uint256 fields as decimal strings. */
export interface SafeTxFields {
  to: string;
  value: string;
  data: string;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
}

/** What the hash binds: the chain, the Safe and the transaction. */
export interface SafeTxItem {
  chainId: number;
  safe: string;
  tx: SafeTxFields;
}

export interface SignedApproval {
  address: string;
  signature: string;
}

/** The typed data a wallet signs for `item`. */
export function safeTxTypedData(item: SafeTxItem) {
  const t = item.tx;
  return {
    domain: { chainId: item.chainId, verifyingContract: getAddress(item.safe) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx" as const,
    message: {
      to: getAddress(t.to),
      value: BigInt(t.value),
      data: t.data as Hex,
      operation: t.operation,
      safeTxGas: BigInt(t.safeTxGas),
      baseGas: BigInt(t.baseGas),
      gasPrice: BigInt(t.gasPrice),
      gasToken: getAddress(t.gasToken),
      refundReceiver: getAddress(t.refundReceiver),
      nonce: BigInt(t.nonce),
    },
  };
}

/** The Safe's own getTransactionHash for `item`. */
export function safeTxHash(item: SafeTxItem): Hex {
  return hashTypedData(safeTxTypedData(item));
}

const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/** Is `signature` a 65-byte r,s,v signature with v 27 or 28, r and s
 *  non-zero, and s in the lower half? */
export function isApprovalSignature(signature: unknown): signature is Hex {
  if (typeof signature !== "string" || !SIG_RE.test(signature)) return false;
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = parseInt(signature.slice(130, 132), 16);
  return (v === 27 || v === 28) && r !== 0n && s !== 0n && s <= HALF_N;
}

/** The checksummed address that signed `item`, or null when the signature is
 *  not an approval signature or does not recover. */
export async function recoverApprover(item: SafeTxItem, signature: unknown): Promise<Address | null> {
  if (!isApprovalSignature(signature)) return null;
  try {
    return getAddress(await recoverTypedDataAddress({ ...safeTxTypedData(item), signature }));
  } catch {
    return null;
  }
}

/** The `signatures` bytes of execTransaction: each 65-byte signature, ordered
 *  by signer address ascending. Throws on a bad address or signature. */
export function packSignatures(approvals: readonly SignedApproval[]): Hex {
  const rows = approvals.map((a) => {
    if (!isAddress(a.address, { strict: false }) || !isApprovalSignature(a.signature)) throw new Error("packSignatures: bad approval");
    return { key: BigInt(a.address), sig: a.signature.slice(2).toLowerCase() };
  });
  rows.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return `0x${rows.map((r) => r.sig).join("")}`;
}
