// The firm approvals' icons (FirmApprovals): one per wallet on Home's seat
// rows and one per action (firm-driver ActionId) on a wallet's screen. lucide-react, Discover's set,
// drawn as the KYB tiles' icon (start.css .crs-tile-icon): the line icon in
// the accent colour, sized by approvals.css.

import {
  ArrowDownToLine,
  ArrowLeftRight,
  CalendarClock,
  CalendarX,
  ChartLine,
  CircleArrowUp,
  CirclePause,
  CirclePlay,
  Hand,
  KeyRound,
  Landmark,
  OctagonX,
  PencilLine,
  Plug,
  RotateCcw,
  ShieldAlert,
  Undo2,
  Unplug,
  UserCog,
  UserMinus,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ActionId, GroupId } from "@/lib/discover/safe-panel/firm-driver";

export const GROUP_ICONS: Readonly<Record<GroupId, LucideIcon>> = {
  stop: ShieldAlert,
  restart: Landmark,
  members: UsersRound,
};

export const ACTION_ICONS: Readonly<Record<ActionId, LucideIcon>> = {
  "stop-all": OctagonX,
  "pause-pair": CirclePause,
  "remove-member": UserMinus,
  "halt-source": Unplug,
  "cancel-hold": Undo2,
  "backup-operator": ArrowLeftRight,
  "wallet-keys": KeyRound,
  restart: CirclePlay,
  "reopen-pair": RotateCcw,
  deposits: ArrowDownToLine,
  "price-source": Plug,
  upgrade: CircleArrowUp,
  "schedule-rule": CalendarClock,
  "readmit-member": UserPlus,
  "cancel-scheduled": CalendarX,
  "admit-remove": UserCog,
  "publish-prices": ChartLine,
  "manual-price": PencilLine,
  "hold-trade": Hand,
};

export function GroupIcon({ group }: { group: GroupId }) {
  const Icon = GROUP_ICONS[group];
  return (
    <span className="sec-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}

export function ActionIcon({ action }: { action: ActionId }) {
  const Icon = ACTION_ICONS[action];
  return (
    <span className="sec-icon" aria-hidden="true">
      <Icon />
    </span>
  );
}
