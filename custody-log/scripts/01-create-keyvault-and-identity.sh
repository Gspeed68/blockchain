#!/usr/bin/env bash
# Creates the resource group + Key Vault + ONE signing key this app needs.
# The vault uses Azure's RBAC authorization model (not the older vault
# access-policy model) so access can be scoped to exactly this one key by
# object ID.
#
# Why only one key: this app has no counterparty/marketplace concept on
# its own signing side — every custody event is recorded by the same
# backend identity, on behalf of whichever custodian the API call
# describes (see contracts/CustodyRegistry.sol's design note 1). If a
# future version needs an independent custodian-signed attestation, that's
# a real design change and deserves its own Key Vault key then — don't
# create a speculative second key now for a feature that doesn't exist.
#
# The role assignment scoping the VM's managed identity to this key happens
# in scripts/02-provision-vm.sh, not here — Azure generates the managed
# identity's principal ID when the VM is created, so that dependency only
# resolves after the VM exists.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/00-check-azure-auth.sh"

LOCATION="${AZURE_LOCATION:-eastus}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-custody-log-rg}"
KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:-custody-log-kv}" # must be globally unique across Azure
KEY_NAME="custody-log-signer"

echo "== Resource group ${RESOURCE_GROUP} in ${LOCATION} =="
if ! az group show --name "${RESOURCE_GROUP}" >/dev/null 2>&1; then
  az group create --name "${RESOURCE_GROUP}" --location "${LOCATION}" \
    --tags project=custody-log >/dev/null
  echo "Created resource group ${RESOURCE_GROUP}."
else
  echo "Reusing existing resource group ${RESOURCE_GROUP}."
fi

echo
echo "== Key Vault ${KEY_VAULT_NAME} (RBAC authorization) =="
if ! az keyvault show --name "${KEY_VAULT_NAME}" --resource-group "${RESOURCE_GROUP}" >/dev/null 2>&1; then
  az keyvault create \
    --name "${KEY_VAULT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --enable-rbac-authorization true \
    --tags project=custody-log >/dev/null
  echo "Created Key Vault ${KEY_VAULT_NAME}."
else
  echo "Reusing existing Key Vault ${KEY_VAULT_NAME}."
fi

VAULT_ID="$(az keyvault show --name "${KEY_VAULT_NAME}" --resource-group "${RESOURCE_GROUP}" --query id -o tsv)"

echo
echo "== Signing key ${KEY_NAME} (EC, curve P-256K = secp256k1) =="
if ! az keyvault key show --vault-name "${KEY_VAULT_NAME}" --name "${KEY_NAME}" >/dev/null 2>&1; then
  # Whoever/whatever runs this needs at least "Key Vault Crypto Officer" on
  # the vault to create the key itself; the scoped-down role for day-to-day
  # signing (granted to the VM's managed identity in scripts/02) is
  # separate and much narrower.
  az keyvault key create \
    --vault-name "${KEY_VAULT_NAME}" \
    --name "${KEY_NAME}" \
    --kty EC \
    --curve P-256K \
    --ops sign verify >/dev/null
  echo "Created key ${KEY_NAME}."
else
  echo "Reusing existing key ${KEY_NAME}."
fi

KEY_ID="$(az keyvault key show --vault-name "${KEY_VAULT_NAME}" --name "${KEY_NAME}" --query key.kid -o tsv)"
echo "Key ID: ${KEY_ID}"

echo
echo "== Deriving the app identity's Ethereum address =="
az keyvault key show --vault-name "${KEY_VAULT_NAME}" --name "${KEY_NAME}" -o json \
  > /tmp/custody-log-azure-public-key.json
APP_ADDRESS="$(node "${REPO_ROOT}/scripts/lib/derive-eth-address-azure.js" < /tmp/custody-log-azure-public-key.json)"
echo "App signing identity address: ${APP_ADDRESS}"
mkdir -p "${REPO_ROOT}/QBFT-Network/generated"
echo "${APP_ADDRESS}" > "${REPO_ROOT}/QBFT-Network/generated/app-identity-address.txt"
echo "-> wrote ${REPO_ROOT}/QBFT-Network/generated/app-identity-address.txt"
echo "   Paste this into QBFT-Network/config/qbftConfigFile.json's alloc block"
echo "   (replacing the 0x000...000 placeholder) before running 03-generate-qbft-genesis.sh,"
echo "   so the app identity starts pre-funded for gas."

echo
echo "== Summary =="
echo "Resource group:      ${RESOURCE_GROUP}"
echo "Key Vault:            ${KEY_VAULT_NAME} (${LOCATION})"
echo "Key ID:               ${KEY_ID}"
echo "App identity addr:    ${APP_ADDRESS}"
echo
echo "Next: scripts/02-provision-vm.sh (creates the VM's managed identity and"
echo "grants it Key Vault Crypto User scoped to exactly this key)."
