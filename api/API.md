# Bourbon Registry API

A REST API in front of the `BottleRegistry` smart contract. Every read
(`GET`) queries the chain directly (`eth_call`) — there's no database to go
stale. Every write signs and sends a real transaction through Web3Signer
(KMS-backed) and waits for it to be mined before responding, unless it's
still pending after ~30s, in which case you get a `202` with a `txHash` to
poll. See `api/src/chain/writeTransaction.ts` for the full, heavily-commented
transaction lifecycle (nonce handling, gas estimation, pending vs. confirmed,
what happens on a revert).

A machine-readable version of this is in `api/openapi/openapi.yaml`.

Base URL in these examples: `http://localhost:4000`. All request/response
bodies are JSON except the upload endpoint, which is `multipart/form-data`.

Every example below was actually run against a live instance of this API
(backed by a local Hardhat node standing in for Besu+Web3Signer, since this
repo's dev sandbox has no real network yet) — see README-BOURBON-PORT.md.

---

## Money, proof, and fill level

- Money is always in **integer cents** on the wire (`purchasePriceCents`,
  `valueCents`) — the contract stores cents, not floats, to avoid any
  floating-point rounding on-chain. Responses also include a formatted
  `...Usd` string for convenience.
- `proof` is a decimal (e.g. `100.6`), stored on-chain as `proof * 10`.
- `fillLevelPercent` is 0-100 (one decimal of precision), stored on-chain in
  basis points (0-10000).

## Condition values

`Sealed`, `OpenPourable`, `LowFill`, `Empty`, `Damaged` — see
`contracts/BottleRegistry.sol`'s `Condition` enum. These are exact string
matches, case-sensitive.

---

## `GET /health`

Connectivity check against both Besu (chain id + block number) and
Web3Signer (which addresses it holds keys for).

```bash
curl -s http://localhost:4000/health
```

```json
{
  "status": "ok",
  "contract": { "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3", "deployed": true },
  "besu": { "ok": true, "chainId": 31337, "blockNumber": 1 },
  "web3signer": { "ok": true, "accounts": ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"] }
}
```

`status` is `"degraded"` (HTTP 503) if either dependency is unreachable.

---

## `GET /bottles`

List the whole collection. Reads `getAllBottleIds()` then `getBottle(id)`
for each — see the O(n) comment in `api/src/services/bottleService.ts` for
why that's fine at personal-collection scale.

```bash
curl -s http://localhost:4000/bottles
```

```json
[
  {
    "id": 1,
    "owner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "distillery": "Buffalo Trace",
    "bottleName": "E.H. Taylor Single Barrel",
    "proof": 100.6,
    "releaseYear": 2023,
    "purchaseDate": "2023-06-01T00:00:00.000Z",
    "purchasePriceCents": 6499,
    "purchasePriceUsd": "64.99",
    "condition": "Sealed",
    "fillLevelPercent": 100,
    "photoUri": "https://example.com/photo.jpg",
    "photoHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "createdAt": "2026-09-04T22:12:14.000Z"
  }
]
```

---

## `POST /bottles`

Adds a bottle. This is a full write: ABI-encode → `eth_estimateGas` dry run
→ nonce + gas price → `eth_sendTransaction` via Web3Signer → poll for the
receipt. `addBottle` also seeds the appraisal history with a "purchase"
entry pinned to `purchasePriceCents`, so the value-over-time chart always
has a real starting point.

```bash
curl -s -X POST http://localhost:4000/bottles \
  -H 'content-type: application/json' \
  -d '{
    "distillery": "Buffalo Trace",
    "bottleName": "E.H. Taylor Single Barrel",
    "proof": 100.6,
    "releaseYear": 2023,
    "purchaseDate": "2023-06-01",
    "purchasePriceCents": 6499,
    "condition": "Sealed",
    "fillLevelPercent": 100,
    "photoUri": "https://example.com/photo.jpg"
  }'
```

`201 Created` (confirmed within the wait window):

```json
{
  "status": "confirmed",
  "transaction": { "txHash": "0xa6be...", "blockNumber": 2, "gasUsed": "515344" },
  "data": { "id": 1, "distillery": "Buffalo Trace", "...": "..." }
}
```

`202 Accepted` (still pending — poll `GET /transactions/:txHash`):

```json
{ "status": "pending", "txHash": "0xa6be...", "message": "Transaction submitted but not yet confirmed. Poll GET /transactions/:txHash." }
```

`400` if the transaction would revert (caught at the `eth_estimateGas` dry
run — nothing was sent, no gas spent):

```json
{ "error": "transaction_would_revert", "reason": "NotAdmin()" }
```

---

## `GET /bottles/:id`

Bottle detail, including its full appraisal history (for the value-over-time
chart).

```bash
curl -s http://localhost:4000/bottles/1
```

```json
{
  "id": 1,
  "distillery": "Buffalo Trace",
  "...": "...",
  "appraisals": [
    { "id": 1, "bottleId": 1, "valueCents": 6499, "valueUsd": "64.99", "source": "purchase", "note": "Initial value set to purchase price", "timestamp": "2026-09-04T22:12:14.000Z", "recordedBy": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }
  ]
}
```

`404` with a decoded contract error if the id doesn't exist:

```json
{ "error": "contract_call_reverted", "function": "getBottle", "reason": "BottleNotFound(999)" }
```

---

## `PATCH /bottles/:id/condition`

Updates condition/fill level (a write, same lifecycle as `POST /bottles`).

```bash
curl -s -X PATCH http://localhost:4000/bottles/1/condition \
  -H 'content-type: application/json' \
  -d '{"condition": "OpenPourable", "fillLevelPercent": 85.5}'
```

Response shape matches `POST /bottles`.

---

## `GET /bottles/:id/appraisals`

Just the appraisal history array (same data `GET /bottles/:id` embeds).

```bash
curl -s http://localhost:4000/bottles/1/appraisals
```

---

## `POST /bottles/:id/appraisals`

Manual appraisal entry — e.g. you got a real offer on the bottle and want
to record it without waiting on an external valuation source.

```bash
curl -s -X POST http://localhost:4000/bottles/1/appraisals \
  -H 'content-type: application/json' \
  -d '{"valueCents": 12000, "note": "friend offered me this"}'
```

Recorded with `source: "manual"`. Response shape matches `POST /bottles`
(the confirmed/pending envelope), with `data` being the new `Appraisal`.

---

## `POST /bottles/:id/appraisals/refresh`

The "trigger a value refresh" endpoint: fetches an estimated value from the
configured external source (WhiskyHunter by default, falling back to eBay's
Browse API — see `api/src/services/valuation/`) and records it on-chain.

```bash
curl -s -X POST http://localhost:4000/bottles/1/appraisals/refresh
```

```json
{
  "status": "confirmed",
  "transaction": { "txHash": "0xf087...", "blockNumber": 5, "gasUsed": "287382" },
  "data": {
    "id": 3, "bottleId": 1, "valueCents": 17638, "valueUsd": "176.38",
    "source": "whiskyhunter",
    "note": "Median of 3 recent auction comp(s) for \"Buffalo Trace\" matching \"E.H. Taylor Single Barrel\", converted from GBP at 1.27.",
    "timestamp": "2026-09-04T22:12:30.000Z", "recordedBy": "0xf39..."
  }
}
```

`404` if no source has any data for the bottle:

```json
{ "error": "no_valuation_found", "message": "No valuation data found for \"...\" from any configured source." }
```

---

## `POST /uploads`

Uploads a bottle photo (stored locally by this API for the POC — see
`api/src/services/uploadService.ts` for the S3 swap-out path) and returns
the URI + sha256 hash to pass as `photoUri`/`photoHash` on `POST /bottles`.

```bash
curl -s -X POST http://localhost:4000/uploads -F "photo=@./bottle.jpg;type=image/jpeg"
```

```json
{ "photoUri": "http://localhost:4000/uploads/c99c0c4d-....jpg", "photoHash": "0x313fb8d0..." }
```

---

## `GET /transactions/:txHash`

Look up any transaction directly — useful for polling after a `202`, or
just to see pending-vs-confirmed-vs-reverted on its own.

```bash
curl -s http://localhost:4000/transactions/0xf0875ea46589bd2c5b9fffbe8ab8034e046a674d8b70163b7a357d20741cf0d4
```

```json
{ "txHash": "0xf087...", "status": "confirmed", "blockNumber": 5, "gasUsed": "287382" }
```

`status` is `"pending"` (tx known but not yet mined), `"confirmed"`, or
`"reverted"`. `404` if the node has never heard of that hash.

---

## Error shapes

| HTTP | `error` | When |
|---|---|---|
| 400 | `invalid_request` | Request body failed schema validation (Zod) |
| 400 | `transaction_would_revert` | `eth_estimateGas` dry run reverted — nothing was sent |
| 404 | `contract_call_reverted` (when reason is `BottleNotFound`) | Unknown bottle id on a read |
| 400 | `contract_call_reverted` (other reasons) | A different revert on a read |
| 409 | `transaction_reverted` | Transaction WAS mined but reverted (gas was still spent) |
| 404 | `no_valuation_found` | No configured valuation source has data for the bottle |
| 502 | `chain_rpc_error` | Besu/Web3Signer unreachable or returned an unexpected error |
| 500 | `internal_error` | Anything else |
