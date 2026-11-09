// Browser-safe. One plain line per control of the firm approvals page that
// acts (components/discover/desk/approvals/FirmApprovals, ActionHint): each
// seat row, each scheduled change row, each wallet action and each primary
// button. One sentence, 12 words at most, true to the action's plan in
// ./firm-actions.

import type { GroupId, WalletAction } from "./firm-driver.ts";

/** A seat row on Home: what its wallet does. */
export const SEAT_HINTS: Readonly<Record<GroupId, string>> = {
  stop: "Stops trading, pauses pairs or removes members with one approval.",
  restart: "Unpauses trading, upgrades the system and schedules rule changes.",
  members: "Admits members and publishes prices; only CRX holds keys on it.",
};

/** A scheduled change's row on Home. */
export const SCHEDULED_HINT = "Opens this scheduled change to run it when ready.";

/** An action's tile on its wallet's screen. "stop-all" and "wallet-keys"
 *  sit on two wallets, with one line each. A missing action id fails the
 *  type check. */
export function actionHint(a: WalletAction): string {
  switch (a.id) {
    case "stop-all":
      return a.group === "stop" ? "Stops all trading on CRX at once." : "Stops all trading on CRX once the approvals are in.";
    case "pause-pair":
      return "Stops trading on one pair until the Multisig reopens it.";
    case "remove-member":
      return "Stops one member from trading; only a 72-hour change re-admits it.";
    case "halt-source":
      return "Stops the prices of one pair, or one of its tenors.";
    case "cancel-hold":
      return "Cancels a pending manual price, or releases a held trade.";
    case "backup-operator":
      return "Runs settlement from the CRX backup operator.";
    case "wallet-keys":
      return a.group === "stop" ? "Moves your key on this wallet to a new address." : "Adds, removes or replaces a key, or changes the approvals needed.";
    case "restart":
      return "Resumes all trading on CRX after a stop.";
    case "reopen-pair":
      return "Resumes trading on one paused pair.";
    case "deposits":
      return "Opens or closes new deposits; withdrawals are not affected.";
    case "price-source":
      return "Points a pair's prices to a source, or halts the source.";
    case "upgrade":
      return "Runs the CRX settlement contract on a new code version.";
    case "schedule-rule":
      return "Schedules a change to pairs, tenors or limits, with a 72-hour wait.";
    case "readmit-member":
      return "Lets a removed member trade again, after a 72-hour wait.";
    case "cancel-scheduled":
      return "Stops a scheduled change before it runs.";
    case "admit-remove":
      return "Admits a new member, or removes a member.";
    case "publish-prices":
      return "Makes the signed prices of every source take effect.";
    case "manual-price":
      return "Sets a pair's price by hand, after a 2-hour wait.";
    case "hold-trade":
      return "Holds one trade until its own price is set.";
    default: {
      const none: never = a.id;
      return none;
    }
  }
}

/** What a primary button does, by its step: `review` Home's Review
 *  request; `choices` Continue on an action's choices; `start`, `approve`,
 *  `execute` and `run` the Review's send; `decline` the Review's Decline. */
export type ButtonStep = "review" | "choices" | "start" | "approve" | "execute" | "run" | "decline";

export const BUTTON_HINTS: Readonly<Record<ButtonStep, string>> = {
  review: "Opens the request with its effect and exact calls.",
  choices: "Shows the change for review; your wallet opens next.",
  start: "Opens your wallet to start this action.",
  approve: "Opens your wallet to add your approval to this request.",
  execute: "Opens your wallet to add the last approval and execute it.",
  run: "Opens your wallet to run this scheduled change.",
  decline: "Declines this request, with an optional reason for CRX.",
};
