# CRX Approvals

A static page to approve and start actions on the CRX wallets through your own browser wallet. The page needs no CRX server: it reads and sends only through the wallet you connect, and it holds no RPC URL. The page makes no network call of its own: its content security policy sets `connect-src 'none'`.

In this release, sends are off on Ethereum. The page reads the wallets and shows each request with its exact calls; the approve, start and execute buttons stay off. To approve now, use Safe{Wallet} (see [Fallback](#fallback-safewallet)).

## Build

Requires Node.js 20 or later.

```sh
npm ci
npm run build
```

The output is in `dist/`: `index.html`, `app-<hash>.js`, `app-<hash>.css`, `assets/` (fonts) and `_headers`. `index.html` carries a subresource integrity hash for the script and the stylesheet, so the browser loads no other file.

## Verify the hosted copy

```sh
npm ci
npm run check -- https://<hosted page URL>/
```

The check builds the page, prints the SHA-256 of each file and compares each served file with the local build. It exits with code 1 on a difference. `npm ci` installs the versions in `package-lock.json`; other versions give other bytes.

## Host it yourself

Copy `dist/` to any static host that serves HTTPS. `_headers` lists the HTTP headers the page expects (content security policy, no framing, no referrer); a host that does not read `_headers` needs the same headers in its server configuration. Connect a browser wallet that holds a key on one of the wallets below.

## Wallets

Ethereum (chain 1). Each address is the full checksummed address.

| Wallet | Address |
|---|---|
| Guardian Safe | `0x106433F59100833bd5c10cbCF00A34b26C66264A` |
| Multisig Safe | `0x8dff59b00709B70dA3F03Cab645C01EC9A4c16D3` |
| Steward Safe | `0x9a9B06A185E170034dB45437ef18E6cbdB181594` |

Contracts the page reads:

| Contract | Address |
|---|---|
| CRX core | `0x0d716cA9Fc2BFD8c66D2AF2fB38b56D08809A8cc` |
| 72-hour change queue | `0x668CBFF3E08d26472EadB4265ceeBb3489d13B49` |
| Upgrade change queue | `0x919Bf7ba0795bB7e69D6920864EcB3861A2359Dd` |
| Price source registry | `0xcDD773DD66c86160b2450aF98aFDbb04FF64ec60` |

## Fallback: Safe{Wallet}

The same wallets open in Safe{Wallet}. An owner can create, approve and execute the same transactions there:

- Guardian: https://app.safe.global/home?safe=eth:0x106433F59100833bd5c10cbCF00A34b26C66264A
- Multisig: https://app.safe.global/home?safe=eth:0x8dff59b00709B70dA3F03Cab645C01EC9A4c16D3
- Steward: https://app.safe.global/home?safe=eth:0x9a9B06A185E170034dB45437ef18E6cbdB181594

## Licence

MIT. See [LICENSE](LICENSE). The bundled fonts are under the SIL Open Font License; each font folder in `app/fonts/` holds its `OFL.txt`.
