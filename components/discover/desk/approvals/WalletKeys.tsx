// Manage multisig's first step (FirmApprovals, inputs): the Multisig
// wallet's keys before the choices. Each key in full, one per row, in the
// Safe's order (getOwners); "You" on the connected wallet's key; then the
// approvals needed of the keys. The keys come from the home read
// (FirmDriver.seats); a change shows here after the next read.

import { COPY, neededLine } from "@/lib/discover/safe-panel/copy";
import type { Seat, WalletAction } from "@/lib/discover/safe-panel/firm-driver";

/** True for the action this view heads: the Multisig's keys action. */
const headsAction = (a: WalletAction) => a.group === "restart" && a.id === "wallet-keys";

/** The keys of `seat`'s wallet. Nothing for another action, or before the
 *  wallets are read. `account`: the connected wallet's address. */
export function WalletKeys({ action, seat, account }: { action: WalletAction; seat: Seat | null; account: string | null }) {
  if (!headsAction(action) || !seat) return null;
  const you = account?.toLowerCase() ?? null;
  return (
    <section className="sec-box" aria-labelledby="sec-keys-head">
      <h2 className="sec-box-head" id="sec-keys-head">
        {COPY.FIRM_KEYS_NOW}
      </h2>
      <ul className="sec-keys">
        {seat.owners.map((o) => (
          <li className="sec-key" key={o}>
            <code>{o}</code>
            {o.toLowerCase() === you && <span className="sec-tag sec-tag-on">{COPY.FIRM_YOU}</span>}
          </li>
        ))}
      </ul>
      <dl className="sec-rows">
        <div className="sec-row">
          <dt>{COPY.FIRM_NEEDED_NOW}</dt>
          <dd>{neededLine(seat.needed, seat.owners.length)}</dd>
        </div>
      </dl>
    </section>
  );
}
