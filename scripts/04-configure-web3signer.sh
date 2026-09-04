#!/usr/bin/env bash
# Renders the Web3Signer key-config template with this project's real KMS
# key ARN + region. Run on the EC2 host (or locally, then scp the rendered
# file over) after scripts/01-create-kms-and-iam.sh has created the key.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${AWS_PROFILE:-bourbon-registry}"
REGION="${AWS_REGION:-us-east-1}"

KEY_ARN="$(aws kms describe-key --profile "${PROFILE}" --region "${REGION}" \
  --key-id "alias/bourbon-registry-signer" --query 'KeyMetadata.Arn' --output text)"

if [ -z "${KEY_ARN}" ] || [ "${KEY_ARN}" == "None" ]; then
  echo "ERROR: couldn't find the bourbon-registry-signer KMS key. Run scripts/01-create-kms-and-iam.sh first." >&2
  exit 1
fi

TEMPLATE="${REPO_ROOT}/docker/web3signer/keys/eth1-app-identity.yaml.template"
OUT="${REPO_ROOT}/docker/web3signer/keys/eth1-app-identity.yaml"

sed -e "s|\${KMS_KEY_ARN}|${KEY_ARN}|g" -e "s|\${AWS_REGION}|${REGION}|g" "${TEMPLATE}" > "${OUT}"

echo "Wrote ${OUT} (gitignored) for key ${KEY_ARN} in ${REGION}."
echo "Next: scripts/05-bring-up-stack.sh"
