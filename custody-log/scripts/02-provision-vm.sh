#!/usr/bin/env bash
# Provisions ONE Azure VM that runs the whole stack (4 Besu validator
# containers + Web3Signer + Prometheus/Grafana + the app itself) via Docker
# Compose — one host, four validator *processes* still gives real QBFT
# consensus and real peering without paying for four VMs, which is the
# right tradeoff for this app's scale.
#
# Network access model: by default this script does NOT open any inbound
# port to the internet. Deployment and verification both happen through
# `az vm run-command` (the Azure control-plane API, not a direct network
# path to the VM), which is what lets a CI runner with an unpredictable,
# ephemeral IP address drive this whole setup without ever needing an NSG
# rule for itself. If you (a human) also want direct access — SSH, hitting
# Grafana/the frontend from your own browser — set ALLOWED_SSH_CIDR to your
# IP (e.g. "203.0.113.5/32") and re-run this script; it'll open exactly
# that range and nothing else, re-applied idempotently on every run.
#
# The VM gets a system-assigned managed identity, and THIS script (not
# 01-create-keyvault-and-identity.sh) grants it access to the signing key —
# Azure only generates the identity's principal ID once the VM exists, so
# the role assignment has to happen after VM creation. The same managed
# identity is also how the VM authenticates its OWN az CLI later (`az login
# --identity`, no secrets involved) to run scripts 04 and 06 on itself via
# run-command.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/00-check-azure-auth.sh"

LOCATION="${AZURE_LOCATION:-eastus}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-custody-log-rg}"
KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:-custody-log-kv}"
KEY_NAME="custody-log-signer"
VM_NAME="custody-log-besu-host"
VM_SIZE="${VM_SIZE:-Standard_D2s_v5}" # 2 vCPU / 8GiB — 4 Besu nodes + Web3Signer + Prometheus/Grafana + api/frontend is memory-hungry
NSG_NAME="custody-log-nsg"
ADMIN_USER="${VM_ADMIN_USER:-custodyadmin}"
ALLOWED_SSH_CIDR="${ALLOWED_SSH_CIDR:-}"

# ---------------------------------------------------------------------------
# NSG: created once with no inbound rules by default. Only touched further
# if ALLOWED_SSH_CIDR is set.
# ---------------------------------------------------------------------------
if ! az network nsg show --resource-group "${RESOURCE_GROUP}" --name "${NSG_NAME}" >/dev/null 2>&1; then
  az network nsg create --resource-group "${RESOURCE_GROUP}" --name "${NSG_NAME}" \
    --location "${LOCATION}" --tags project=custody-log >/dev/null
  echo "Created NSG ${NSG_NAME} (no inbound rules — see this script's header comment)."
else
  echo "Reusing existing NSG ${NSG_NAME}."
fi

if [ -n "${ALLOWED_SSH_CIDR}" ]; then
  echo "ALLOWED_SSH_CIDR=${ALLOWED_SSH_CIDR} — opening SSH/RPC/monitoring ports to it."
  # 22=SSH, 8545/8546=Besu JSON-RPC (http/ws), 9000=Web3Signer, 3000=Grafana,
  # 9090=Prometheus, 4100=api, 5174=frontend. One rule with a port list + a
  # single source prefix, replaced wholesale on every run rather than
  # patched, so there's never a stale rule left open to an old CIDR.
  if az network nsg rule show --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" \
      --name allow-operator >/dev/null 2>&1; then
    az network nsg rule update \
      --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" --name allow-operator \
      --source-address-prefixes "${ALLOWED_SSH_CIDR}" >/dev/null
  else
    az network nsg rule create \
      --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" \
      --name allow-operator --priority 100 --direction Inbound --access Allow \
      --protocol Tcp --source-address-prefixes "${ALLOWED_SSH_CIDR}" \
      --source-port-ranges '*' --destination-port-ranges 22 8545 8546 9000 3000 9090 4100 5174 \
      --destination-address-prefixes '*' >/dev/null
  fi
  echo "NSG rule scoped to ${ALLOWED_SSH_CIDR}."
else
  echo "ALLOWED_SSH_CIDR not set — leaving the NSG with no inbound rules."
  echo "(Deployment/verification use \`az vm run-command\`, which doesn't need one.)"
fi

# ---------------------------------------------------------------------------
# The VM itself. Cloud-init installs Docker, Node.js, and the Azure CLI —
# Docker for the compose stack, Node for the setup scripts' JS helpers and
# for Hardhat's compile/deploy, and the Azure CLI so the VM can authenticate
# itself via its own managed identity (no secrets involved) to run
# scripts/04 and scripts/06.
# ---------------------------------------------------------------------------
if az vm show --resource-group "${RESOURCE_GROUP}" --name "${VM_NAME}" >/dev/null 2>&1; then
  echo "VM ${VM_NAME} already exists — not creating another."
  echo "(Deleting/replacing a VM is destructive; ask before doing that.)"
