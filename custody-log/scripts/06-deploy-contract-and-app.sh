#!/usr/bin/env bash
# Deploys CustodyRegistry (if not already deployed) and then builds/starts
# the api + frontend containers. Run this ON the target VM, after
# scripts/05-bring-up-stack.sh has the chain half of the stack up.
#
# Idempotent by design: re-running this after the app is already deployed
# does NOT redeploy the contract (which would orphan whatever's already on
# it and hand the frontend a stale address to chase) — it only rebuilds/
# restarts api+frontend, which is exactly what you want after a code change.
# Set FORCE_REDEPLOY=1 (or "true") to explicitly deploy a fresh contract
# instance anyway (this abandons all existing on-chain data at the old
# address).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_CONFIG="${REPO_ROOT}/api/src/config/contract.json"
# Accepts "1"/"true" (GitHub Actions' workflow_dispatch boolean inputs come
# through as the literal strings "true"/"false", not "1"/"0").
FORCE_REDEPLOY="${FORCE_REDEPLOY:-0}"

CURRENT_ADDRESS="$(python3 -c 'import json;print(json.load(open("'"${CONTRACT_CONFIG}"'"))["address"])')"

if [ "${CURRENT_ADDRESS}" = "0x0000000000000000000000000000000000000000" ] || [ "${FORCE_REDEPLOY}" = "1" ] || [ "${FORCE_REDEPLOY}" = "true" ]; then
  echo "== Compiling and deploying CustodyRegistry =="
  cd "${REPO_ROOT}/hardhat"
  npm ci
  npx hardhat compile
  npx hardhat run scripts/deploy.ts --network localhost
else
  echo "== CustodyRegistry already deployed at ${CURRENT_ADDRESS} — skipping deploy =="
  echo "   (set FORCE_REDEPLOY=1 to deploy a fresh instance instead.)"
fi

echo
echo "== Detecting this VM's public IP (Azure Instance Metadata Service) =="
PUBLIC_IP="$(curl -sf -H 'Metadata:true' \
  'http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text')"
if [ -z "${PUBLIC_IP}" ]; then
  echo "ERROR: couldn't determine this VM's public IP from IMDS." >&2
  exit 1
fi
echo "Public IP: ${PUBLIC_IP}"

echo
echo "== Building + starting api and frontend =="
cd "${REPO_ROOT}/docker"
export API_PUBLIC_BASE_URL="http://${PUBLIC_IP}:4100"
docker compose build api frontend
docker compose up -d api frontend

echo
echo "== Waiting for the API to come up =="
for i in $(seq 1 30); do
  if curl -sf http://localhost:4100/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo
echo "== Verifying /health reports the contract as deployed =="
HEALTH_FILE="$(mktemp)"
curl -sf http://localhost:4100/health > "${HEALTH_FILE}"
cat "${HEALTH_FILE}"
python3 -c "
import json
with open('${HEALTH_FILE}') as f:
    health = json.load(f)
assert health['contract']['deployed'] is True, 'contract.deployed is not true — deploy step above may have failed'
assert health['besu']['ok'] is True, 'besu RPC not reachable from the api container'
assert health['web3signer']['ok'] is True, 'web3signer not reachable from the api container'
print('OK: api reports a deployed contract and healthy chain/web3signer connections.')
"
rm -f "${HEALTH_FILE}"

echo
echo "== App is live =="
echo "Frontend: http://${PUBLIC_IP}:5174"
echo "API:      http://${PUBLIC_IP}:4100"
echo "Grafana:  http://${PUBLIC_IP}:3000  (only reachable if ALLOWED_SSH_CIDR was set in scripts/02)"
echo
echo "NOTE: the ports above are only reachable from outside if scripts/02-provision-vm.sh"
echo "was run with ALLOWED_SSH_CIDR set to your IP — by default this VM has no inbound"
echo "internet access at all (see that script's header comment)."
