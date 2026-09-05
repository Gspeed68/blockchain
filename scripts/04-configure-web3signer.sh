#!/usr/bin/env bash
# Renders the Web3Signer key-config template with this project's real Key
# Vault name and tenant ID. Run on the Azure VM (or locally, then scp the
# rendered file over) after scripts/01-create-keyvault-and-identity.sh has
# created the key.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:-bourbon-registry-kv}"

TENANT_ID="$(az account show --query tenantId -o tsv)"
if [ -z "${TENANT_ID}" ]; then
  echo "ERROR: couldn't determine the Azure tenant ID — run scripts/00-check-azure-auth.sh first." >&2
  exit 1
fi

if ! az keyvault show --name "${KEY_VAULT_NAME}" >/dev/null 2>&1; then
  echo "ERROR: Key Vault ${KEY_VAULT_NAME} not found. Run scripts/01-create-keyvault-and-identity.sh first." >&2
  exit 1
fi

TEMPLATE="${REPO_ROOT}/docker/web3signer/keys/eth1-app-identity.yaml.template"
OUT="${REPO_ROOT}/docker/web3signer/keys/eth1-app-identity.yaml"

sed -e "s|\${AZURE_KEY_VAULT_NAME}|${KEY_VAULT_NAME}|g" -e "s|\${AZURE_TENANT_ID}|${TENANT_ID}|g" "${TEMPLATE}" > "${OUT}"

echo "Wrote ${OUT} (gitignored) for vault ${KEY_VAULT_NAME}, tenant ${TENANT_ID}."
echo "Next: scripts/05-bring-up-stack.sh"
