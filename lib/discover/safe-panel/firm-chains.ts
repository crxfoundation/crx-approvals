// Browser-safe. The chains a firm approvals build lists (frontend/sign/), each
// with its CRX core, its three Safes, Multicall3 and its seat list.
//
//   chain 1      Ethereum. Sends off: the page reads, and every send button
//                is off. The seat list is empty: an owner shows its short
//                address.
//
// A seat list entry names a firm and its logo. The public build lists no
// firm.

import type { Address } from "viem";
import type { GroupId } from "./firm-driver.ts";

export interface FirmChain {
  chainId: number;
  name: string;
  /** False: the page refuses every send on this chain. */
  sends: boolean;
  core: Address;
  /** The Safe of each group: stop = Guardian, restart = Multisig, members =
   *  Steward. */
  safes: Readonly<Record<GroupId, Address>>;
  multicall: Address;
  /** The price source registry the core reads. */
  registry: Address;
  /** The 72-hour change queue (TL-A, role 5) and the upgrade change queue
   *  (TL-B, role 7). The page checks both against the core's role words. */
  tlA: Address;
  tlB: Address;
  /** The core's birth block: the page reads logs from here, 10 000 blocks
   *  a call, once, then only new blocks. */
  fromBlock: number;
  /** Seat owner (lowercase address) → its firm. */
  seats: Readonly<Record<string, SeatFirm>>;
}

/** The firm a seat list entry names. `logo`: an address in the bundle. */
export interface SeatFirm {
  key: string;
  label: string;
  logo?: string | null;
}

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

const ETHEREUM_CORE = "0x0d716cA9Fc2BFD8c66D2AF2fB38b56D08809A8cc" as Address;
const ETHEREUM_SAFES: Readonly<Record<GroupId, Address>> = {
  stop: "0x106433F59100833bd5c10cbCF00A34b26C66264A",
  restart: "0x8dff59b00709B70dA3F03Cab645C01EC9A4c16D3",
  members: "0x9a9B06A185E170034dB45437ef18E6cbdB181594",
};

const ETHEREUM_PARTS = {
  core: ETHEREUM_CORE,
  safes: ETHEREUM_SAFES,
  multicall: MULTICALL3,
  registry: "0xcDD773DD66c86160b2450aF98aFDbb04FF64ec60" as Address,
  tlA: "0x668CBFF3E08d26472EadB4265ceeBb3489d13B49" as Address,
  tlB: "0x919Bf7ba0795bB7e69D6920864EcB3861A2359Dd" as Address,
  fromBlock: 26_184_353,
};

export const ETHEREUM: FirmChain = { chainId: 1, name: "Ethereum", sends: false, ...ETHEREUM_PARTS, seats: {} };

