#!/usr/bin/env bash
# Provisions ONE Azure VM that runs the whole stack (4 Besu validator
# containers + Web3Signer + Prometheus/Grafana) via Docker Compose — same
# "one host, four validator processes" reasoning as the AWS version of this
# script (see README-BOURBON-PORT.md): this is a personal-collection POC,
# not a fault-tolerant-against-host-failure deployment, and four validator
# *processes* still gives real QBFT consensus and real peering to learn
# from without paying for four VMs.
#
# NSG (Network Security Group) handling: SSH and the RPC/monitoring ports
# are scoped to the operator's current public IP only, re-detected and
# re-applied each time this script runs — a changed home/office IP gets the
# rule refreshed instead of locking you out or erroring.
#
# The VM gets a system-assigned managed identity, and THIS script (not
# 01-create-keyvault-and-identity.sh) grants it access to the signing key —
# Azure only generates the identity's principal ID once the VM exists, so
# the role assignment has to happen after VM creation. See 01's comment for
# why that's the opposite order from the AWS/IAM version of this script.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/00-check-azure-auth.sh"

LOCATION="${AZURE_LOCATION:-eastus}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-bourbon-registry-rg}"
KEY_VAULT_NAME="${AZURE_KEY_VAULT_NAME:-bourbon-registry-kv}"
KEY_NAME="bourbon-registry-signer"
VM_NAME="bourbon-registry-besu-host"
VM_SIZE="${VM_SIZE:-Standard_D2s_v5}" # 2 vCPU / 8GiB — 4 Besu nodes + Web3Signer + Prometheus/Grafana is memory-hungry
NSG_NAME="bourbon-registry-nsg"
ADMIN_USER="${VM_ADMIN_USER:-bourbonadmin}"

MY_IP="$(curl -s https://checkip.amazonaws.com)"
echo "== Current public IP: ${MY_IP} =="

# ---------------------------------------------------------------------------
# NSG: create once, then keep its rules in sync with the operator's current IP.
# ---------------------------------------------------------------------------
if ! az network nsg show --resource-group "${RESOURCE_GROUP}" --name "${NSG_NAME}" >/dev/null 2>&1; then
  az network nsg create --resource-group "${RESOURCE_GROUP}" --name "${NSG_NAME}" \
    --location "${LOCATION}" --tags project=bourbon-registry >/dev/null
  echo "Created NSG ${NSG_NAME}."
else
  echo "Reusing existing NSG ${NSG_NAME}."
fi

STATE_FILE="/tmp/bourbon-nsg-last-ip.txt"
LAST_IP="$(cat "${STATE_FILE}" 2>/dev/null || true)"

if [ "${LAST_IP}" != "${MY_IP}" ]; then
  echo "IP changed (was: ${LAST_IP:-none}, now: ${MY_IP}) — refreshing NSG rule."

  # 22=SSH, 8545/8546=Besu JSON-RPC (http/ws), 30303=Besu P2P (all validators
  # run on this one host for this POC, so P2P doesn't need to be open beyond
  # the operator either), 9000=Web3Signer, 3000=Grafana, 9090=Prometheus.
  # One rule with a port list + a single source prefix, replaced wholesale
  # on every IP change rather than patched, so there's never a stale rule
  # left open to an old IP.
  if az network nsg rule show --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" \
      --name allow-operator >/dev/null 2>&1; then
    az network nsg rule update \
      --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" --name allow-operator \
      --source-address-prefixes "${MY_IP}/32" >/dev/null
  else
    az network nsg rule create \
      --resource-group "${RESOURCE_GROUP}" --nsg-name "${NSG_NAME}" \
      --name allow-operator --priority 100 --direction Inbound --access Allow \
      --protocol Tcp --source-address-prefixes "${MY_IP}/32" \
      --source-port-ranges '*' --destination-port-ranges 22 8545 8546 30303 9000 3000 9090 \
      --destination-address-prefixes '*' >/dev/null
  fi

  echo "${MY_IP}" > "${STATE_FILE}"
  echo "NSG rule now scoped to ${MY_IP}."
else
  echo "IP unchanged since last run (${MY_IP}); leaving NSG rule as-is."
fi

# ---------------------------------------------------------------------------
# The VM itself.
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
apt-get install -y docker.io docker-compose-plugin
systemctl enable --now docker
usermod -aG docker "$(logname 2>/dev/null || echo bourbonadmin)"
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
    --tags project=bourbon-registry \
    -o json > /tmp/bourbon-vm-create.json

  rm -f "${CLOUD_INIT}"
  echo "Created VM ${VM_NAME}."
  echo "SSH key pair generated at ~/.ssh/id_rsa (or reused if it already existed) —"
  echo "that's local to whatever machine runs this script; keep it, it's not"
  echo "reproducible from Azure after the fact."
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
    --role "Key Vault Crypto User" --scope "${OBJECT_SCOPE}" >/tmp/bourbon-role-assignment.json 2>/tmp/bourbon-role-assignment-error.log; then
  echo "WARNING: per-key role assignment failed (this az CLI version's Key Vault RBAC" >&2
  echo "may not support object-level scope the way this script assumes — verify" >&2
  echo "against current Azure docs before relying on it; see README-BOURBON-PORT.md)." >&2
  echo "Falling back to vault-wide scope (broader than intended — tighten manually if" >&2
  echo "the object-level assignment above should have worked):" >&2
  az role assignment create \
    --assignee-object-id "${PRINCIPAL_ID}" --assignee-principal-type ServicePrincipal \
    --role "Key Vault Crypto User" --scope "${VAULT_ID}" >/dev/null
fi
echo "Granted."

PUBLIC_IP="$(az vm show -d --resource-group "${RESOURCE_GROUP}" --name "${VM_NAME}" --query publicIps -o tsv)"

echo
echo "== VM ready =="
echo "VM name:    ${VM_NAME}"
echo "Public IP:  ${PUBLIC_IP}"
echo "SSH:        ssh ${ADMIN_USER}@${PUBLIC_IP}"
echo
echo "Next: scripts/03-generate-qbft-genesis.sh (if not already done), then copy"
echo "docker/ and QBFT-Network/generated/ to this host and run scripts/05-bring-up-stack.sh."
