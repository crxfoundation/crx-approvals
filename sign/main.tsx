// The public build of the live firm approvals page (scripts/sign-build.mjs):
// Ethereum only, no firm on the seat list.

import { ETHEREUM } from "@/lib/discover/safe-panel/firm-chains";
import { mount } from "./mount";

mount([ETHEREUM]);
