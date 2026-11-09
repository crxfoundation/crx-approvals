// Browser-safe. Every string the Safe approvals page shows
// (components/discover/safe-panel). The keys of the screen spec's Copy table
// come first, then the controls, the heads, the states and the lines.
// Network names come from ./client-tx networkName.

import type { ActionId, FirmDriverErrorCode, WalletAction } from "./firm-driver.ts";

export const COPY = {
  // The screen spec's Copy table.
  PAGE_TITLE: "Safe approvals",
  PRACTICE_TITLE: "Practice approval",
  PRACTICE_LINE: "This item makes no change to the system. It moves the Safe to its next transaction number.",
  PRACTICE_STEPS: ["Connect wallet", "Approve", "Execute"],
  NO_SEATS: "No seat is on record for this firm. CRX adds seats from the firm's record.",
  CONNECT_FIRST: "Connect the wallet of a seat to approve.",
  NOT_A_SEAT: "This wallet is not a seat of this firm on this Safe.",
  SWITCH_NETWORK: "The wallet is on another network. Switch to approve.",
  WALLET_REJECTED: "The wallet did not approve. Nothing was recorded.",
  APPROVED: "Approval recorded.",
  EXECUTED: "Executed.",
  READ_FAILED: "The Safe could not be read. Read again.",
  EXEC_FEE: "The network fee is paid by the executing wallet.",

  // Controls.
  CONNECT_WALLET: "Connect wallet",
  DISCONNECT: "Disconnect",
  APPROVE: "Approve",
  EXECUTE: "Execute",
  SWITCH: "Switch network",
  READ_AGAIN: "Read again",
  VIEW_TX: "View transaction",
  COPY: "Copy",
  COPIED: "Copied",
  COPY_LABEL: "Copy the full address",
  ADD_SEAT: "Add seat record",
  CREATE_PRACTICE: "Create practice item",

  // Section and column heads, field labels.
  SEATS: "Seats",
  PENDING: "Pending",
  HISTORY: "History",
  CRX_TOOLS: "CRX tools",
  FIRM: "Firm",
  ALL_FIRMS: "All firms",
  SAFE: "Safe",
  NETWORK: "Network",
  ADDRESS: "Address",
  APPROVALS_NEEDED: "Approvals needed",
  FIRM_SEAT: "Firm seat",
  STATUS: "Status",
  ITEM: "Item",
  NUMBER: "Number",
  APPROVALS: "Approvals",
  CREATED: "Created",
  TIME: "Time",
  APPROVED_BY: "Approved by",
  TRANSACTION: "Transaction",
  FULL_ADDRESS: "Full address",
  WALLET: "Wallet",
  ACTIONS: "Actions",

  // Seat and item states.
  ON_SAFE: "On Safe",
  NOT_ON_SAFE: "Not on Safe",
  WAITING: "Waiting",
  READY: "Ready",
  EXECUTED_WORD: "Executed",
  REPLACED: "Replaced",
  FAILED: "Failed",
  UNKNOWN: "—",

  // Empty lists.
  NO_PENDING: "No item is pending.",
  NO_HISTORY: "No item is final.",

  // Wallet lines.
  NO_PROVIDER: "This browser has no wallet. Open the page in a browser with a wallet extension.",
  CONNECT_TO_EXECUTE: "Connect a wallet to execute.",
  ALREADY_APPROVED: "This wallet has approved this item.",
  BUSY: "Another action is in progress.",
  WALLET_FAILED: "The wallet returned an error. Nothing was recorded.",
  ITEM_FINAL: "This item is final. Nothing was recorded.",
  BAD_SIGNATURE: "The approval does not match this item. Nothing was recorded.",
  HASH_MISMATCH: "The item's details do not match its hash. Nothing was signed.",
  NOT_RECORDED: "The approval was not recorded. Approve again.",
  STEP_SWITCH: "Switching network in the wallet.",
  STEP_SIGN: "Approve the item in the wallet.",
  STEP_RECORD: "Recording the approval.",
  STEP_SEND: "Confirm the transaction in the wallet.",
  EXEC_SENT: "Transaction sent. The network has not confirmed it.",
  EXEC_SLOW: "No confirmation after 10 minutes. Read again.",
  EXEC_NOT_SENT: "The wallet did not send the transaction. Nothing was recorded.",
  EXEC_FAILED: "The Safe did not execute the item. CRX makes a new item.",
  EXEC_REPLACED: "Another transaction took this number. The item is closed.",

  // CRX tools lines.
  SEAT_ADDED: "Seat record added.",
  PRACTICE_CREATED: "Practice item created.",
  ADDRESS_FULL: "Enter the full address: 0x and 40 characters.",
  NOT_EOA: "This address holds code on that network. A seat is a wallet address.",
  BAD_ADDRESS: "The address checksum does not match. Copy it from the firm's record.",
  OPEN_ITEM: "An open item exists on this Safe.",
  NO_PRACTICE_SAFE: "No Safe on the practice network is on this page.",
  TOOL_FAILED: "The request was not completed. Nothing was saved.",

  // Firm preview: the CRX controls.
  PREVIEW_AS: "Preview as",
  PREVIEW_CLOSE: "Close preview",
  PREVIEW_RESET: "Start over",

  // Firm preview: the firm's approvals (components/discover/desk/approvals).
  // Outward words only.
  FIRM_TITLE: "Approvals",
  FIRM_WAITING: "Waiting for you",
  FIRM_NONE_WAITING: "No requests waiting for you.",
  FIRM_REVIEW: "Review request",
  FIRM_SEAT_HEAD: "Your seat",
  FIRM_EFFECT: "Effect",
  FIRM_ACCOUNT: "Wallet",
  FIRM_NUMBER: "Request number",
  FIRM_APPROVED_SO_FAR: "Approved",
  FIRM_NEEDED: "Needed",
  FIRM_KEYS: "Keys",
  FIRM_KEYS_NOW: "Current keys",
  FIRM_NEEDED_NOW: "Approvals needed now",
  FIRM_YOU: "You",
  FIRM_ACTIONS: "Actions",
  FIRM_START_HEAD: "Start an action",
  FIRM_MORE_HEAD: "More actions",
  FIRM_APPROVE: "Approve request",
  FIRM_DECLINE: "Decline",
  FIRM_WALLET_TITLE: "Confirm in your wallet",
  FIRM_WALLET_LINE: "In your wallet, check that the transaction goes to this address:",
  FIRM_HASH_ENDS: "Request hash ends",
  FIRM_SENT: "Sent. Waiting for the network.",
  FIRM_WALLET_PREVIEW: "Preview. Nothing is signed, sent or stored.",
  FIRM_DECLINE_TITLE: "Decline request",
  FIRM_DECLINED_LINE: "Request declined.",
  FIRM_DECLINE_CONFIRM: "Confirm decline",
  FIRM_DECLINE_REASON: "Reason for CRX (optional)",
  FIRM_APPROVED_WORD: "Approved",
  FIRM_DECLINED_WORD: "Declined",
  FIRM_BACK: "Back",
  FIRM_SIGNED: "Mark as signed",
  FIRM_DONE: "Back to approvals",

  // Firm approvals: an action the firm starts, and the live page.
  FIRM_CRX_ONLY: "CRX only",
  FIRM_NO_KEY: "No key",
  FIRM_TAKES_EFFECT: "Takes effect",
  FIRM_AT_ONCE: "At once",
  FIRM_CONTINUE: "Continue",
  FIRM_EXECUTE: "Execute request",
  FIRM_EXECUTED_WORD: "Executed",
  FIRM_PROPOSED_WORD: "Proposed",
  FIRM_SCHEDULED_WORD: "Scheduled",
  FIRM_DETAILS: "Details",
  FIRM_CONTRACT: "Contract",
  FIRM_FUNCTION: "Function",
  FIRM_EMPTY_CHOICE: "Nothing to act on at this time.",
  FIRM_FILL_FIELDS: "Complete the choices this change needs.",
  FIRM_ADDRESS_CHECKSUM: "The address checksum does not match. Copy the full address again.",
  FIRM_START_OFF_CRX: "Only CRX holds keys on this wallet. CRX starts this action.",
  FIRM_START_OFF_CRX_ALL: "Only CRX holds keys on this wallet. CRX starts these actions.",
  FIRM_PLAN_FAILED: "The change could not be prepared. Check the choices.",
  FIRM_WAITS: "Waits for",
  FIRM_OTHERS_HEAD: "Waiting for others",
  FIRM_SCHEDULED_HEAD: "Scheduled changes",
  FIRM_READY: "Ready",
  FIRM_CAN_RUN: "Can run",
  FIRM_NOW: "Now",
  FIRM_RUN: "Run change",
  FIRM_CONNECT_LINE: "Connect the wallet that holds your seat.",
  FIRM_READING: "Reading the wallets.",
  FIRM_PLAN_READING: "Reading the action.",
  FIRM_SENDS_OFF: "Preview. Sends on Ethereum are off.",
  FIRM_FALLBACK: "The same wallets open in Safe{Wallet}:",
} as const;

