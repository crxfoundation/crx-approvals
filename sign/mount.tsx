// Mounts the live firm approvals page (FirmApprovals over the live driver)
// for the chains a build lists. The page reads and sends through the firm's
// wallet alone.

import { createRoot } from "react-dom/client";
import { FirmApprovals } from "@/components/discover/desk/approvals/FirmApprovals";
import type { FirmChain } from "@/lib/discover/safe-panel/firm-chains";
import type { GroupId } from "@/lib/discover/safe-panel/firm-driver";
import { browserWallet, liveDriver } from "@/lib/discover/safe-panel/firm-live";
import "@/app/discover/skin-gs/tokens.css";
import "./sign.css";

export function mount(chains: readonly FirmChain[]): void {
  const driver = liveDriver({ chains: [...chains], wallet: () => browserWallet(window) });
  const safes = (Object.entries(chains[0].safes) as [GroupId, string][]).map(([group, address]) => ({ group, address }));
  createRoot(document.getElementById("root")!).render(
    <div className="discover-root" data-skin="gs">
      <FirmApprovals driver={driver} preview={null} now={Date.now()} safes={safes} />
    </div>,
  );
}
