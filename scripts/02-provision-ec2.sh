#!/usr/bin/env bash
# Provisions ONE EC2 instance that runs the whole stack (4 Besu validator
# containers + Web3Signer + Prometheus/Grafana) via Docker Compose.
#
# Why one instance instead of four: this is a personal-collection POC, not
# a fault-tolerant production deployment spread across AZs — four validator
# *processes* still gives real QBFT consensus (tolerates 1 faulty
# validator) and real multi-node peering to learn from, without paying for
# four EC2 instances. If this ever needs to be genuinely fault-tolerant
# against a *host* failure, split the compose file across instances later;
# don't over-provision AWS spend for a solo collector's app now.
#
# Security group handling: SSH (22) and the RPC/monitoring ports are scoped
# to the operator's current public IP only, re-detected and re-applied each
# time this script runs (so a changed home/office IP doesn't lock you out —
# it just gets the SG rule refreshed instead of erroring).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${REPO_ROOT}/scripts/00-check-aws-auth.sh"

PROFILE="${AWS_PROFILE:-bourbon-registry}"
REGION="${AWS_REGION:-us-east-1}"
INSTANCE_NAME="bourbon-registry-besu-host"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}" # 4 Besu nodes + Web3Signer + Prometheus/Grafana is memory-hungry
SG_NAME="bourbon-registry-sg"
INSTANCE_PROFILE_NAME="bourbon-registry-instance-profile"
KEY_PAIR_NAME="${KEY_PAIR_NAME:-bourbon-registry-key}"

MY_IP="$(curl -s https://checkip.amazonaws.com)/32"
echo "== Current public IP: ${MY_IP} =="

# ---------------------------------------------------------------------------
# Security group: create once, then keep its ingress rules in sync with the
# operator's current IP on every run.
# ---------------------------------------------------------------------------
VPC_ID="$(aws ec2 describe-vpcs --profile "${PROFILE}" --region "${REGION}" \
  --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)"

SG_ID="$(aws ec2 describe-security-groups --profile "${PROFILE}" --region "${REGION}" \
  --filters Name=group-name,Values="${SG_NAME}" Name=vpc-id,Values="${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"

if [ -z "${SG_ID}" ] || [ "${SG_ID}" == "None" ]; then
  SG_ID="$(aws ec2 create-security-group --profile "${PROFILE}" --region "${REGION}" \
    --group-name "${SG_NAME}" --vpc-id "${VPC_ID}" \
    --description "Bourbon Registry: SSH/RPC/monitoring, IP-scoped to the operator" \
    --query 'GroupId' --output text)"
  echo "Created security group ${SG_ID}."
else
  echo "Reusing existing security group ${SG_ID}."
fi

STATE_FILE="/tmp/bourbon-sg-last-ip.txt"
LAST_IP="$(cat "${STATE_FILE}" 2>/dev/null || true)"

if [ "${LAST_IP}" != "${MY_IP}" ]; then
  echo "IP changed (was: ${LAST_IP:-none}, now: ${MY_IP}) — refreshing SG rules."

  if [ -n "${LAST_IP}" ]; then
    for PORT in 22 8545 8546 30303 9000 3000 9090; do
      aws ec2 revoke-security-group-ingress --profile "${PROFILE}" --region "${REGION}" \
        --group-id "${SG_ID}" --protocol tcp --port "${PORT}" --cidr "${LAST_IP}" 2>/dev/null || true
    done
  fi

  # 22=SSH, 8545/8546=Besu JSON-RPC (http/ws), 30303=Besu P2P (also opened
  # to 0.0.0.0/0 further down — peers need it, but this POC runs all
  # validators on one host so that's moot for now and kept IP-scoped),
  # 9000=Web3Signer, 3000=Grafana, 9090=Prometheus.
  for PORT in 22 8545 8546 30303 9000 3000 9090; do
    aws ec2 authorize-security-group-ingress --profile "${PROFILE}" --region "${REGION}" \
      --group-id "${SG_ID}" --protocol tcp --port "${PORT}" --cidr "${MY_IP}" 2>/dev/null || true
  done

  echo "${MY_IP}" > "${STATE_FILE}"
  echo "SG rules now scoped to ${MY_IP}."
else
  echo "IP unchanged since last run (${MY_IP}); leaving SG rules as-is."
fi

# ---------------------------------------------------------------------------
# SSH key pair (created once; the .pem is written locally and gitignored —
# never committed).
# ---------------------------------------------------------------------------
if ! aws ec2 describe-key-pairs --profile "${PROFILE}" --region "${REGION}" \
    --key-names "${KEY_PAIR_NAME}" >/dev/null 2>&1; then
  aws ec2 create-key-pair --profile "${PROFILE}" --region "${REGION}" \
    --key-name "${KEY_PAIR_NAME}" --query 'KeyMaterial' --output text \
    > "${REPO_ROOT}/${KEY_PAIR_NAME}.pem"
  chmod 400 "${REPO_ROOT}/${KEY_PAIR_NAME}.pem"
  echo "Created key pair, saved to ${REPO_ROOT}/${KEY_PAIR_NAME}.pem (gitignored)."
else
  echo "Key pair ${KEY_PAIR_NAME} already exists in AWS; reusing (local .pem must already exist too)."
fi

# ---------------------------------------------------------------------------
# The instance itself.
# ---------------------------------------------------------------------------
EXISTING_INSTANCE_ID="$(aws ec2 describe-instances --profile "${PROFILE}" --region "${REGION}" \
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"

if [ -n "${EXISTING_INSTANCE_ID}" ] && [ "${EXISTING_INSTANCE_ID}" != "None" ]; then
  echo "Instance already exists: ${EXISTING_INSTANCE_ID} — not creating another."
  echo "(Terminating/replacing an instance is destructive; ask before doing that.)"
  exit 0
fi

AMI_ID="$(aws ec2 describe-images --profile "${PROFILE}" --region "${REGION}" \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)"

USER_DATA='#!/bin/bash
set -e
dnf update -y || yum update -y
dnf install -y docker git || yum install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
'

INSTANCE_ID="$(aws ec2 run-instances --profile "${PROFILE}" --region "${REGION}" \
  --image-id "${AMI_ID}" \
  --instance-type "${INSTANCE_TYPE}" \
  --key-name "${KEY_PAIR_NAME}" \
  --security-group-ids "${SG_ID}" \
  --iam-instance-profile "Name=${INSTANCE_PROFILE_NAME}" \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=50,VolumeType=gp3}' \
  --user-data "${USER_DATA}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=project,Value=bourbon-registry}]" \
  --query 'Instances[0].InstanceId' --output text)"

echo "Launched instance ${INSTANCE_ID}. Waiting for it to enter 'running' state..."
aws ec2 wait instance-running --profile "${PROFILE}" --region "${REGION}" --instance-ids "${INSTANCE_ID}"

PUBLIC_IP="$(aws ec2 describe-instances --profile "${PROFILE}" --region "${REGION}" \
  --instance-ids "${INSTANCE_ID}" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"

echo
echo "== Instance ready =="
echo "Instance ID: ${INSTANCE_ID}"
echo "Public IP:   ${PUBLIC_IP}"
echo "SSH:         ssh -i ${REPO_ROOT}/${KEY_PAIR_NAME}.pem ec2-user@${PUBLIC_IP}"
echo
echo "Next: scripts/03-generate-qbft-genesis.sh (if not already done), then copy"
echo "docker/ and QBFT-Network/generated/ to this host and run scripts/05-bring-up-stack.sh."
