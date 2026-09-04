# Bourbon Registry — build log

This is the running record for this project, in the same spirit as the prior
Besu/QBFT-on-AWS port: architecture decisions, the exact order things need to
run in, and — critically — a dated **Correction** section any time something
built here turned out to be wrong, rather than silently fixing it and moving
on.

**Read this before running anything.** The single most important fact about
this build: **it was produced in a sandboxed dev session with no AWS CLI, no
running Docker daemon, and a network egress allowlist that blocks most of the
docs sites and third-party APIs this project depends on.** So this is a
complete, internally-consistent POC that has been verified as thoroughly as
that sandbox allows — but the AWS provisioning, the real Besu/QBFT network,
and the real external valuation APIs have **not** been run against anything
real yet. See "Verification status" below for exactly what was and wasn't
exercised, and by what.

---

## Architecture

```
                     ┌─────────────┐        ┌──────────────────────┐
   Browser  ───────► │  frontend   │──HTTP─►│         api          │
  (React SPA,        │ (Vite/React)│        │ (Express, TypeScript)│
   no chain           └─────────────┘        └─────────┬────────────┘
   code at all)                                          │
                                             reads: eth_call, eth_getLogs, etc.
                                             writes: eth_sendTransaction
                                                          │
                                       ┌──────────────────┴──────────────────┐
                                       │                                     │
                                 ┌─────▼─────┐                       ┌───────▼──────┐
                                 │   Besu    │◄──downstream_http─────│  Web3Signer  │
                                 │ (x4 QBFT  │                       │ (signs with  │
                                 │ validators)│                      │  AWS KMS key)│
                                 └───────────┘                       └───────┬──────┘
                                                                              │
                                                                        AWS KMS Sign()
                                                                     (ECC_SECG_P256K1,
                                                                    key never leaves KMS)
```

The frontend never touches the chain or holds any chain concept (no ethers.js
in the browser, no RPC URL, no gas) — every request goes through the API.
That's deliberate: the point of this project is to actually exercise "how
does a backend talk to a blockchain," and skipping the API layer would skip
the whole point. See `api/src/chain/writeTransaction.ts` for the fully
commented transaction lifecycle (nonce, gas estimation, pending vs.
confirmed, reverts).

### Why this shape

- **One KMS key, not two.** This app has no marketplace/transfer concept —
  every write is made by the app's own backend identity. A second
  "counterparty" KMS key only makes sense once there's an actual second
  party (a transfer/marketplace feature). Building one now, speculatively,
  is exactly the kind of mistake worth avoiding — see the Corrections
  section on the *prior* project for the KMS key-count mistake this is
  deliberately not repeating.
- **4 validators.** QBFT tolerates `f` faulty nodes with `N >= 3f+1`; `N=4`
  is the smallest network that tolerates any faulty validator at all
  (`f=1`) and is Besu's own commonly-documented minimum for a real QBFT
  deployment. This project's brief explicitly allowed reusing "whatever
  validator-count reasoning applied last time" — this session did not have
  access to that prior project's files to confirm the exact number used
  there, so 4 is this project's own from-first-principles default, not a
  literal port. Change `QBFT-Network/config/qbftConfigFile.json`'s
  `blockchain.nodes.count` if you want more.
- **All 4 validators on one EC2 instance**, not one instance each. This is a
  personal-collection POC, not a fault-tolerant-against-host-failure
  deployment — see `scripts/02-provision-ec2.sh`'s comment for the
  reasoning. Four validator *processes* still gives real QBFT consensus and
  real peering to learn from.
- **GETs never touch a local database — only the chain.** `api/src/services/bottleService.ts`
  reads `getAllBottleIds()`/`getBottle()`/`getAppraisals()` on every request.
  There is no bottles table anywhere in this API, on purpose: it's the
  simplest way to guarantee an API response can never drift from on-chain
  truth, and it directly demonstrates the "read-after-write against the
  contract" requirement from the project brief.
