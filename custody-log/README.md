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
contracts/     CustodyRegistry.sol — the on-chain source of truth
hardhat/       Contract compile/test/deploy workspace (targets contracts/)
QBFT-Network/  Genesis config template + generated network files (gitignored)
docker/        Docker Compose: Besu (x4 validators), Web3Signer, Prometheus, Grafana, api, frontend
scripts/       Numbered setup scripts (Azure Key Vault/identity -> VM -> genesis -> bring-up -> deploy)
api/           Backend REST API — Web3Signer-signed writes, chain-read GETs
frontend/      React/Vite SPA — item grid, item detail + custody timeline
```

This is its own private network, own Key Vault/signing key, own VM — it
shares nothing with the sibling bourbon app's Azure resources, by design.

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

## Deploying to Azure

Deployment is a manually-triggered GitHub Actions workflow:
`.github/workflows/deploy-custody-log-azure.yml` ("Deploy custody-log to
Azure" in the Actions tab → **Run workflow**). It never runs on a push or
PR — provisioning real, billable cloud resources should only ever happen
because someone deliberately asked for it right now.

**One-time setup, before the first run:**

1. **Create an Azure AD app registration** (or reuse one) and give it
   `Contributor` on the subscription (or a resource-group-scoped role once
   `custody-log-rg` exists, if you want it tighter). This is the identity
   the workflow authenticates as.
2. **Add a federated credential** on that app registration trusting this
   GitHub repo's workflow, so no client secret ever has to be stored:
   ```bash
   az ad app federated-credential create --id <APP_CLIENT_ID> --parameters '{
     "name": "github-actions-custody-log",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:<OWNER>/<REPO>:environment:azure-custody-log",
     "audiences": ["api://AzureADTokenExchange"]
   }'
   ```
   (The `environment:azure-custody-log` subject matches the workflow's
   `environment:` field — set up that environment under repo Settings →
   Environments if you want required-reviewer protection on deploys, which
   is worth doing given this spends money.)
3. **Add three repo secrets** (Settings → Secrets and variables → Actions):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — no
   `AZURE_CLIENT_SECRET`, on purpose; the federated credential above is what
   lets `azure/login` authenticate without one.

**What the workflow does**, in order: creates `custody-log-rg` + a Key
Vault + one EC signing key (idempotent — safe to re-run); provisions
`custody-log-besu-host`, a single VM whose cloud-init installs Docker,
Node.js, and the Azure CLI (idempotent — reuses the VM if it already
exists); then drives everything else through `az vm run-command` — genesis
generation, Web3Signer config, bringing up the 4-validator Besu network,
compiling/deploying the contract, and building+starting the `api`/
`frontend` containers — by having the VM `git clone` this repo and run
`scripts/ci-remote-deploy.sh` **using its own system-assigned managed
identity**, not any credential copied onto it. See that script and
`scripts/00` through `06` for the exact steps; each one is idempotent
(safe to re-run the workflow without wiping the chain or redeploying the
contract, unless you explicitly ask for that).

**Network access is closed by default.** The VM has no open inbound ports
until you pass an IP/CIDR in the workflow's `allowed_ssh_cidr` input — the
deploy and its own health verification both go through `az vm run-command`
(the Azure control-plane API), which needs no inbound network path to the
VM at all. This matters specifically because the thing triggering a
deploy is a GitHub-hosted runner with an unpredictable, ephemeral IP —
opening ports to "whichever IP happened to run this" would be real,
pointless exposure. Set `allowed_ssh_cidr` to *your own* IP (e.g.
`203.0.113.5/32`) when you actually want to browse to the frontend, hit the
API, or SSH in.

**Cost note**: a `Standard_D2s_v5` VM plus a Key Vault run continuously
once created — this workflow provisions, it never tears down. Delete
`custody-log-rg` (`az group delete --name custody-log-rg`) when you're done
with it; nothing else in Azure depends on it.

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
- **Azure deployment path**: the scripts, Docker Compose stack, and GitHub
  Actions workflow are written and internally consistent (bash syntax
  checked, `docker compose config` validates cleanly, the workflow YAML
  parses, `derive-eth-address-azure.js`/`prepare-validators.js` verified
  against synthetic secp256k1 fixtures matching `ethers`' own address
  derivation) — but **never run against a real Azure subscription**, since
  this sandbox has no Azure credentials. The first real run is the actual
  test; if `az vm run-command` behaves differently than documented in some
  version-specific way, that's where it'll surface. Budget for iterating
  once against a real subscription before trusting this unattended.
