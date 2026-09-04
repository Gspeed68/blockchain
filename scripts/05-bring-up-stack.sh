#!/usr/bin/env bash
# Brings up the full stack (4 Besu validators + Web3Signer + Prometheus +
# Grafana) and verifies block production and peering before declaring
# success — "docker compose up -d" succeeding is not the same as the
# network actually working.
#
# Run this ON THE EC2 HOST after copying the repo there (or locally against
# a Docker daemon for a dry run — the compose file doesn't know or care
# which).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Mapping generated validator keys into docker/besu/validators/ =="
node "${REPO_ROOT}/scripts/lib/prepare-validators.js"

if [ ! -f "${REPO_ROOT}/docker/web3signer/keys/eth1-app-identity.yaml" ]; then
  echo "ERROR: docker/web3signer/keys/eth1-app-identity.yaml missing." >&2
  echo "Run scripts/04-configure-web3signer.sh first." >&2
  exit 1
fi

echo
echo "== docker compose up -d =="
cd "${REPO_ROOT}/docker"
docker compose up -d

echo
echo "== Waiting for besu-validator-1 RPC to respond =="
for i in $(seq 1 30); do
  if curl -sf -X POST http://localhost:8545 \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo
echo "== Confirming block production (watching for 15s) =="
BLOCK_BEFORE="$(curl -s -X POST http://localhost:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c 'import json,sys;print(int(json.load(sys.stdin)["result"],16))')"
sleep 15
BLOCK_AFTER="$(curl -s -X POST http://localhost:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | python3 -c 'import json,sys;print(int(json.load(sys.stdin)["result"],16))')"

echo "Block number: ${BLOCK_BEFORE} -> ${BLOCK_AFTER}"
if [ "${BLOCK_AFTER}" -le "${BLOCK_BEFORE}" ]; then
  echo "FAIL: block number did not advance — QBFT consensus is not producing blocks." >&2
  echo "Check: docker compose -f docker/docker-compose.yml logs besu-validator-1" >&2
  exit 1
fi
echo "OK: chain is producing blocks."

echo
echo "== Confirming peering =="
PEER_COUNT_HEX="$(curl -s -X POST http://localhost:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"net_peerCount","params":[]}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])')"
PEER_COUNT=$((PEER_COUNT_HEX))
echo "besu-validator-1 peer count: ${PEER_COUNT} (expect 3, the other three validators)"
if [ "${PEER_COUNT}" -lt 1 ]; then
  echo "FAIL: validator-1 has no peers — check bootnodes.txt / enode derivation in scripts/lib/prepare-validators.js" >&2
  exit 1
fi

echo
echo "== Confirming Web3Signer can see the KMS-backed account =="
curl -s -X POST http://localhost:9000 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}'
echo
echo "(should list exactly one address — the app identity from scripts/01-create-kms-and-iam.sh)"

echo
echo "== Stack is up =="
echo "Besu RPC (validator-1): http://localhost:8545"
echo "Web3Signer:              http://localhost:9000"
echo "Prometheus:              http://localhost:9090"
echo "Grafana:                 http://localhost:3000  (admin / \$GRAFANA_ADMIN_PASSWORD)"
echo
echo "Next: cd hardhat && npm run deploy:besu"