- **Appraisals are append-only on-chain**, never a mutable "current value"
  field — see `contracts/BottleRegistry.sol`. `addBottle` seeds the history
  with a "purchase" entry so the value-over-time chart always has a
  starting point.

---

## Exact run order

Steps 1-9 below map to the project brief's order of work. Each step says
what exists, what (if anything) was actually run in this sandbox, and what
you need to do to actually run it for real.

### 1. Repo scaffold — done

Layout matches the brief: `contracts/`, `hardhat/`, `QBFT-Network/`,
`docker/`, `scripts/`, `api/`, `frontend/`.

### 2. AWS auth check, then KMS + IAM

`scripts/00-check-aws-auth.sh` (confirms `aws sts get-caller-identity`,
`aws sso login` retry), `scripts/01-create-kms-and-iam.sh` (one
`ECC_SECG_P256K1` KMS key, an IAM policy scoped to exactly that key's ARN, a
role + instance profile for EC2).

**Not run**: this sandbox has no `aws` CLI at all (`which aws` → not found),
so nothing has touched a real AWS account. Run these yourself once you have
`aws` configured with IAM Identity Center SSO.

**Verified independently**: the Ethereum-address-from-KMS-public-key
derivation (`scripts/lib/derive-eth-address.js`, the trickiest part of this
script — DER parsing + keccak256) was tested against a real secp256k1
keypair generated with Node's own `crypto.generateKeyPairSync` (encoded as
X.509 SPKI DER exactly like `aws kms get-public-key` returns) and confirmed
to produce the same address as deriving it directly from the private key.

### 3. EC2 provisioning + QBFT genesis/validator keys

`scripts/02-provision-ec2.sh` (IP-scoped security group, refreshed
automatically if your IP changes; one `t3.large` running everything via
Docker Compose). `scripts/03-generate-qbft-genesis.sh` shells out to Besu's
own `operator generate-blockchain-config` (via Docker) rather than
hand-rolling the QBFT genesis `extraData` RLP encoding — see that script's
comment for why a subtly-wrong hand-rolled RLP encoder is a worse bet than
depending on Besu's tested implementation.

**Not run**: no `aws` CLI, and no running Docker daemon in this sandbox
(`docker ps` → "cannot connect to the Docker daemon"), so neither script
executed for real.

### 4. Web3Signer key config for the KMS identity

`docker/web3signer/keys/eth1-app-identity.yaml.template` +
`scripts/04-configure-web3signer.sh`. Field names (`type: aws-kms`,
`kms-key-id`, `region`, `auth-mode`) were confirmed against Web3Signer's
`AwsKmsMetadata`/`AwsKmsMetadataDeserializer` source
(`Consensys/web3signer` PR #837) rather than the live docs site, which this
sandbox's network policy blocks (`docs.web3signer.consensys.io` is not in
the egress allowlist). **Before the first real run**, diff the rendered
YAML against that page for the exact Web3Signer version pinned in
`docker/docker-compose.yml` (currently `24.8.0`) — the template file says
the same thing.

### 5. Bring up Besu/Web3Signer/monitoring, confirm block production + peering

`docker/docker-compose.yml` (4 Besu validators + Web3Signer +
Prometheus/Grafana) + `scripts/05-bring-up-stack.sh`, which doesn't just run
`docker compose up -d` and declare victory — it polls `eth_blockNumber`
across a 15s window to confirm blocks are actually being produced, checks
`net_peerCount`, and checks Web3Signer's `eth_accounts`.

**Not run**: no Docker daemon in this sandbox. The compose file's
validator-key wiring (`scripts/lib/prepare-validators.js`, which maps
Besu's generated per-validator directories into the stable paths the
compose file expects, and computes each node's `bootnodes.txt` from its
public key) was written carefully but has not been exercised against real
Besu-generated output, because step 3 never ran. **This is the biggest
unverified piece of the whole build** — see "What to check first" below.

### 6. BottleRegistry contract — written, compiled, and logic-tested

