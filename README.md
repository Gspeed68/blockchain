# Bourbon Registry

A personal bourbon/whiskey collection tracker with on-chain provenance: bottle
records and an append-only appraisal history live on a private Besu QBFT
blockchain, written and read by a real backend API (no direct
frontend-to-chain calls), with a frontend built to actually be nice to use.

This is a from-scratch, standalone project — a new private network, new
signing key, new contract, new API, new frontend. It follows the same
architectural pattern as an earlier Besu/QBFT private-network project
(private network, vault-backed signing via Web3Signer instead of raw keys,
Hardhat for contract dev/deploy) but shares no infrastructure with it.
Originally scaffolded for AWS (KMS/IAM/EC2); the cloud target switched to
**Azure** (Key Vault/Managed Identity/VM) — see README-BOURBON-PORT.md's
dated Pivot entry for why nothing about the contract, API, or frontend had
to change when that happened.

**See `README-BOURBON-PORT.md` for the full build log**: architecture,
exact run order, what's been verified vs. not, and dated corrections where an
early assumption turned out wrong.

## Repo layout

```
contracts/        BottleRegistry.sol — the on-chain source of truth
hardhat/           Contract compile/test/deploy workspace (targets contracts/)
QBFT-Network/      Genesis config template + generated network files (gitignored)
docker/            Docker Compose: Besu (x4 validators), Web3Signer, Prometheus, Grafana
scripts/           Numbered setup scripts (Azure auth -> Key Vault/identity -> VM -> genesis -> bring-up)
api/               Backend REST API — Web3Signer-signed writes, chain-read GETs
frontend/          React/Vite SPA — collection grid, bottle detail + value chart
```

## Quick start (local, no Azure)

Everything below runs against a local Hardhat network standing in for
Besu+Web3Signer — good enough to develop and demo the whole app end to end.
See README-BOURBON-PORT.md for the real Azure/Besu/Web3Signer path.

```bash
# 1. A local chain
cd hardhat && npm install && npx hardhat node        # separate terminal, leave running

# 2. Deploy the contract to it, and point the API at the result
#    (see README-BOURBON-PORT.md's "Local dev shortcut" for the exact deploy
#    command — hardhat's own `compile` needs network access this repo's dev
#    sandbox didn't have; the contract itself is verified independently, see
#    README-BOURBON-PORT.md)

# 3. Backend API
cd api && npm install && cp .env.example .env   # then edit BESU_RPC_URL/WEB3SIGNER_RPC_URL to the local node
npm run dev

# 4. Frontend
cd frontend && npm install && cp .env.example .env
npm run dev   # http://localhost:5173
```

## API docs

`api/API.md` — narrated examples with real request/response bodies for
every endpoint. `api/openapi/openapi.yaml` — machine-readable spec.
