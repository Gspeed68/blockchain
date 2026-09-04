#!/usr/bin/env bash
# Confirms we're authenticated via AWS IAM Identity Center (SSO) — never
# static long-lived keys — before any script in this directory is allowed
# to touch AWS. Every other numbered script sources this one first.
set -euo pipefail

PROFILE="${AWS_PROFILE:-bourbon-registry}"

echo "== Checking AWS auth (profile: ${PROFILE}) =="

if ! aws sts get-caller-identity --profile "${PROFILE}" >/tmp/bourbon-caller-identity.json 2>/tmp/bourbon-auth-error.log; then
  echo "Not authenticated. Attempting \`aws sso login --profile ${PROFILE}\`..."
  aws sso login --profile "${PROFILE}"
  aws sts get-caller-identity --profile "${PROFILE}" >/tmp/bourbon-caller-identity.json
fi

cat /tmp/bourbon-caller-identity.json
ACCOUNT_ID="$(python3 -c 'import json;print(json.load(open("/tmp/bourbon-caller-identity.json"))["Account"])')"
ARN="$(python3 -c 'import json;print(json.load(open("/tmp/bourbon-caller-identity.json"))["Arn"])')"

echo
echo "Authenticated as ${ARN} in account ${ACCOUNT_ID}."
echo "If this is the wrong account, fix the [${PROFILE}] profile in ~/.aws/config"
echo "before continuing — every later script trusts this identity check."
