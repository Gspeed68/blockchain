# Custody Log

An on-chain chain-of-custody log for physical items moving between
custodians — pharma shipments, fine art, high-value freight, anything where
"who had it, where, and when" needs to be provable after the fact. Every
item's custody history (handoffs, inspections, delivery, damage/loss
reports) is an append-only record on a private blockchain, written and read
by a real backend API (no direct frontend-to-chain calls), with a frontend
built to actually be usable by someone tracking shipments day to day.

This is a standalone project living inside the parent repo: its own
contract, own Hardhat workspace, own API, own frontend. It follows the same
architectural pattern as the sibling `../` (Bourbon Registry) app —
single-writer contract, hand-written JSON-RPC transaction lifecycle in the
API (no `ethers.Contract` magic hiding nonce/gas/receipt handling), backend
signs via Web3Signer so no private key ever touches this app's process —
but shares no infrastructure, dependencies, or ports with it. See
`../README-BOURBON-PORT.md` for the fuller design rationale behind that
shared pattern (Web3Signer, QBFT, the write-path steps); this README covers
what's specific to Custody Log.

## Repo layout

```
contracts/    CustodyRegistry.sol — the on-chain source of truth
hardhat/      Contract compile/test/deploy workspace (targets contracts/)
api/          Backend REST API — Web3Signer-signed writes, chain-read GETs
frontend/     React/Vite SPA — item grid, item detail + custody timeline
```

There's no `QBFT-Network/`, `docker/`, or cloud-provisioning `scripts/`
directory here — this app doesn't yet have its own private network
provisioned. It can either get its own (copy the pattern from `../
QBFT-Network` and `../docker`) or be deployed onto the same Besu network the
bourbon app runs, at a different contract address; that's a deployment
decision to make when it's actually going to run somewhere, not baked in.

## Domain model

- **Item** — a registered physical thing: SKU, description, category,
  origin, plus cached "current state" (custodian, location, status) for
  cheap reads.
- **CustodyEvent** — one entry in an item's append-only history: an event
  type (`Transferred`, `Inspected`, `Delivered`, `Damaged`, `Lost`), who it
  moved from/to, where, notes, and an optional supporting document (bill of
  lading, inspection cert, damage photo — stored off-chain, hashed
  on-chain). `registerItem()` seeds the first event (`Registered`)
  automatically; every event after that is `recordCustodyEvent()`, which
  never overwrites history, only appends — see the contract's own doc
  comments for why that's the whole point of the app.

## Quick start (local, no cloud network)

Everything below runs against a local Hardhat network standing in for
Besu+Web3Signer — good enough to develop and demo the whole app end to end.

```bash
# 1. A local chain
cd hardhat && npm install && npx hardhat node        # separate terminal, leave running

# 2. Compile + deploy the contract to it, and point the API at the result
npx hardhat compile
npx hardhat run scripts/deploy.ts --network localhost
# writes address + ABI into ../api/src/config/contract.json

# 3. Backend API
cd ../api && npm install && cp .env.example .env
# edit .env: WEB3SIGNER_RPC_URL=http://localhost:8545 (the same local node
# doubles as a stand-in signer here — it exposes unlocked accounts via
# eth_accounts same as Web3Signer would)
npm run dev

# 4. Frontend
cd ../frontend && npm install && cp .env.example .env
npm run dev   # http://localhost:5174
```

## Verified vs. not

- **Contract**: hand-verified end to end (deploy, register an item, record
  Transferred/Delivered/Inspected/Damaged events, confirm the cached
  current-state fields and the append-only history both update correctly,
  confirm every access-control and not-found revert) via raw `ethers` calls
  against a local Hardhat network, plus a standalone `solc` compile with
  `viaIR: true`. `npx hardhat compile`/`npx hardhat test` themselves need a
  solc binary download from `binaries.soliditylang.org`, which this sandbox's
  network policy blocks — same limitation noted in `../README-BOURBON-PORT.md`.
  Re-run `npx hardhat compile && npx hardhat test` in an environment with
  that host allowed to get the same result through Hardhat's own runner
  (the test file is written and ready — `hardhat/test/CustodyRegistry.test.ts`).
- **API**: smoke-tested live against a local Hardhat network standing in for
  Besu+Web3Signer — register/list/get items, record every event type,
  validation and revert-to-HTTP-status mapping (400/404/409/502) all
  confirmed via `curl`. Builds clean (`tsc --noEmit`).
- **Frontend**: builds clean (`tsc -b && vite build`), and every screen
  (empty state, register form, item detail, recording a custody event,
  the resulting timeline, the list view) was driven end to end in a real
  browser (Playwright) against the live local stack above and visually
  checked.
- **Not done**: no cloud network provisioning (Azure/AWS scripts, Docker
  Compose Besu+Web3Signer stack) for this app specifically — see "Repo
  layout" above for why, and copy the pattern from the sibling bourbon app
  when this needs a real deployment target.