/** The actions of the three wallets (firm-driver WALLET_ACTIONS), by id:
 *  each tile's title. */
export const ACTION_TITLES: Readonly<Record<ActionId, string>> = {
  "stop-all": "Stop all trading",
  "pause-pair": "Pause a pair",
  "remove-member": "Remove a member",
  "halt-source": "Halt a price source or tenor",
  "cancel-hold": "Cancel a manual price or trade hold",
  "backup-operator": "Move settlement to the backup operator",
  "wallet-keys": "Change keys and approvals",
  restart: "Unpause trading",
  "reopen-pair": "Reopen a pair",
  deposits: "Open or close deposits",
  "price-source": "Add or halt a price source",
  upgrade: "Upgrade the settlement system",
  "schedule-rule": "Schedule a rule change",
  "readmit-member": "Re-admit a removed member",
  "cancel-scheduled": "Cancel a scheduled change",
  "admit-remove": "Admit or remove a member",
  "publish-prices": "Publish prices",
  "manual-price": "Set a manual price",
  "hold-trade": "Hold a trade and set its price",
};

/** A tile's title on its wallet: on the Guardian the keys action swaps the
 *  firm's own key alone; on the Multisig it adds, removes or replaces a key,
 *  or changes the approvals needed. */
export const actionTitle = (a: WalletAction) =>
  a.id !== "wallet-keys" ? ACTION_TITLES[a.id] : a.group === "stop" ? "Replace my key" : "Manage multisig";

