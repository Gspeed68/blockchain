#!/usr/bin/env bash
# Generates the QBFT genesis.json and validator node keys using Besu's own
# `operator generate-blockchain-config` subcommand.
#
# Why not hand-roll this? QBFT's genesis `extraData` field is an RLP-encoded
# structure (32-byte vanity + sorted validator address list + null vote +
# round=0 + empty commit seals). It's easy to get subtly wrong — a
# byte-order or list-vs-string RLP mistake produces a genesis file that
# looks fine, loads fine, and then either refuses to produce blocks or
# disagrees between nodes about the validator set, which is a miserable
# thing to debug on a running Azure VM. Besu's own generator is the
# tested, canonical implementation, so we shell out to it via Docker instead
# of reimplementing RLP-encoded QBFT extra data in this repo.
#
# Docs: https://besu.hyperledger.org/private-networks/tutorials/qbft
# (verify current field defaults there against QBFT-Network/config/qbftConfigFile.json
# before a real run — this script was written without live access to that
# page; see the dated note in README-BOURBON-PORT.md.)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/QBFT-Network/config/qbftConfigFile.json"
OUT_DIR="${REPO_ROOT}/QBFT-Network/generated"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:24.7.0}"

VALIDATOR_COUNT="$(grep -A2 '"nodes"' "${CONFIG_FILE}" | grep '"count"' | grep -o '[0-9]\+')"

echo "== Generating QBFT genesis + ${VALIDATOR_COUNT} validator keys =="
echo "   config: ${CONFIG_FILE}"
echo "   output: ${OUT_DIR}  (gitignored — contains validator private keys)"
echo

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "ERROR: missing ${CONFIG_FILE}" >&2
  exit 1
fi

grep -q '"0x0000000000000000000000000000000000000000"' "${CONFIG_FILE}" && {
  echo "WARNING: qbftConfigFile.json still has the placeholder alloc address."
  echo "         Run scripts/01-create-keyvault-and-identity.sh first and replace"
  echo "         it with the app identity's derived address so it starts pre-funded."
  echo
}

mkdir -p "${OUT_DIR}"

# Validator node keys are generated locally by Besu and must stay local —
# per the project brief, QBFT consensus signing is never vault-backed (only
# the app's own transaction-signing identity is). Nothing under
# QBFT-Network/generated or QBFT-Network/validator-keys should ever be
# committed (.gitignore already excludes both).
docker run --rm \
  -v "${REPO_ROOT}/QBFT-Network/config:/config" \
  -v "${OUT_DIR}:/out" \
  "${BESU_IMAGE}" \
  operator generate-blockchain-config \
    --config-file=/config/qbftConfigFile.json \
    --to=/out \
    --private-key-file-name=key

echo
echo "Done. Contents of ${OUT_DIR}:"
ls -la "${OUT_DIR}"
echo
echo "Next: copy ${OUT_DIR}/genesis.json to QBFT-Network/generated/genesis.json"
echo "(already there) and each node's key/key.pub into per-validator dirs for"
echo "docker/besu/docker-compose.yml. See README-BOURBON-PORT.md step 3 (VM + genesis)."