`contracts/BottleRegistry.sol`. **Verified in this sandbox**: `hardhat
compile` needs `binaries.soliditylang.org` to download `solc`, which this
sandbox's egress policy blocks (`Host not in allowlist`). Rather than route
around an organization network policy, the contract was instead compiled
directly with the `solc` npm package (ships its own compiler, no network
call) and — more importantly — deployed to a local Hardhat network and
exercised through every function (`addBottle` seeding a purchase appraisal,
append-only `recordAppraisal`, `updateCondition`, the `NotAdmin` and
`BottleNotFound` custom-error reverts) via raw JSON-RPC calls, matching
`hardhat/test/BottleRegistry.test.ts`'s assertions. All checks passed. `npx
hardhat compile`/`npm test` will work normally anywhere
`binaries.soliditylang.org` is reachable (your machine, CI, EC2).

### 7. Backend API — written and smoke-tested end to end

`api/`. Every endpoint in `api/API.md` was actually run against a live
instance of this API, backed by a local Hardhat node standing in for
Besu+Web3Signer (Hardhat Network's JSON-RPC implements `eth_accounts` and
`eth_sendTransaction` against its own unlocked accounts, which is
functionally the same shape Web3Signer presents — this is a legitimate
stand-in for the write path, not a mock). Confirmed working: add a bottle
(with its seeded purchase appraisal), list/detail reads, condition update,
manual appraisal, the `/refresh` valuation flow (against the mock
provider), photo upload + static serving, transaction status lookup, and
the error paths (`400 transaction_would_revert`... `404
contract_call_reverted` with a decoded `BottleNotFound(999)`, Zod
validation `400`s).

**Not verified**: the real Web3Signer + AWS KMS signing path itself (no
live Web3Signer to test against), and the WhiskyHunter/eBay valuation
providers against their real APIs (see step 8).

### 8. Valuation source — researched, chosen, documented; integration unverified live

See "Valuation data source" below for the research and the decision.
**Not run against the real APIs**: this sandbox's egress policy blocks
`whiskyhunter.net` directly (confirmed via `curl`/`WebFetch` — both
returned `EGRESS_BLOCKED`), so `whiskyHunterProvider.ts` was written from
public documentation of the API rather than a live response, and its
per-record field-name parsing is deliberately defensive (tries several
plausible field names) rather than asserted-correct. **Run it for real and
fix the field names before relying on it.** The eBay Browse API fallback
(`ebayBrowseProvider.ts`) uses a stable, well-documented OAuth2
client-credentials + `item_summary/search` shape and needs a real
`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` to test.

### 9. Frontend — built and visually verified

`frontend/`. `npx tsc -b` and `npx vite build` both pass cleanly.
**Verified visually**: ran the actual dev server against the same local
Hardhat-backed API from step 7 (three sample bottles across different
condition states), and screenshotted the collection grid, bottle detail
(with its value-over-time chart), the add-bottle form, and a dark-mode
pass, using the Chromium install already present in this sandbox. One real
bug was caught and fixed this way: broken photo URLs (this sandbox also
blocks image CDNs like `images.unsplash.com`) were rendering as ugly
overlapping alt-text instead of falling back cleanly — added
`BottlePhoto.tsx`'s `onError` fallback, which fixed it for any dead photo
URL, not just this sandbox's network restrictions.

### 10. End-to-end test — done locally, pending for real

The local-Hardhat-network version of steps 6+7+9 above collectively *is*
the end-to-end test the brief asks for (add a bottle → confirm it shows up
→ refresh/record a valuation → confirm it's in the appraisal history →
confirm it renders in the frontend, chart included) — just not against the
real Besu/QBFT/Web3Signer/KMS stack, because that stack was never brought
up in this sandbox. Once you've run steps 2-5 for real, re-run this same
walkthrough against the real network as the final check.

---

## What to check first (in order) once you have real AWS/Docker access

1. `scripts/00-check-aws-auth.sh` then `scripts/01-create-kms-and-iam.sh` —
   confirm the derived app-identity address looks sane, and paste it into
   `QBFT-Network/config/qbftConfigFile.json`'s `alloc` block.
2. `scripts/03-generate-qbft-genesis.sh`, then **look at what it actually
   produced** under `QBFT-Network/generated/` before trusting
   `scripts/lib/prepare-validators.js`'s directory-discovery assumption
   (one `0x<address>` directory per validator, each containing `key` and
   `key.pub`, directly under the output dir). If Besu's current version
   lays it out differently, fix the discovery logic there and note it as a
   dated Correction below.
3. `scripts/02-provision-ec2.sh`, `scripts/04-configure-web3signer.sh`
   (diff against the live Web3Signer docs first, see step 4 above), then
   `scripts/05-bring-up-stack.sh` — it will tell you plainly if blocks
   aren't being produced or peering isn't happening, rather than silently
   "succeeding."
4. `cd hardhat && npm run deploy:besu` — first real deploy. Confirm
   `api/src/config/contract.json` got overwritten with a real address.
5. Point `api/.env` at the real `BESU_RPC_URL`/`WEB3SIGNER_RPC_URL`, restart
   the API, hit `GET /health` — both `besu.ok` and `web3signer.ok` should be
   true, and `web3signer.accounts` should show exactly the KMS-derived
   address.
6. Run through `api/API.md`'s examples for real, then load the frontend.

---

## Valuation data source

Researched before writing any integration code, per the brief's
"needs research, not assumed" instruction:

| Source | Verdict | Why |
|---|---|---|
| **WhiskyHunter** (chosen, primary) | ✅ Used | Free, public, **no API key**, aggregates completed-auction results from 28 whisky auction sites — a real public API, not a scrape, so no ToS to violate. Known limitation: coverage skews Scotch/UK auction houses, so American bourbon hit rate is lower — that's why there's a fallback. |
| **eBay Browse API** (chosen, fallback) | ✅ Used, weaker signal | Free, open to any registered developer app. Only returns **active listing** (asking) prices, not confirmed sales — the `note` on every appraisal it produces says this explicitly. |
| **eBay Marketplace Insights API** | ❌ Not used | This is the API with actual *sold*-listing data — but eBay states outright it's a "Limited Release" API not open to new developers. Confirmed via eBay's own community forum/docs search results. |
| **BAXUS** | ❌ Not used | Real on-chain whiskey marketplace with pricing data, but no published developer API found. |
| **Whiskybase / Whiskystats** | ❌ Not used | Real, more comprehensive data, but paid/licensed API access — not "reachable without violating terms" for a free personal POC. |

The valuation layer (`api/src/services/valuation/`) is intentionally
provider-agnostic: `ValuationProvider` is a one-method interface, and
`services/valuation/index.ts` is the only place that knows about a
primary/fallback chain — swapping or adding a source later means writing one
new file, not touching `bottleService.ts` or any route.

**Not independently verified against the live WhiskyHunter API** — see step
8 above.

---

## Verification status (summary table)

| Piece | Verified how | Not verified |
|---|---|---|
| `BottleRegistry.sol` | Compiled with `solc` directly (viaIR); deployed + exercised via raw JSON-RPC against a local Hardhat network (every function, both custom-error revert paths) | Deploy against real Besu QBFT |
| `hardhat/` | `hardhat.config.ts` paths/network config reviewed; `deploy.ts` logic exercised manually (same steps, via a scratch script) | `npx hardhat compile`/`test` themselves (blocked: `binaries.soliditylang.org`) |
| `api/` | Full endpoint suite smoke-tested live (see step 7); `tsc --noEmit` clean | Real Web3Signer/KMS signing; live WhiskyHunter/eBay calls |
| `frontend/` | `tsc -b` + `vite build` clean; visually screenshotted (light + dark) against a live API | — |
| `scripts/00`–`02` (AWS) | Address-derivation math verified independently; script logic reviewed | Not run — no `aws` CLI in this sandbox |
| `scripts/03`–`05` (genesis/bring-up) | Script logic reviewed; genesis-generation approach deliberately delegates to Besu's own tooling instead of a hand-rolled implementation | Not run — no Docker daemon in this sandbox |
| Web3Signer AWS KMS config | Field names confirmed against Web3Signer source (PR #837) | Not diffed against live docs (blocked) or run |

---

## Guardrails followed

- No AWS resources have been created — no AWS CLI was even available in
  this sandbox. Nothing in `scripts/` has been executed against a real
  account.
- IAM: `scripts/01-create-kms-and-iam.sh` creates one policy scoped to
  exactly the one KMS key this project creates — nothing broader.
- Nothing destructive was run or scripted without an explicit ask-first
  path — `scripts/02-provision-ec2.sh` refuses to create a second instance
  if one already exists rather than replacing it, and none of the scripts
  delete anything.
- No secrets are committed: `.env`/`.env.*` (except `.env.example`),
  `QBFT-Network/generated/`, `QBFT-Network/validator-keys/*`,
  `docker/web3signer/keys/*.yaml` (the rendered one, not the template), and
  `*.pem` are all gitignored.

---

## Corrections

Dated, in the spirit of the prior project's habit — recording what didn't
work on the first attempt rather than silently fixing it.

### 2026-09-04 — Hardhat project root vs. top-level `contracts/`

First attempt at `hardhat.config.ts` set `paths.sources: "../contracts"`
with the default project root (the `hardhat/` directory itself). Hardhat
refused to compile: `HH1007: ... is treated as local but is outside the
project` — Hardhat requires all source paths to live under `paths.root`, it
doesn't just resolve `../` paths relative to the config file. Fixed by
setting `paths.root: ".."` (the repo root) and making every other path
(`sources`, `tests`, `cache`, `artifacts`) explicit from there. This is what
lets `contracts/` stay a top-level sibling of `hardhat/` instead of nesting
under it, matching the rest of the repo's layout.

### 2026-09-04 — `addBottle` hit "stack too deep"

`BottleRegistry.addBottle` takes 10 parameters (mirroring the full `Bottle`
struct explicitly, rather than collapsing it into an opaque calldata blob,
because an explicit signature is more useful for the "learn how the API
talks to the chain" goal). The legacy Solidity code generator couldn't
handle that many locals: `CompilerError: Stack too deep`. Fixed by enabling
`viaIR: true` in the optimizer settings — slower compiles, same explicit
function signature. Alternatives considered and rejected: collapsing the
params into a struct (loses the self-documenting signature this project
values) or splitting `addBottle` into multiple calls (loses atomicity — a
half-added bottle is worse than a slower compile).

### 2026-09-04 — `binaries.soliditylang.org` and other docs sites blocked

This dev sandbox's network egress policy blocks `binaries.soliditylang.org`
(Hardhat's own `solc` downloader), `docs.web3signer.consensys.io`,
`besu.hyperledger.org`, and `whiskyhunter.net`, among others. Per this
session's own instructions, blocked hosts are not something to route
around — so instead of retrying or proxying past the policy, each blocked
dependency got a documented, honest workaround: `solc` compiled directly via
the npm package instead of Hardhat's downloader (see step 6 above);
Web3Signer's config fields sourced from its GitHub PR instead of its docs
site; the QBFT genesis format delegated entirely to Besu's own tooling
instead of guessed from partial docs; WhiskyHunter's field-parsing written
defensively instead of asserted-correct. None of these are silent — see
"Verification status" above for exactly what that means for each piece, and
re-verify anything marked "not verified" before depending on it.

### 2026-09-04 — `multer` and `recharts` versions bumped during setup

Both were initially pinned to older majors from habit (`multer@1.x`,
`recharts@2.x`); `npm install` warned that `multer@1.x` has known
vulnerabilities patched in 2.x and that `recharts@2.x` is no longer
actively maintained. Bumped to `multer@^2.3.0` and `recharts@^3.10.1` before
writing any code against them (not after) — both typecheck and build clean,
and the smoke tests above were run against these versions, not the older
ones.
