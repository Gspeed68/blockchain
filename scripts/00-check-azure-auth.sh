#!/usr/bin/env bash
# Confirms we're authenticated to Azure via Entra ID (interactive login,
# not a stored client secret) before any script in this directory is
# allowed to touch a subscription. Every other numbered script sources
# this one first.
set -euo pipefail

SUBSCRIPTION="${AZURE_SUBSCRIPTION:-}"

echo "== Checking Azure auth =="

if ! az account show >/tmp/bourbon-azure-account.json 2>/tmp/bourbon-azure-auth-error.log; then
  echo "Not authenticated. Running \`az login --use-device-code\`..."
  echo "(device-code mode: it prints a URL + code below — open the URL in your"
  echo " own browser and enter the code there; this script just polls for you"
  echo " to finish, the same shape as the AWS SSO flow this project used to use.)"
  az login --use-device-code
  az account show >/tmp/bourbon-azure-account.json
fi

if [ -n "${SUBSCRIPTION}" ]; then
  az account set --subscription "${SUBSCRIPTION}"
  az account show >/tmp/bourbon-azure-account.json
fi

cat /tmp/bourbon-azure-account.json
SUB_NAME="$(python3 -c 'import json;print(json.load(open("/tmp/bourbon-azure-account.json"))["name"])')"
SUB_ID="$(python3 -c 'import json;print(json.load(open("/tmp/bourbon-azure-account.json"))["id"])')"
TENANT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/bourbon-azure-account.json"))["tenantId"])')"

echo
echo "Authenticated to subscription \"${SUB_NAME}\" (${SUB_ID}), tenant ${TENANT_ID}."
echo "If this is the wrong subscription, set AZURE_SUBSCRIPTION and re-run —"
echo "every later script trusts this identity check."
