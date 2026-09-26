#!/usr/bin/env bash
# Generates the QBFT genesis.json and validator node keys using Besu's own
# `operator generate-blockchain-config` subcommand.
#
# Why not hand-roll this? QBFT's genesis `extraData` field is an RLP-encoded
# structure (32-byte vanity + sorted validator address list + null vote +
# round=0 + empty commit seals). It's easy to get subtly wrong, so this
# shells out to Besu's own tested generator instead of reimplementing it.
#
# Idempotent: if QBFT-Network/generated/genesis.json already exists, this
# does nothing. That matters a lot here specifically — this script is meant
# to run on the target VM's persistent disk (not an ephemeral CI runner),
# and regenerating it on a second run would produce different validator
# keys/addresses than whatever network is already live, which Besu would
# then refuse to reconcile with any existing chain data in besu-data-*.
#
# Docs: https://besu.hyperledger.org/private-networks/tutorials/qbft
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/QBFT-Network/config/qbftConfigFile.json"
OUT_DIR="${REPO_ROOT}/QBFT-Network/generated"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:24.7.0}"

if [ -f "${OUT_DIR}/genesis.json" ]; then
  echo "== ${OUT_DIR}/genesis.json already exists — skipping generation =="
  echo "   (delete it explicitly, and accept that this wipes any existing chain"
  echo "    data on this host, if you actually want a fresh network.)"
  exit 0
fi

VALIDATOR_COUNT="$(grep -A2 '"nodes"' "${CONFIG_FILE}" | grep '"count"' | grep -o '[0-9]\+')"

echo "== Generating QBFT genesis + ${VALIDATOR_COUNT} validator keys =="
echo "   config: ${CONFIG_FILE}"
echo "   output: ${OUT_DIR}  (gitignored — contains validator private keys)"
echo

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "ERROR: missing ${CONFIG_FILE}" >&2
  exit 1
fi

if grep -q '"0x0000000000000000000000000000000000000000"' "${CONFIG_FILE}"; then
  echo "== qbftConfigFile.json still has the placeholder alloc address — deriving the real one =="
  KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:-custody-log-kv}"
  KEY_NAME="custody-log-signer"
  if az account show >/dev/null 2>&1 && az keyvault key show --vault-name "${KEY_VAULT_NAME}" --name "${KEY_NAME}" >/dev/null 2>&1; then
    # Running with authenticated az CLI access to the key (e.g. this VM's
    # own managed identity, per scripts/02-provision-vm.sh) — derive and
    # patch automatically rather than making a human copy/paste it. This is
    # the same derivation scripts/01-create-keyvault-and-identity.sh does;
    # it's repeated here because that script typically runs on a different
    # machine (the operator's, or the CI runner) than this one (the target
    # VM), so its output file isn't necessarily present on this filesystem.
    APP_ADDRESS="$(az keyvault key show --vault-name "${KEY_VAULT_NAME}" --name "${KEY_NAME}" -o json \
      | node "${REPO_ROOT}/scripts/lib/derive-eth-address-azure.js")"
    sed -i "s|0x0000000000000000000000000000000000000000|${APP_ADDRESS}|" "${CONFIG_FILE}"
    echo "Patched alloc address to ${APP_ADDRESS}."
  else
    echo "WARNING: no authenticated access to ${KEY_VAULT_NAME}/${KEY_NAME} from here — leaving the" >&2
    echo "         placeholder in place. Run scripts/01-create-keyvault-and-identity.sh somewhere" >&2
    echo "         with access first, or patch this file by hand, so the app identity starts" >&2
    echo "         pre-funded for gas." >&2
  fi
  echo
fi

mkdir -p "${OUT_DIR}"

# Validator node keys are generated locally by Besu and must stay local —
# QBFT consensus signing is never vault-backed (only the app's own
# transaction-signing identity is). Nothing under QBFT-Network/generated or
# QBFT-Network/validator-keys should ever be committed (.gitignore already
# excludes both).
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
echo "Next: scripts/lib/prepare-validators.js maps this into docker/besu/validators/"
echo "(scripts/05-bring-up-stack.sh does this for you)."