/** One line per driver failure (lib/discover/safe-panel/firm-driver). */
export const DRIVER_ERRORS: Readonly<Record<FirmDriverErrorCode, string>> = {
  "no-wallet": COPY.NO_PROVIDER,
  rejected: "The wallet declined the request. Nothing was sent.",
  "wrong-network": "The wallet is on a network this page does not use. Switch the wallet to Ethereum.",
  "no-seat": "This wallet holds no seat on the CRX wallets.",
  "read-failed": "The wallet's network could not be read. Use another wallet of the seat.",
  "sends-off": COPY.FIRM_SENDS_OFF,
  reverted: "The transaction failed. Nothing changed.",
  "send-refused": COPY.EXEC_NOT_SENT,
  changed: "This request changed on the network. Go back to approvals.",
  "not-now": "This action does not apply to the system's state now. Nothing was sent.",
  slow: COPY.EXEC_SLOW,
};

/** When an action takes effect: "At once"; "After 3 approvals"; "72 h
 *  after the approvals" for a scheduled change. */
export const takesEffectLine = (needed: number, delayHours: number) =>
  delayHours > 0 ? `${delayHours} h after the approvals` : needed <= 1 ? COPY.FIRM_AT_ONCE : `After ${needed} approvals`;

/** The Done line, the new state alone, one pattern for a start, a request
 *  and a run: the plan's `done` ("Trading on CRX is stopped."); through the
 *  queue, "Scheduled. The change can run 72 h from now."; else the approvals
 *  so far, "Proposal recorded. 1 of 3 approvals." */
