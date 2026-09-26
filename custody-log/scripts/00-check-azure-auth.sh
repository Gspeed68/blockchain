#!/usr/bin/env bash
# Confirms we're authenticated to Azure before any script in this directory
# is allowed to touch a subscription. Every other numbered script sources
# this one first.
#
# Works unchanged for both a human running this locally (falls through to
# an interactive device-code login) and CI (the GitHub Actions workflow's
# `azure/login` step already authenticates the az CLI via OIDC before these
# scripts run, so `az account show` below just succeeds and no interactive
# prompt ever fires).
set -euo pipefail

SUBSCRIPTION="${AZURE_SUBSCRIPTION:-}"

echo "== Checking Azure auth =="

if ! az account show >/tmp/custody-log-azure-account.json 2>/tmp/custody-log-azure-auth-error.log; then
  echo "Not authenticated. Running \`az login --use-device-code\`..."
  echo "(device-code mode: it prints a URL + code below — open the URL in your"
  echo " own browser and enter the code there.)"
  az login --use-device-code
  az account show >/tmp/custody-log-azure-account.json
fi

if [ -n "${SUBSCRIPTION}" ]; then
  az account set --subscription "${SUBSCRIPTION}"
  az account show >/tmp/custody-log-azure-account.json
fi

cat /tmp/custody-log-azure-account.json
SUB_NAME="$(python3 -c 'import json;print(json.load(open("/tmp/custody-log-azure-account.json"))["name"])')"
SUB_ID="$(python3 -c 'import json;print(json.load(open("/tmp/custody-log-azure-account.json"))["id"])')"
TENANT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/custody-log-azure-account.json"))["tenantId"])')"

echo
echo "Authenticated to subscription \"${SUB_NAME}\" (${SUB_ID}), tenant ${TENANT_ID}."
echo "If this is the wrong subscription, set AZURE_SUBSCRIPTION and re-run —"
echo "every later script trusts this identity check."
