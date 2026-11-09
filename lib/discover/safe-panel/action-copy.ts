// Browser-safe. The words of each wallet action's inputs and review: field
// labels, plan titles and effects, and the plain name of each contract the
// Details list shows. Plain, neutral words; no internal names.

/** The plain name of each contract a plan calls. */
export const CONTRACT_NAMES = {
  core: "CRX settlement contract",
  registry: "CRX price source registry",
  tlA: "72-hour change queue",
  tlB: "Upgrade change queue",
  stop: "Guardian wallet",
  restart: "Multisig wallet",
  members: "Steward wallet",
  other: "Other contract",
} as const;

/** The label of each field id. */
export const FIELD_LABELS = {
  pair: "Pair",
  member: "Member",
  newMember: "New member's wallet address",
  source: "Price source",
  tenor: "Tenor",
  feedSource: "New source",
  hold: "Manual price or trade hold",
  change: "Change",
  key: "Key",
  newKey: "New key's wallet address",
  approvals: "Approvals needed",
  version: "New version's contract address",
  rule: "Rule",
  value: "New value",
  state: "Deposits",
  scheduled: "Scheduled change",
  price: "Price",
} as const;

export const WORDS = {
  allTenors: "All tenors",
  open: "Open",
  close: "Close",
  addKey: "Add a key",
  removeKey: "Remove a key",
  replaceKey: "Replace a key",
  setApprovals: "Change the approvals needed",
  admit: "Admit a member",
  remove: "Remove a member",
  none: "None (halt)",
  otherTitle: "Other request",
  otherEffect: "A call this page does not list. Check the details.",
} as const;

/** "0x1064…264A". */
export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** "72 h" or "at once". */
export const waitWords = (hours: number) => (hours > 0 ? `after a ${hours} h wait` : "at once");

/** The state once an action takes effect: one plain sentence each. */
export const DONE = {
  stopped: "Trading on CRX is stopped.",
  restarted: "Trading on CRX is unpaused.",
  paused: (pair: string) => `${pair} is paused.`,
  open: (pair: string) => `${pair} is open.`,
  delisted: (pair: string) => `${pair} is delisted.`,
  removed: (who: string) => `${who} is removed.`,
  member: (who: string) => `${who} is a member.`,
  memberAgain: (who: string) => `${who} is a member again.`,
  sourceHalted: (pair: string) => `The ${pair} price source is halted.`,
  tenorHalted: (tenor: string, pair: string) => `The ${tenor} tenor of ${pair} is halted.`,
  sourceSet: (pair: string, source: string) => `${pair} prices come from ${source}.`,
  tenorsRestored: (pair: string) => `The halted tenors of ${pair} are restored.`,
  holdReleased: (trade: string) => `The hold of trade ${trade} is released.`,
  priceCancelled: (pair: string) => `The manual price of ${pair} is cancelled.`,
  backupOperator: "Settlement runs from the CRX backup operator.",
  yourKey: "Your key is replaced.",
  keyAdded: (key: string) => `${key} holds a key.`,
  keyReplaced: (oldKey: string, newKey: string) => `${newKey} holds the key of ${oldKey}.`,
  approvals: (n: number) => `The wallet needs ${n} ${n === 1 ? "approval" : "approvals"}.`,
  depositsOpen: "Deposits are open.",
  depositsClosed: "Deposits are closed.",
  upgraded: (version: string) => `The settlement system runs the code at ${version}.`,
  param: (label: string, value: string) => `${label} is ${value}.`,
  cancelled: "The scheduled change is cancelled.",
  published: "The new prices are published.",
  manualPrice: (pair: string) => `The manual price of ${pair} is set.`,
  held: "The trade is held.",
  other: "The request is executed.",
} as const;