export function outcomeLine(kind: "start" | "request", delayHours: number, r: { executed: boolean; approvals: number; needed: number }, done: string, keys?: number | null): string {
  if (r.executed) return delayHours > 0 ? `Scheduled. The change can run ${delayHours} h from now.` : done;
  const head = `${kind === "start" ? "Proposal" : "Approval"} recorded.`;
  return keys ? `${head} ${r.approvals} approved · ${r.needed} of ${keys} needed.` : `${head} ${r.approvals} of ${r.needed} ${approvalsWord(r.needed)}.`;
}

/** The start-off line of a wallet the connected wallet holds no key on:
 *  "Your wallet holds no key on the Guardian." */
export const noKeyLine = (role: string) => `Your wallet holds no key on the ${role}.`;

/** The value of a request's "Waits for" row: "Request 9", the earlier
 *  request it runs only after. */
export const waitsLine = (n: number) => `Request ${n}`;

/** "Enter a whole number."; "Enter at most 2 decimal places." */
export const placesLine = (places: number) => (places === 0 ? "Enter a whole number." : `Enter at most ${places} decimal ${places === 1 ? "place" : "places"}.`);

/** "approval" or "approvals" by count. */
export const approvalsWord = (n: number) => (n === 1 ? "approval" : "approvals");

/** "Enter a number from 1 to 5."; with no real ceiling, "Enter a number of
 *  1 or more." */
export const rangeLine = (min: number, max: number, unit?: string) =>
  max >= Number.MAX_SAFE_INTEGER ? `Enter a number of ${min} or more${unit ? ` ${unit}` : ""}.` : `Enter a number from ${min} to ${max}${unit ? ` ${unit}` : ""}.`;

/** "1 approved · 3 of 5 needed": an open proposal of the firm's own, with
 *  the wallet's keys as its seat row counts them; with no key count, "1 of 3
 *  approvals". */
export const othersLine = (count: number, needed: number, keys?: number | null) =>
  keys ? `${count} approved · ${needed} of ${keys} needed` : `${count} of ${needed} ${approvalsWord(needed)}`;

/** "0x1064…264A": an address's first 6 and last 4 characters. */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** "Preview of Example's view. Nothing is signed, sent or stored." */
export const previewBanner = (firm: string) => `Preview of ${firm}'s view. ${COPY.FIRM_WALLET_PREVIEW.slice("Preview. ".length)}`;

/** "Waiting for you (2)"; one request alone, "Waiting for you". */
export const waitingLine = (total: number) => (total > 1 ? `${COPY.FIRM_WAITING} (${total})` : COPY.FIRM_WAITING);

/** "2 · 3 of 5 needed": approvals so far, then the approvals needed of the
 *  wallet's keys as its seat row counts them; with no key count, "2 of 3
 *  needed". */
export const neededOf = (count: number, needed: number, keys?: number | null) =>
  keys ? `${count} · ${needed} of ${keys} needed` : `${count} of ${needed} needed`;

/** "As of 14:02 ET". */
export const asOfLine = (clock: string) => `As of ${clock}`;

/** "Approvals 0 of 1"; "—" for an unknown threshold. */
export const approvalsLine = (count: number, threshold: number | null) => `Approvals ${count} of ${threshold ?? COPY.UNKNOWN}`;

/** "1 of 3": a count of a total, as an account's approvals of its keys;
 *  "—" when either is unknown. */
export const neededLine = (threshold: number | null, owners: number | null) => (threshold === null || owners === null ? COPY.UNKNOWN : `${threshold} of ${owners}`);
