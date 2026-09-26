#!/usr/bin/env bash
# The single script the GitHub Actions workflow runs ON the target VM (via
# `az vm run-command invoke`) to take it from "freshly provisioned, empty"
# to "running the full stack". Everything before this point (resource
# group, Key Vault + signing key, the VM itself) happens on the runner,
# using the runner's own service-principal login — this script is what
# runs with the VM's OWN identity instead, which is why it starts by
# logging the az CLI in via that managed identity rather than expecting
# any credentials to have been copied onto the disk.
#
# Usage (see .github/workflows/deploy-custody-log-azure.yml for the actual
# invocation): REPO_URL, REF, and FORCE_REDEPLOY are read from environment
# variables so `az vm run-command invoke --parameters` can set them without
# any of them ever touching a command-line argument that'd show up in
# process listings or shell history on the VM.
set -euo pipefail

REPO_URL="${REPO_URL:?REPO_URL env var is required}"
REF="${REF:-main}"
FORCE_REDEPLOY="${FORCE_REDEPLOY:-0}"
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/custody-log-deploy}"
# Optional: a short-lived GitHub token (the workflow's own GITHUB_TOKEN is
# enough) for a private repo. Passed as a separate env var rather than
# embedded in REPO_URL so it never appears in this script's own echoed
# output or in `git remote -v` afterwards — git takes it as an extra HTTP
# header, the same mechanism actions/checkout itself uses.
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

echo "== Authenticating this VM's own az CLI via its managed identity =="
az login --identity >/dev/null
echo "OK."

GIT_AUTH_ARGS=()
if [ -n "${GITHUB_TOKEN}" ]; then
  GIT_AUTH_ARGS=(-c "http.extraheader=AUTHORIZATION: bearer ${GITHUB_TOKEN}")
fi

echo
echo "== Fetching ${REPO_URL}@${REF} =="
if [ -d "${DEPLOY_DIR}/.git" ]; then
  git "${GIT_AUTH_ARGS[@]}" -C "${DEPLOY_DIR}" fetch origin "${REF}"
  git -C "${DEPLOY_DIR}" checkout "${REF}"
  git -C "${DEPLOY_DIR}" reset --hard "origin/${REF}"
else
  git "${GIT_AUTH_ARGS[@]}" clone --branch "${REF}" --depth 1 "${REPO_URL}" "${DEPLOY_DIR}"
fi

cd "${DEPLOY_DIR}/custody-log"

echo
echo "== Installing script helper dependencies =="
(cd scripts && npm install --no-audit --no-fund)

echo
echo "== scripts/03-generate-qbft-genesis.sh =="
# Note: FORCE_REDEPLOY does NOT affect this step — regenerating genesis
# wipes the entire chain's history, a much bigger action than redeploying
# one contract, so it's never implied by the same flag. Delete
# QBFT-Network/generated/genesis.json by hand if that's really what you want.
bash scripts/03-generate-qbft-genesis.sh

echo
echo "== scripts/04-configure-web3signer.sh =="
bash scripts/04-configure-web3signer.sh

echo
echo "== scripts/05-bring-up-stack.sh =="
bash scripts/05-bring-up-stack.sh

echo
echo "== scripts/06-deploy-contract-and-app.sh =="
FORCE_REDEPLOY="${FORCE_REDEPLOY}" bash scripts/06-deploy-contract-and-app.sh

echo
echo "== Remote deploy complete =="
