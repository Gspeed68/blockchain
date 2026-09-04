#!/usr/bin/env bash
# Creates the ONE KMS signing identity this app needs, plus an IAM role
# scoped to exactly that key, attached to nothing yet (the EC2 instance
# profile attachment happens in 02-provision-ec2.sh).
#
# Why only one key: this app has no counterparty/marketplace concept (no
# bottle transfers between independent parties), so there's no second party
# that needs its own independent signing identity. A single KMS key is the
# app's own transaction-signing identity, used by the backend (through
# Web3Signer) to write bottles and appraisals. If a transfer/marketplace
# feature gets built later, add a second KMS identity for that specific
# feature then — don't create a speculative "counterparty" key now for a
# feature that doesn't exist. (This mirrors a real mistake from the prior
# Besu/QBFT AWS project — see README-BOURBON-PORT.md's Corrections section
# in that project for the actual story; this script is written to avoid
# repeating it.)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/00-check-aws-auth.sh"

PROFILE="${AWS_PROFILE:-bourbon-registry}"
REGION="${AWS_REGION:-us-east-1}"
KEY_ALIAS="alias/bourbon-registry-signer"
ROLE_NAME="bourbon-registry-ec2-role"
POLICY_NAME="bourbon-registry-kms-sign-policy"
INSTANCE_PROFILE_NAME="bourbon-registry-instance-profile"

echo "== Creating KMS signing key (${KEY_ALIAS}) in ${REGION} =="

EXISTING_KEY_ID="$(aws kms describe-key --profile "${PROFILE}" --region "${REGION}" \
  --key-id "${KEY_ALIAS}" --query 'KeyMetadata.KeyId' --output text 2>/dev/null || true)"

if [ -n "${EXISTING_KEY_ID}" ] && [ "${EXISTING_KEY_ID}" != "None" ]; then
  echo "Key already exists (KeyId=${EXISTING_KEY_ID}), reusing it."
  KEY_ID="${EXISTING_KEY_ID}"
else
  KEY_ID="$(aws kms create-key --profile "${PROFILE}" --region "${REGION}" \
    --key-spec ECC_SECG_P256K1 \
    --key-usage SIGN_VERIFY \
    --description "Bourbon Registry app signing identity (writes bottles/appraisals via Web3Signer)" \
    --tags TagKey=project,TagValue=bourbon-registry \
    --query 'KeyMetadata.KeyId' --output text)"
  aws kms create-alias --profile "${PROFILE}" --region "${REGION}" \
    --alias-name "${KEY_ALIAS}" --target-key-id "${KEY_ID}"
  echo "Created key ${KEY_ID}, aliased as ${KEY_ALIAS}."
fi

KEY_ARN="$(aws kms describe-key --profile "${PROFILE}" --region "${REGION}" \
  --key-id "${KEY_ID}" --query 'KeyMetadata.Arn' --output text)"
echo "Key ARN: ${KEY_ARN}"

echo
echo "== Deriving the app identity's Ethereum address =="
aws kms get-public-key --profile "${PROFILE}" --region "${REGION}" --key-id "${KEY_ID}" --output json \
  > /tmp/bourbon-kms-public-key.json
APP_ADDRESS="$(node "${REPO_ROOT}/scripts/lib/derive-eth-address.js" < /tmp/bourbon-kms-public-key.json)"
echo "App signing identity address: ${APP_ADDRESS}"
echo "${APP_ADDRESS}" > "${REPO_ROOT}/QBFT-Network/generated/app-identity-address.txt"
echo "-> wrote ${REPO_ROOT}/QBFT-Network/generated/app-identity-address.txt"
echo "   Paste this into QBFT-Network/config/qbftConfigFile.json's alloc block"
echo "   (replacing the 0x000...000 placeholder) before running 03-generate-qbft-genesis.sh,"
echo "   so the app identity starts pre-funded for gas."

echo
echo "== Creating IAM policy scoped to exactly this key =="
cat > /tmp/bourbon-kms-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSignWithBourbonRegistryKeyOnly",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "${KEY_ARN}"
    }
  ]
}
EOF

POLICY_ARN="$(aws iam list-policies --profile "${PROFILE}" --scope Local \
  --query "Policies[?PolicyName=='${POLICY_NAME}'].Arn | [0]" --output text)"

if [ -n "${POLICY_ARN}" ] && [ "${POLICY_ARN}" != "None" ]; then
  echo "Policy ${POLICY_NAME} already exists (${POLICY_ARN}); creating a new version instead of a new policy."
  aws iam create-policy-version --profile "${PROFILE}" --policy-arn "${POLICY_ARN}" \
    --policy-document file:///tmp/bourbon-kms-policy.json --set-as-default >/dev/null
else
  POLICY_ARN="$(aws iam create-policy --profile "${PROFILE}" \
    --policy-name "${POLICY_NAME}" \
    --policy-document file:///tmp/bourbon-kms-policy.json \
    --query 'Policy.Arn' --output text)"
fi
echo "Policy ARN: ${POLICY_ARN}"

echo
echo "== Creating IAM role for the EC2 instance profile =="
cat > /tmp/bourbon-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

if aws iam get-role --profile "${PROFILE}" --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "Role ${ROLE_NAME} already exists, reusing it."
else
  aws iam create-role --profile "${PROFILE}" --role-name "${ROLE_NAME}" \
    --assume-role-policy-document file:///tmp/bourbon-trust-policy.json \
    --description "EC2 role for the Bourbon Registry Besu/Web3Signer host, scoped to one KMS key" >/dev/null
  echo "Created role ${ROLE_NAME}."
fi

aws iam attach-role-policy --profile "${PROFILE}" --role-name "${ROLE_NAME}" --policy-arn "${POLICY_ARN}"
echo "Attached ${POLICY_NAME} to ${ROLE_NAME}."

if aws iam get-instance-profile --profile "${PROFILE}" --instance-profile-name "${INSTANCE_PROFILE_NAME}" >/dev/null 2>&1; then
  echo "Instance profile ${INSTANCE_PROFILE_NAME} already exists."
else
  aws iam create-instance-profile --profile "${PROFILE}" --instance-profile-name "${INSTANCE_PROFILE_NAME}" >/dev/null
  aws iam add-role-to-instance-profile --profile "${PROFILE}" \
    --instance-profile-name "${INSTANCE_PROFILE_NAME}" --role-name "${ROLE_NAME}"
  echo "Created instance profile ${INSTANCE_PROFILE_NAME} and attached ${ROLE_NAME}."
fi

echo
echo "== Summary =="
echo "KMS key ARN:        ${KEY_ARN}"
echo "App identity addr:  ${APP_ADDRESS}"
echo "IAM role:            ${ROLE_NAME}"
echo "Instance profile:    ${INSTANCE_PROFILE_NAME}"
echo
echo "Next: scripts/02-provision-ec2.sh (attaches ${INSTANCE_PROFILE_NAME} to the new instance)."