else
  CLOUD_INIT="$(mktemp)"
  cat > "${CLOUD_INIT}" <<'EOF'
#!/bin/bash
set -e
apt-get update -y
apt-get install -y docker.io docker-compose-plugin ca-certificates curl gnupg
systemctl enable --now docker
usermod -aG docker "$(logname 2>/dev/null || echo custodyadmin)"

# Node.js LTS via NodeSource.
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Azure CLI, so this VM can `az login --identity` using its own
# system-assigned managed identity — no secrets stored on the VM.
curl -sL https://aka.ms/InstallAzureCLIDeb | bash
EOF

  az vm create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${VM_NAME}" \
    --location "${LOCATION}" \
    --image Ubuntu2204 \
    --size "${VM_SIZE}" \
    --admin-username "${ADMIN_USER}" \
    --generate-ssh-keys \
    --nsg "${NSG_NAME}" \
    --public-ip-sku Standard \
    --os-disk-size-gb 50 \
    --assign-identity '[system]' \
    --custom-data "${CLOUD_INIT}" \
    --tags project=custody-log \
    -o json > /tmp/custody-log-vm-create.json

  rm -f "${CLOUD_INIT}"
  echo "Created VM ${VM_NAME}."
  echo "SSH key pair generated at ~/.ssh/id_rsa (or reused if it already existed) —"
  echo "that's local to whatever machine runs this script; not needed for the"
  echo "run-command-based deploy path, but kept for optional direct SSH access."
fi

PRINCIPAL_ID="$(az vm identity show --resource-group "${RESOURCE_GROUP}" --name "${VM_NAME}" --query principalId -o tsv)"
echo "VM managed identity principal ID: ${PRINCIPAL_ID}"

# ---------------------------------------------------------------------------
# Scope Key Vault access to exactly this VM's identity and exactly this key.
# ---------------------------------------------------------------------------
echo
echo "== Granting Key Vault Crypto User, scoped to one key =="
VAULT_ID="$(az keyvault show --name "${KEY_VAULT_NAME}" --resource-group "${RESOURCE_GROUP}" --query id -o tsv)"
OBJECT_SCOPE="${VAULT_ID}/keys/${KEY_NAME}"

if ! az role assignment create \
    --assignee-object-id "${PRINCIPAL_ID}" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Crypto User" --scope "${OBJECT_SCOPE}" >/tmp/custody-log-role-assignment.json 2>/tmp/custody-log-role-assignment-error.log; then
  echo "WARNING: per-key role assignment failed (this az CLI version's Key Vault RBAC" >&2
  echo "may not support object-level scope the way this script assumes — verify" >&2
  echo "against current Azure docs before relying on it)." >&2
  echo "Falling back to vault-wide scope (broader than intended — tighten manually if" >&2
  echo "the object-level assignment above should have worked):" >&2
  az role assignment create \
    --assignee-object-id "${PRINCIPAL_ID}" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Crypto User" --scope "${VAULT_ID}" >/dev/null
fi
echo "Granted."

echo
echo "== Also granting the VM's identity read access to the vault (for \`az account show\`" \
     "and tenant lookups in script 04) =="
if ! az role assignment create \
    --assignee-object-id "${PRINCIPAL_ID}" --assignee-principal-type ServicePrincipal \
    --role "Reader" --scope "${VAULT_ID}" >/dev/null 2>&1; then
  echo "(Reader role assignment on the vault already present or not needed — continuing.)"
fi

PUBLIC_IP="$(az vm show -d --resource-group "${RESOURCE_GROUP}" --name "${VM_NAME}" --query publicIps -o tsv)"

echo
echo "== VM ready =="
echo "VM name:    ${VM_NAME}"
echo "Public IP:  ${PUBLIC_IP}"
echo "${PUBLIC_IP}" > /tmp/custody-log-vm-public-ip.txt
if [ -n "${ALLOWED_SSH_CIDR}" ]; then
  echo "SSH:        ssh ${ADMIN_USER}@${PUBLIC_IP}"
fi
echo
echo "Next: scripts/03-generate-qbft-genesis.sh (if not already done), then either"
echo "run scripts/05/06 directly on the VM, or drive them remotely with"
echo "\`az vm run-command invoke\` (see .github/workflows/deploy-custody-log-azure.yml"
echo "for the exact commands the CI pipeline uses)."
